import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { config as loadEnv } from 'dotenv';

const root = resolve(import.meta.dirname, '..');
loadEnv({ path: resolve(root, '.env'), quiet: true });

function localDatabaseUrl(name) {
  const value = process.env[name];
  assert(value, `${name} is required for this local browser check.`);
  const url = new URL(value);
  assert(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname), `${name} must point to loopback PostgreSQL.`);
  assert(url.port, `${name} must use an explicit local PostgreSQL port.`);
  return url;
}

const migrationUrl = localDatabaseUrl('MIGRATION_DATABASE_URL');
const runtimeUrl = localDatabaseUrl('DATABASE_URL');
assert.equal(migrationUrl.hostname, runtimeUrl.hostname, 'Migration and runtime databases must use the same local host.');
assert.equal(migrationUrl.port, runtimeUrl.port, 'Migration and runtime databases must use the same local port.');
assert.equal(decodeURIComponent(runtimeUrl.username), 'vmms_runtime', 'The application browser path requires the restricted local runtime role.');

const runId = randomBytes(6).toString('hex');
const project = `vmms-evidence-browser-${runId}`;
const bucket = `vmms-browser-${runId}`;
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vmms-evidence-browser-'));
const envFile = join(temporaryDirectory, 'fixture.env');
const composeFile = join(root, 'compose.yaml');
const evidencePort = await freeLoopbackPort();
let clamavPort = await freeLoopbackPort();
while (clamavPort === evidencePort) clamavPort = await freeLoopbackPort();
const composeEnvironment = {
  ...process.env,
  VMMS_EVIDENCE_FIXTURE_BUCKET: bucket,
  VMMS_EVIDENCE_FIXTURE_S3_PORT: String(evidencePort),
  VMMS_EVIDENCE_FIXTURE_CLAMAV_PORT: String(clamavPort),
};
const fixtureEnvironment = [
  `VMMS_EVIDENCE_FIXTURE_BUCKET=${bucket}`,
  `VMMS_EVIDENCE_FIXTURE_S3_PORT=${evidencePort}`,
  `VMMS_EVIDENCE_FIXTURE_CLAMAV_PORT=${clamavPort}`,
  '',
].join('\n');
await writeFile(envFile, fixtureEnvironment, { mode: 0o600 });

const composeArgs = [
  'compose', '--project-name', project, '--env-file', envFile,
  '--file', composeFile, '--profile', 'evidence',
];
let composeMayExist = false;
let failure;
let childExitCode = 0;

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env ?? process.env,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    if (!options.inherit) {
      child.stdout.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    }
    child.once('error', rejectRun);
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun(output.trim());
      else rejectRun(new Error(`${command} ${args[0]} failed (${signal ?? code})${output ? `: ${output.trim().slice(-1200)}` : ''}`));
    });
  });
}

async function compose(args, inherit = false) {
  return run('docker', [...composeArgs, ...args], { env: composeEnvironment, inherit });
}

async function waitForHttp(url, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // Wait for the disposable local fixture to accept requests.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(`${label} did not become available on its loopback port.`);
}

async function waitForClamAv(port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await clamCommand(port, 'zVERSION\0');
      if (/^ClamAV\s/i.test(response)) return response;
    } catch {
      // The daemon can take time to update its local signatures on first start.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  throw new Error('ClamAV did not complete its local handshake before the startup deadline.');
}

function clamCommand(port, command) {
  return new Promise((resolveCommand, rejectCommand) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      rejectCommand(new Error('ClamAV readiness probe timed out.'));
    }, 2_000);
    socket.once('connect', () => socket.write(Buffer.from(command, 'binary')));
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (data.includes('\0')) {
        clearTimeout(timer);
        socket.end();
        resolveCommand(data.split('\0')[0]);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      rejectCommand(error);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      if (!data.includes('\0')) rejectCommand(new Error('ClamAV closed before answering the readiness probe.'));
    });
  });
}

function freeLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return rejectPort(new Error('Could not reserve a local fixture port.'));
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

function dockerOutput(args) {
  return run('docker', args, { env: composeEnvironment });
}

async function verifyNoProjectResources() {
  const resources = [
    { kind: 'container', list: ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`], inspect: ['inspect', '--format', '{{ index .Config.Labels "com.docker.compose.project" }}|{{ .Name }}'], remove: ['rm', '--force'], prefix: `/${project}-` },
    { kind: 'volume', list: ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`], inspect: ['volume', 'inspect', '--format', '{{ index .Labels "com.docker.compose.project" }}|{{ .Name }}'], remove: ['volume', 'rm'], prefix: `${project}_` },
    { kind: 'network', list: ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`], inspect: ['network', 'inspect', '--format', '{{ index .Labels "com.docker.compose.project" }}|{{ .Name }}'], remove: ['network', 'rm'], prefix: `${project}_` },
  ];
  const leftovers = [];
  for (const resource of resources) {
    const ids = (await dockerOutput(resource.list)).split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const [label, name] = (await dockerOutput([...resource.inspect, id])).split('|');
      assert.equal(label, project, `Refusing to remove ${resource.kind} outside the disposable project.`);
      assert(name?.startsWith(resource.prefix), `Refusing to remove unexpected ${resource.kind} ${name}.`);
      leftovers.push({ ...resource, id });
    }
  }
  for (const item of leftovers) await dockerOutput([...item.remove, item.id]);
  const residual = [];
  for (const resource of resources) {
    const ids = (await dockerOutput(resource.list)).split(/\s+/).filter(Boolean);
    if (ids.length) residual.push(resource.kind);
  }
  assert.deepEqual(residual, [], `Disposable fixture resources remain: ${residual.join(', ')}.`);
}

try {
  await compose(['config', '--quiet']);
  composeMayExist = true;
  await compose(['up', '--detach', 'evidence-s3mock', 'evidence-clamav'], true);
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${evidencePort}/`, 'S3Mock'),
    waitForClamAv(clamavPort),
  ]);
  process.stdout.write(`Verified isolated S3Mock bucket ${bucket}; ClamAV answered on loopback.\n`);

  const storageKey = 'VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY';
  const workerStorageKey = 'VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY';
  const browserEnvironment = {
    ...process.env,
    VMMS_EVIDENCE_S3_ENDPOINT: `http://127.0.0.1:${evidencePort}`,
    VMMS_EVIDENCE_S3_BUCKET: bucket,
    VMMS_EVIDENCE_S3_REGION: 'us-east-1',
    VMMS_EVIDENCE_S3_ACCESS_KEY_ID: `vmms-browser-${runId}`,
    [storageKey]: randomBytes(32).toString('hex'),
    VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID: `vmms-worker-${runId}`,
    [workerStorageKey]: randomBytes(32).toString('hex'),
    VMMS_EVIDENCE_CLAMAV_HOST: '127.0.0.1',
    VMMS_EVIDENCE_CLAMAV_PORT: String(clamavPort),
    VMMS_EVIDENCE_CLAMAV_TIMEOUT_MS: '60000',
    VMMS_EVIDENCE_MAX_UPLOAD_BYTES: '10485760',
    VMMS_EVIDENCE_ALLOWED_MIME_TYPES: 'application/pdf,application/zip',
  };
  await run(process.execPath, [
    '--import', 'tsx', 'scripts/evidence-browser-recovery.mjs', '--run', '--real-services',
  ], { env: browserEnvironment, inherit: true });
  childExitCode = 0;
} catch (error) {
  failure = error;
  childExitCode = 1;
  process.stderr.write(`FAILED: real evidence browser orchestration (${error instanceof Error ? error.message : 'unknown error'})\n`);
  if (error instanceof Error && error.message.includes('ClamAV did not complete its local handshake')) {
    try {
      const scannerLogs = await compose(['logs', '--no-color', '--tail=80', 'evidence-clamav']);
      process.stderr.write(`ClamAV startup diagnostics:\n${scannerLogs}\n`);
    } catch {
      process.stderr.write('ClamAV startup diagnostics were unavailable.\n');
    }
  }
} finally {
  if (composeMayExist) {
    try {
      await compose(['down', '--volumes', '--remove-orphans'], true);
      await verifyNoProjectResources();
      process.stdout.write('Verified the isolated S3Mock and ClamAV containers, network and volumes were removed.\n');
    } catch (error) {
      try {
        await verifyNoProjectResources();
        process.stdout.write('Verified fixture cleanup after Compose teardown required project-label removal.\n');
      } catch (cleanupError) {
        failure ??= new Error(`Fixture teardown failed: ${error instanceof Error ? error.message : 'unknown'}; exact-project cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : 'unknown'}`);
        childExitCode = 1;
      }
    }
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (failure) process.exitCode = 1;
else process.exitCode = childExitCode;

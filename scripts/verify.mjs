import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'docs/verification/checks');
const generatedDirectoryNames = new Set(['node_modules', 'dist', '.git', '.codegraph', '.wrangler', '.vite', 'coverage', 'test-results', 'playwright-report', 'checks']);
await mkdir(output, { recursive: true });

async function fingerprint(directories) {
  const result = [];
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (generatedDirectoryNames.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) result.push(...await fingerprint([path]));
      else if (/\.(ts|tsx|mjs|py|sql|json)$/.test(entry.name)) {
        result.push([relative(root, path).replaceAll('\\', '/'), createHash('sha256').update(await readFile(path)).digest('hex')]);
      }
    }
  }
  return result;
}

const checkedSourceRoots = [resolve(root, 'apps'), resolve(root, 'scripts')];
const before = await fingerprint(checkedSourceRoots);
const commands = [
  ['traceability', ['run', 'docs:check']],
  ['traceability-tests', ['run', 'docs:test']],
  ['historical-import-templates', ['run', 'historical:templates:check']],
  ['historical-import-template-tests', ['run', 'historical:templates:test']],
  ['historical-import-staging-tests', ['run', 'historical:stage:test']],
  ['evidence-backup-package-tests', ['run', 'evidence:backup:test']],
  ['generate-web-assets', ['run', 'assets:generate', '--workspace', '@vmms/web']],
  ['typecheck', ['run', 'typecheck']],
  ['build', ['run', 'build']],
  ['cloudflare-real-api-proxy', ['run', 'verify:cloudflare-real-api-proxy']],
  ['responsive-sign-in-images', ['run', 'verify:responsive']],
  ['api-integration', ['test']],
  ['evidence-browser-real-services', ['run', 'verify:evidence-browser-real']],
  ['technician-assigned-tasks-browser', ['run', 'verify:my-assigned-tasks-browser']],
  ['queue-pagination-browser', ['run', 'verify:queue-pagination-browser']],
];
const results = [];
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString();
  const npmCommand = ['npm', ...args].join(' ');
  const result = await new Promise((done, reject) => {
    // The command list above is a fixed set of repository scripts. Passing a
    // command string to the Windows shell avoids Node's deprecated
    // shell-with-argument-array mode while still supporting npm.cmd.
    const windows = process.platform === 'win32';
    const child = windows
      ? spawn(npmCommand, { cwd: root, shell: true, windowsHide: true })
      : spawn('npm', args, { cwd: root, windowsHide: true });
    let output = '';
    child.stdout.on('data', (data) => { output += data; process.stdout.write(data); });
    child.stderr.on('data', (data) => { output += data; process.stderr.write(data); });
    child.on('error', reject);
    child.on('close', (exitCode) => done({ name, command: npmCommand.split(' '), startedAt, finishedAt: new Date().toISOString(), exitCode, output }));
  });
  const cleanLog = result.output.replaceAll('\r\n', '\n').replace(/[ \t]+$/gm, '');
  await writeFile(resolve(output, `${name}.log`), cleanLog);
  const { output: _log, ...metadata } = result;
  results.push({ ...metadata, evidence: `docs/verification/checks/${name}.log` });
}
const after = await fingerprint(checkedSourceRoots);
const beforeByPath = new Map(before);
const afterByPath = new Map(after);
const changedSourcePaths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
  .filter((path) => beforeByPath.get(path) !== afterByPath.get(path))
  .sort();
const changedDuringChecks = changedSourcePaths.length > 0;
const resultsPath = resolve(output, 'results.json');
const resultsJson = JSON.stringify({ recordedAt: new Date().toISOString(), platform: process.platform, node: process.version, scope: 'Local development build and real PostgreSQL API integration; no production, provider backup/restore, device or staff UAT claim.', changedDuringChecks, changedSourcePaths, sourceHashes: after, results }, null, 2) + '\n';
for (let attempt = 0; ; attempt += 1) {
  try {
    await writeFile(resultsPath, resultsJson);
    break;
  } catch (error) {
    const transient = error && ['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code);
    if (!transient || attempt >= 4) throw error;
    await delay(100 * (attempt + 1));
  }
}
if (changedDuringChecks) process.stderr.write('Application source changed during verification. Repeat affected checks after edits finish.\n');
process.exitCode = results.some((result) => result.exitCode !== 0) || changedDuringChecks ? 1 : 0;

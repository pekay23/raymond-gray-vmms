import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'docs/verification/checks');
await mkdir(output, { recursive: true });

async function fingerprint(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (['node_modules', 'dist', '.git', '.codegraph', 'checks'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await fingerprint(path));
    else if (/\.(ts|tsx|mjs|py|sql|json)$/.test(entry.name)) {
      result.push([relative(root, path).replaceAll('\\', '/'), createHash('sha256').update(await readFile(path)).digest('hex')]);
    }
  }
  return result;
}

const before = await fingerprint(resolve(root, 'apps'));
const commands = [
  ['traceability', ['run', 'docs:check']],
  ['typecheck', ['run', 'typecheck']],
  ['build', ['run', 'build']],
  ['api-integration', ['test']],
];
const results = [];
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString();
  const result = await new Promise((done, reject) => {
    const child = spawn('npm', args, { cwd: root, shell: process.platform === 'win32', windowsHide: true });
    let output = '';
    child.stdout.on('data', (data) => { output += data; process.stdout.write(data); });
    child.stderr.on('data', (data) => { output += data; process.stderr.write(data); });
    child.on('error', reject);
    child.on('close', (exitCode) => done({ name, command: ['npm', ...args], startedAt, finishedAt: new Date().toISOString(), exitCode, output }));
  });
  await writeFile(resolve(output, `${name}.log`), result.output);
  const { output: _log, ...metadata } = result;
  results.push({ ...metadata, evidence: `docs/verification/checks/${name}.log` });
}
const after = await fingerprint(resolve(root, 'apps'));
const changedDuringChecks = JSON.stringify(before) !== JSON.stringify(after);
await writeFile(resolve(output, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), platform: process.platform, node: process.version, scope: 'Local development build and real PostgreSQL API integration; no production, device, restore or staff UAT claim.', changedDuringChecks, sourceHashes: after, results }, null, 2) + '\n');
if (changedDuringChecks) process.stderr.write('Application source changed during verification. Repeat affected checks after edits finish.\n');
process.exitCode = results.some((result) => result.exitCode !== 0) || changedDuringChecks ? 1 : 0;

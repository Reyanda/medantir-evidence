import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const commands = [
  { name: 'typecheck', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'typecheck'] },
  { name: 'tests', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test'] },
];

const results = [];
for (const item of commands) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(item.command, item.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MEDANTIR_OFFLINE_VERIFY: '1',
      TZ: 'UTC',
      LANG: process.env.LANG ?? 'C.UTF-8',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const completedAt = new Date().toISOString();
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  results.push({
    name: item.name,
    command: [item.command, ...item.args],
    startedAt,
    completedAt,
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    stdoutSha256: createHash('sha256').update(stdout).digest('hex'),
    stderrSha256: createHash('sha256').update(stderr).digest('hex'),
  });
  if (result.status !== 0) break;
}

const passed = results.length === commands.length && results.every((item) => item.exitCode === 0);
const receipt = {
  schemaVersion: 'medantir-offline-verification/1',
  mode: 'deterministic-offline-review-engine',
  passed,
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  commands: results,
  generatedAt: new Date().toISOString(),
};

const outDir = resolve(process.env.MEDANTIR_OFFLINE_VERIFY_ARTIFACT_DIR ?? 'artifacts/offline-verification');
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, 'verification-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

if (!passed) {
  console.error(`Offline verification failed. Receipt: ${resolve(outDir, 'verification-receipt.json')}`);
  process.exit(1);
}
console.log(`Offline verification passed. Receipt: ${resolve(outDir, 'verification-receipt.json')}`);

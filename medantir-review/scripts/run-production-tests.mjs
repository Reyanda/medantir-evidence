import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const testDirectory = resolve(process.cwd(), 'dist-production-test', 'test');
const timeoutMs = Number(process.env.TEST_FILE_TIMEOUT_MS ?? 60_000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
  throw new Error('TEST_FILE_TIMEOUT_MS must be a finite number of at least 1000 milliseconds.');
}

const files = (await readdir(testDirectory))
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  throw new Error(`No compiled production test files found in ${testDirectory}.`);
}

async function runTestFile(name) {
  const path = join(testDirectory, name);
  console.log(`\n=== MEDANTIR production test: ${name} ===`);
  const child = spawn(process.execPath, ['--test', path], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(`\nTest file ${name} exceeded ${timeoutMs} ms. Sending SIGTERM.`);
    child.kill('SIGTERM');
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2_000);
    force.unref();
  }, timeoutMs);

  const result = await new Promise((resolveRun, rejectRun) => {
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => resolveRun({ code, signal }));
  });
  clearTimeout(timeout);

  if (timedOut) {
    throw new Error(`Production test file timed out: ${name}`);
  }
  if (result.code !== 0) {
    throw new Error(`Production test file failed: ${name} (code=${String(result.code)}, signal=${String(result.signal)})`);
  }
}

console.log(`Running ${files.length} isolated production test files with a ${timeoutMs} ms per-file limit.`);
for (const file of files) {
  await runTestFile(file);
}
console.log(`\nAll ${files.length} production test files passed and terminated cleanly.`);

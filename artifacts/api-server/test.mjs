import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = await mkdtemp(join(tmpdir(), 'align-tests-'));
try {
  const file = join(dir, 'operations.test.mjs');
  await build({ entryPoints: ['src/lib/planner-operations.test.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const result = spawnSync(process.execPath, ['--test', file], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = await mkdtemp(join(tmpdir(), 'align-tests-'));
try {
  await build({ entryPoints: ['src/lib/planner-operations.test.ts', 'src/lib/access-policy.test.ts'], outdir: dir, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const result = spawnSync(process.execPath, ['--test', join(dir, 'planner-operations.test.mjs'), join(dir, 'access-policy.test.mjs')], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = await mkdtemp(join(tmpdir(), 'align-tests-'));
try {
  const tests = ['src/lib/planner-operations.test.ts', 'src/lib/access-policy.test.ts', 'src/lib/measurements.test.ts', 'src/lib/planner-assistant.test.ts', '../adaptive-planner/src/lib/ai/context-planning.test.ts', '../adaptive-planner/src/lib/store/contributions.test.ts', '../adaptive-planner/src/lib/store/partial-periods.test.ts'];
  tests.push('../adaptive-planner/src/lib/store/sessions.test.ts');
  tests.push('../adaptive-planner/src/lib/reports.test.ts');
  tests.push('../adaptive-planner/src/lib/store/time-tracking.test.ts');
  tests.push('../adaptive-planner/src/lib/task-views.test.ts');
  tests.push('../adaptive-planner/src/lib/store/saved-timesheets.test.ts');
  const files = tests.map((file) => join(dir, basename(file).replace(/\.ts$/, '.mjs')));
  await Promise.all(tests.map((file, i) => build({ entryPoints: [file], outfile: files[i], bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })));
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

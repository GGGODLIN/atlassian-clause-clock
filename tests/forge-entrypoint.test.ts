import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { routeClauseClockForgeAction } from '../src/index.ts';

async function checkHandler(handler: typeof routeClauseClockForgeAction): Promise<void> {
  const result = await handler({ call: { functionKey: 'skill-contract' }, context: {} }) as { skillMarkdown: string; tools: { name: string }[] };
  assert.equal(result.skillMarkdown, await fs.readFile(new URL('../skills/clause-clock/SKILL.md', import.meta.url), 'utf8'));
  assert.deepEqual(result.tools.map(tool => tool.name), ['evaluate-clause-clock', 'run-pbt-audit', 'commit-credit-settlement', 'reset-settlement-state']);
  await assert.rejects(handler({}), /trusted Forge action context/);
  await assert.rejects(handler({ call: { functionKey: 'evaluate-clause-clock' }, context: {} }), /Forge cloud context is required/);
}

test('Forge source entry point loads and dispatches its real resolver', async () => {
  await checkHandler(routeClauseClockForgeAction);
});

test('Forge CommonJS bundle loads and dispatches its real resolver', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clause-clock-entrypoint-'));
  const outfile = path.join(directory, 'index.cjs');
  try {
    await build({ entryPoints: ['src/index.ts'], bundle: true, outfile, format: 'cjs', platform: 'node', target: 'node22' });
    const requireBundle = createRequire(import.meta.url);
    const entry = requireBundle(outfile) as { routeClauseClockForgeAction: typeof routeClauseClockForgeAction };
    await checkHandler(entry.routeClauseClockForgeAction);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

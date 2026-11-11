import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire, Module } from 'node:module';
import { validate } from '@forge/manifest';

const validation = await validate();
process.stdout.write(`${JSON.stringify({ manifestValid: validation.success, errors: validation.errors })}\n`);
assert.equal(validation.success, true);
for (const asset of ['index.html', 'main.js', 'main.css']) await fs.access(`static/clause-clock-ui/${asset}`);
// The official webpack config checks require.main even when its caller is an ES module.
process.mainModule ??= new Module(process.argv[1]);
const requireFromCli = createRequire(import.meta.resolve('@forge/cli/package.json'));
const { getNodeBundler, getWrapperProvider } = requireFromCli('@forge/bundler');
const { FileSystemReader } = requireFromCli('@forge/cli-shared');
const logger = {
  info: message => process.stdout.write(`${message}\n`),
  warn: message => process.stderr.write(`${message}\n`),
  error: message => process.stderr.write(`${message}\n`),
  debug: () => {}, trace: () => {}, isDebugEnabled: () => false,
};
const fileSystemReader = new FileSystemReader();
const bundler = getNodeBundler(logger, getWrapperProvider({ fileSystemReader }), { readConfig: async () => validation.manifestObject.yamlContent });
const bundle = await bundler.bundle({ appDirectory: process.cwd(), entryPoints: [{ name: 'index', path: 'src/index.ts' }] });
await fs.access(`${bundle.outputDir}/index.cjs`);
const source = await fs.readFile(`${bundle.outputDir}/index.cjs`, 'utf8');
assert.ok(source.includes('routeClauseClockForgeAction'));
process.stdout.write(`${JSON.stringify({ bundleDirectory: bundle.outputDir, handler: 'index.routeClauseClockForgeAction', metadata: bundle.metadata, runtimeFiles: [...(bundle.additionalOutputs?.keys() ?? [])] })}\n`);

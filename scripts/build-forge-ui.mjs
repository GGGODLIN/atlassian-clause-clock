import fs from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const outdir = 'static/clause-clock-ui';
await fs.mkdir(outdir, { recursive: true });
const skill = await fs.readFile('skills/clause-clock/SKILL.md', 'utf8');
await fs.writeFile('src/forge/skill-markdown.ts', `export default ${JSON.stringify(skill)};\n`);
await build({ entryPoints: ['forge-ui/main.tsx'], bundle: true, outdir, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
const css = await fs.readFile('app/globals.css', 'utf8');
const result = await postcss([tailwind()]).process(css, { from: 'app/globals.css', to: `${outdir}/main.css` });
await fs.writeFile(`${outdir}/main.css`, result.css);
await fs.writeFile(`${outdir}/index.html`, '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClauseClock</title><link rel="stylesheet" href="./main.css"></head><body><div id="root"></div><script type="module" src="./main.js"></script></body></html>');
await fs.mkdir('build/forge', { recursive: true });
await build({ entryPoints: ['src/index.ts'], bundle: true, outfile: 'build/forge/index.cjs', format: 'cjs', platform: 'node', target: 'node22' });
process.stdout.write(`Forge Custom UI: ${outdir}/index.html + main.js + main.css; backend: build/forge/index.cjs\n`);

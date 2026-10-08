#!/usr/bin/env node
// cli.mjs
import { readFile, writeFile } from 'node:fs/promises';
import fg from 'fast-glob';
import chokidar from 'chokidar';
import postcss from 'postcss';
import scss from 'postcss-scss';

const cwd = process.cwd();
const watch = process.argv.includes('--watch');
const ignore = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.angular/**'];

const plugin = {
  postcssPlugin: 'force-important',
  Declaration(decl) {
    if (decl.important) return;
    if (decl.prop.startsWith('$') || decl.prop.startsWith('--')) return;
    if (decl.isNested) return;
    if (/keyframes$/.test(decl.parent?.parent?.name ?? '')) return;
    decl.important = true;
  },
};

async function transform(file) {
  const input = await readFile(file, 'utf8');
  const { css } = await postcss([plugin]).process(input, { from: file, syntax: scss });
  if (css === input) return;
  await writeFile(file, css);
  console.log('✓', file);
}

if (watch) {
  chokidar
    .watch('**/*.scss', { cwd, ignored: (p) => /node_modules|[\\/]dist[\\/]|[\\/]\.git[\\/]/.test(p) })
    .on('add', (f) => transform(f))
    .on('change', (f) => transform(f));
  console.log('Watching *.scss in', cwd);
} else {
  const files = await fg('**/*.scss', { cwd, ignore, absolute: true });
  await Promise.all(files.map(transform));
  console.log(`Done: ${files.length} files scanned`);
}
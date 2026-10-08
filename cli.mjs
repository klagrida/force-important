#!/usr/bin/env node
// cli.mjs — add !important to every SCSS declaration that lacks it.
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import fg from 'fast-glob';
import postcss from 'postcss';
import scss from 'postcss-scss';

if (process.env.NODE_ENV === 'production') process.exit(0);

const cwd = process.cwd();
// Dot-directories are scanned (see `dot: true` below), so generated output that
// hides in one has to be excluded explicitly.
const ignore = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.angular/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.cache/**',
  '**/.parcel-cache/**',
  '**/.turbo/**',
];

function inKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && /keyframes$/.test(p.name)) return true;
  }
  return false;
}

const plugin = {
  postcssPlugin: 'force-important',
  Declaration(decl) {
    if (decl.important) return;
    // A Sass variable assignment is not a CSS declaration. Covers both `$var:`
    // and the module form `namespace.$var:`, whose prop starts with the
    // namespace. Appending !important there changes the VALUE: `false !important`
    // is truthy, which silently flips @if branches downstream.
    if (decl.prop.includes('$') || decl.prop.startsWith('--')) return;
    if (inKeyframes(decl)) return;
    decl.important = true;
  },
};

async function transform(file) {
  const input = await readFile(file, 'utf8');
  const { css } = await postcss([plugin]).process(input, { from: file, syntax: scss });
  if (css === input) return false;
  await writeFile(file, css);
  console.log('✓', relative(cwd, file));
  return true;
}

const files = await fg('**/*.scss', {
  cwd,
  ignore,
  absolute: true,
  dot: true, // without this, anything under a .folder is silently skipped
  caseSensitiveMatch: false, // so .SCSS and .Scss are found too
});
const results = await Promise.allSettled(files.map(transform));

let changed = 0;
const failed = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') changed += r.value ? 1 : 0;
  else failed.push([files[i], r.reason]);
});

for (const [file, err] of failed) {
  console.error('✗', relative(cwd, file), '—', err?.reason ?? err?.message ?? err);
}

console.log(
  `${files.length} scanned, ${changed} changed` + (failed.length ? `, ${failed.length} failed` : '')
);
if (failed.length) process.exitCode = 1;

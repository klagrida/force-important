#!/usr/bin/env node
// cli.mjs — add !important to every SCSS declaration that lacks it.
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import fg from 'fast-glob';
import postcss from 'postcss';
import scss from 'postcss-scss';

// Read from the tool's own package.json, not the user's. `files` in
// package.json only lists cli.mjs, but npm always ships package.json too, so
// this resolves in an installed copy as well as in the repo.
const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

// Answered before the production guard so `--version` works everywhere.
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(version);
  process.exit(0);
}

if (process.env.NODE_ENV === 'production') process.exit(0);

console.log(`force-important ${version}`);

const cwd = process.cwd();
const CONFIG_FILE = 'force-important.json';
const CONFIG_KEYS = ['ignoreFolders', 'ignoreFiles', 'onlySelectors'];

// Dot-directories are scanned (see `dot: true` below), so generated output that
// hides in one has to be excluded explicitly. A config file can add to this
// list but never shrink it.
const DEFAULT_IGNORE = [
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

// Shared so config validation resolves patterns exactly as the real scan does.
const GLOB_OPTIONS = {
  cwd,
  dot: true, // without this, anything under a .folder is silently skipped
  caseSensitiveMatch: false, // so .SCSS and .Scss are found too
};

// This tool rewrites files in place and has no undo, so a config it cannot
// understand aborts the run rather than falling back to defaults: silently
// ignoring a bad ignore rule would rewrite the very files it was meant to skip.
function configError(message) {
  console.error(`✗ ${CONFIG_FILE}: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.error(`⚠ ${CONFIG_FILE}: ${message}`);
}

async function readConfig() {
  let raw;
  try {
    raw = await readFile(join(cwd, CONFIG_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    configError(err.message);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    configError(`invalid JSON — ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    configError('expected a JSON object at the top level');
  }

  for (const key of Object.keys(parsed)) {
    if (!CONFIG_KEYS.includes(key)) warn(`unknown key "${key}" — ignored`);
  }

  const config = {};
  for (const key of CONFIG_KEYS) {
    const value = parsed[key];
    if (value === undefined) {
      config[key] = [];
      continue;
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      configError(`"${key}" must be an array of strings`);
    }
    config[key] = value.map((entry) => entry.trim()).filter(Boolean);
  }
  return config;
}

const GLOB_CHARS = ['*', '?', '[', ']', '{', '}'];
const hasGlob = (entry) => GLOB_CHARS.some((char) => entry.includes(char));

// A slashless entry matches anywhere, so the user never has to write `**/`;
// anything containing a slash is anchored to the project root.
function normalize(entry) {
  let p = entry.replace(/\\/g, '/');
  while (p.endsWith('/')) p = p.slice(0, -1);
  return p.includes('/') ? p : `**/${p}`;
}

async function buildIgnore(config) {
  if (!config) return DEFAULT_IGNORE;
  const extra = [];

  for (const entry of config.ignoreFolders) {
    const base = normalize(entry);
    extra.push(`${base}/**`); // the folder key supplies `/**` itself
    if (hasGlob(entry)) continue; // an explicit glob may legitimately match nothing
    if ((await fg(base, { ...GLOB_OPTIONS, onlyDirectories: true })).length) continue;
    if ((await fg(base, { ...GLOB_OPTIONS, onlyFiles: true })).length) {
      configError(`ignoreFolders: "${entry}" is a file — move it to ignoreFiles`);
    }
    warn(`ignoreFolders: "${entry}" — no such directory`);
  }

  for (const entry of config.ignoreFiles) {
    const pattern = normalize(entry);
    extra.push(pattern);
    if (hasGlob(entry)) continue;
    if ((await fg(pattern, { ...GLOB_OPTIONS, onlyFiles: true })).length) continue;
    if ((await fg(pattern, { ...GLOB_OPTIONS, onlyDirectories: true })).length) {
      configError(`ignoreFiles: "${entry}" is a directory — move it to ignoreFolders`);
    }
    warn(`ignoreFiles: "${entry}" — matched no files`);
  }

  return [...DEFAULT_IGNORE, ...extra];
}

function inKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && /keyframes$/.test(p.name)) return true;
  }
  return false;
}

// Every selector this declaration will end up under, innermost first. Nesting
// matters: `.mat-card { .inner { top: 0 } }` compiles to `.mat-card .inner`, so
// an ancestor's selector counts as much as the immediate parent's.
function selectorChain(decl) {
  const chain = [];
  for (let p = decl.parent; p; p = p.parent) {
    if (p.type === 'rule' && p.selector) chain.push(p.selector);
  }
  return chain;
}

// `hits` counts how many declarations each onlySelectors entry matched, so a
// pattern that never matched anything can be reported at the end.
function makePlugin(onlySelectors, hits) {
  return {
    postcssPlugin: 'force-important',
    Declaration(decl) {
      if (decl.important) return;
      // A Sass variable assignment is not a CSS declaration. Covers both `$var:`
      // and the module form `namespace.$var:`, whose prop starts with the
      // namespace. Appending !important there changes the VALUE: `false !important`
      // is truthy, which silently flips @if branches downstream.
      if (decl.prop.includes('$') || decl.prop.startsWith('--')) return;
      if (inKeyframes(decl)) return;

      if (onlySelectors.length) {
        const chain = selectorChain(decl);
        // No enclosing selector at all — a bare @mixin body, say — means the
        // final selector is unknowable here, so it cannot be matched.
        const matched = onlySelectors.filter((needle) =>
          chain.some((selector) => selector.includes(needle))
        );
        if (!matched.length) return;
        for (const needle of matched) hits.set(needle, (hits.get(needle) ?? 0) + 1);
      }

      decl.important = true;
    },
  };
}

async function transform(file, processor) {
  const input = await readFile(file, 'utf8');
  const { css } = await processor.process(input, { from: file, syntax: scss });
  if (css === input) return false;
  await writeFile(file, css);
  console.log('✓', relative(cwd, file));
  return true;
}

const config = await readConfig();
const ignore = await buildIgnore(config);
const onlySelectors = config?.onlySelectors ?? [];

if (config) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [
    plural(config.ignoreFolders.length, 'folder'),
    plural(config.ignoreFiles.length, 'file'),
  ];
  if (onlySelectors.length) parts.push(`only ${plural(onlySelectors.length, 'selector')}`);
  console.log(`config: ${CONFIG_FILE} — ${parts.join(', ')}`);
}

const hits = new Map();
const processor = postcss([makePlugin(onlySelectors, hits)]);

const files = await fg('**/*.scss', { ...GLOB_OPTIONS, ignore, absolute: true });
const results = await Promise.allSettled(files.map((file) => transform(file, processor)));

let changed = 0;
const failed = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') changed += r.value ? 1 : 0;
  else failed.push([files[i], r.reason]);
});

for (const [file, err] of failed) {
  console.error('✗', relative(cwd, file), '—', err?.reason ?? err?.message ?? err);
}

for (const needle of onlySelectors) {
  if (!hits.has(needle)) warn(`onlySelectors: "${needle}" — matched no selectors`);
}

console.log(
  `${files.length} scanned, ${changed} changed` + (failed.length ? `, ${failed.length} failed` : '')
);
if (failed.length) process.exitCode = 1;

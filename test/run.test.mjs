// Golden-file tests: every case under test/cases/ is an input.scss + expected.scss
// pair. Each test copies the input into a throwaway directory, runs the real CLI
// there, and compares the rewritten file to expected.scss byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, readdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'cli.mjs');
const CASES = join(here, 'cases');

// Git may check these fixtures out with CRLF on Windows; compare logical content.
const norm = (s) => s.replace(/\r\n/g, '\n');

const sandbox = () => mkdtemp(join(tmpdir(), 'force-important-'));

async function runCli(cwd, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI], {
      cwd,
      env: { ...process.env, NODE_ENV: 'test', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function withSandbox(fn) {
  const dir = await sandbox();
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const caseNames = (await readdir(CASES, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

assert.ok(caseNames.length > 0, 'no fixture cases found');

for (const name of caseNames) {
  test(`fixture: ${name}`, async () => {
    await withSandbox(async (dir) => {
      const target = join(dir, 'style.scss');
      await cp(join(CASES, name, 'input.scss'), target);

      const r = await runCli(dir);
      assert.equal(r.code, 0, `exited ${r.code}\n${r.stderr}`);

      const actual = norm(await readFile(target, 'utf8'));
      const expected = norm(await readFile(join(CASES, name, 'expected.scss'), 'utf8'));
      assert.equal(actual, expected);
    });
  });
}

test('idempotent: a second pass changes nothing', async () => {
  await withSandbox(async (dir) => {
    const target = join(dir, 'style.scss');
    await cp(join(CASES, 'mixin-media-nested', 'input.scss'), target);

    await runCli(dir);
    const first = await readFile(target, 'utf8');

    const second = await runCli(dir);
    assert.equal(second.code, 0);
    assert.equal(await readFile(target, 'utf8'), first);
    assert.match(second.stdout, /1 scanned, 0 changed/);
  });
});

test('a file needing no change is not reported as changed', async () => {
  await withSandbox(async (dir) => {
    await cp(join(CASES, 'already-important', 'input.scss'), join(dir, 'style.scss'));
    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /1 scanned, 0 changed/);
    assert.doesNotMatch(r.stdout, /✓/);
  });
});

const GENERATED = [
  'node_modules/pkg',
  'dist',
  'build',
  'coverage/lcov',
  '.angular/cache',
  '.next/static',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.parcel-cache',
  '.turbo',
];

test('ignores dependency and generated-output directories', async () => {
  await withSandbox(async (dir) => {
    const untouched = '.skip { color: hotpink; }\n';
    for (const sub of GENERATED) {
      await mkdir(join(dir, sub), { recursive: true });
      await writeFile(join(dir, sub, 'x.scss'), untouched);
    }
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'ok.scss'), '.ok { color: red; }\n');

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /1 scanned, 1 changed/);

    for (const sub of GENERATED) {
      assert.equal(
        await readFile(join(dir, sub, 'x.scss'), 'utf8'),
        untouched,
        `${sub} should have been ignored`
      );
    }
    assert.equal(
      norm(await readFile(join(dir, 'src', 'ok.scss'), 'utf8')),
      '.ok { color: red !important; }\n'
    );
  });
});

test('recurses into every subfolder, including dot-directories', async () => {
  await withSandbox(async (dir) => {
    const paths = [
      'a/b/c/d/e/f/deep.scss',
      'my components/sp ace.scss',
      'with (parens)/p.scss',
      '_partial.scss',
      '.hidden/h.scss',
      'src/.config/c.scss',
    ];
    for (const rel of paths) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), '.t { color: red; }\n');
    }

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`${paths.length} scanned, ${paths.length} changed`));

    for (const rel of paths) {
      assert.equal(
        norm(await readFile(join(dir, rel), 'utf8')),
        '.t { color: red !important; }\n',
        `${rel} should have been processed`
      );
    }
  });
});

test('matches .SCSS and .Scss as well as .scss', async () => {
  await withSandbox(async (dir) => {
    for (const name of ['a.scss', 'b.SCSS', 'c.Scss']) {
      await writeFile(join(dir, name), '.t { color: red; }\n');
    }

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /3 scanned, 3 changed/);

    for (const name of ['a.scss', 'b.SCSS', 'c.Scss']) {
      assert.equal(
        norm(await readFile(join(dir, name), 'utf8')),
        '.t { color: red !important; }\n',
        `${name} should have been processed`
      );
    }
  });
});

test('a broken file is reported but does not stop the others', async () => {
  await withSandbox(async (dir) => {
    await writeFile(join(dir, 'broken.scss'), '.a { color: red;\n');
    await writeFile(join(dir, 'good.scss'), '.b { color: blue; }\n');

    const r = await runCli(dir);

    assert.equal(r.code, 1, 'should exit 1 when a file fails');
    assert.match(r.stderr, /✗ broken\.scss/);
    assert.match(r.stdout, /2 scanned, 1 changed, 1 failed/);
    // the healthy file was still processed
    assert.equal(
      norm(await readFile(join(dir, 'good.scss'), 'utf8')),
      '.b { color: blue !important; }\n'
    );
    // the broken file was left exactly as it was
    assert.equal(norm(await readFile(join(dir, 'broken.scss'), 'utf8')), '.a { color: red;\n');
  });
});

test('NODE_ENV=production touches nothing and exits 0', async () => {
  await withSandbox(async (dir) => {
    const before = '.p { color: red; }\n';
    await writeFile(join(dir, 'style.scss'), before);

    const r = await runCli(dir, { NODE_ENV: 'production' });

    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '');
    assert.equal(await readFile(join(dir, 'style.scss'), 'utf8'), before);
  });
});

test('an empty folder is a clean no-op', async () => {
  await withSandbox(async (dir) => {
    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /0 scanned, 0 changed/);
  });
});

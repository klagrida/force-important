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

// ---------------------------------------------------------------------------
// force-important.json
// ---------------------------------------------------------------------------

const SCSS = '.t { color: red; }\n';

// Lays out a small tree used by the config tests:
//   src/app/a.scss  src/app/_variables.scss  src/legacy/old.scss
//   src/theme.scss  vendor/lib/v.scss        node_modules/pkg/n.scss
async function project(dir) {
  const files = [
    'src/app/a.scss',
    'src/app/_variables.scss',
    'src/legacy/old.scss',
    'src/theme.scss',
    'vendor/lib/v.scss',
    'node_modules/pkg/n.scss',
  ];
  for (const rel of files) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), SCSS);
  }
  return files;
}

const writeConfig = (dir, config) =>
  writeFile(join(dir, 'force-important.json'), JSON.stringify(config, null, 2));

// Reads back which .scss files still hold their original, untransformed content.
async function untouched(dir, files) {
  const out = [];
  for (const rel of files) {
    if (norm(await readFile(join(dir, rel), 'utf8')) === SCSS) out.push(rel);
  }
  return out.sort();
}

test('no config file: nothing is announced and defaults apply', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    const r = await runCli(dir);

    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /config:/);
    assert.match(r.stdout, /5 scanned, 5 changed/); // node_modules excluded
    assert.deepEqual(await untouched(dir, files), ['node_modules/pkg/n.scss']);
  });
});

test('ignoreFolders: a slashless name matches that folder at any depth', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    await writeConfig(dir, { ignoreFolders: ['vendor'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /config: force-important\.json — 1 folder, 0 files/);
    assert.match(r.stdout, /4 scanned, 4 changed/);
    assert.deepEqual(await untouched(dir, files), [
      'node_modules/pkg/n.scss',
      'vendor/lib/v.scss',
    ]);
  });
});

test('ignoreFolders: a path with a slash is anchored to the root', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    // a sibling of the same name elsewhere must still be processed
    await mkdir(join(dir, 'other/legacy'), { recursive: true });
    await writeFile(join(dir, 'other/legacy/keep.scss'), SCSS);
    await writeConfig(dir, { ignoreFolders: ['src/legacy'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.deepEqual(await untouched(dir, [...files, 'other/legacy/keep.scss']), [
      'node_modules/pkg/n.scss',
      'src/legacy/old.scss',
    ]);
  });
});

test('ignoreFiles: a bare filename matches at any depth', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    await writeConfig(dir, { ignoreFiles: ['_variables.scss'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /config: force-important\.json — 0 folders, 1 file/);
    assert.deepEqual(await untouched(dir, files), [
      'node_modules/pkg/n.scss',
      'src/app/_variables.scss',
    ]);
  });
});

test('ignoreFiles: a path with a slash is anchored to the root', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    await writeConfig(dir, { ignoreFiles: ['src/theme.scss'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.deepEqual(await untouched(dir, files), [
      'node_modules/pkg/n.scss',
      'src/theme.scss',
    ]);
  });
});

test('config extends the built-in ignore list, it cannot shrink it', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    // even an explicit attempt to re-include node_modules must not work
    await writeConfig(dir, { ignoreFolders: ['vendor'], ignoreFiles: ['src/theme.scss'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.deepEqual(await untouched(dir, files), [
      'node_modules/pkg/n.scss',
      'src/theme.scss',
      'vendor/lib/v.scss',
    ]);
  });
});

test('an unknown key warns but the run proceeds', async () => {
  await withSandbox(async (dir) => {
    await project(dir);
    await writeConfig(dir, { ignoreFolders: ['vendor'], ignoreDirs: ['oops'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /unknown key "ignoreDirs" — ignored/);
    assert.match(r.stdout, /4 scanned, 4 changed/);
  });
});

test('a folder that does not exist warns but the run proceeds', async () => {
  await withSandbox(async (dir) => {
    await project(dir);
    await writeConfig(dir, { ignoreFolders: ['src/legcay'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /ignoreFolders: "src\/legcay" — no such directory/);
    assert.match(r.stdout, /5 scanned, 5 changed/);
  });
});

test('a file pattern matching nothing warns but the run proceeds', async () => {
  await withSandbox(async (dir) => {
    await project(dir);
    await writeConfig(dir, { ignoreFiles: ['not-here.scss'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /ignoreFiles: "not-here\.scss" — matched no files/);
    assert.match(r.stdout, /5 scanned, 5 changed/);
  });
});

test('an explicit glob matching nothing is silent', async () => {
  await withSandbox(async (dir) => {
    await project(dir);
    await writeConfig(dir, { ignoreFiles: ['**/nope-*.scss'] });

    const r = await runCli(dir);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stderr, /matched no files/);
  });
});

test('a file listed under ignoreFolders aborts', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    await writeConfig(dir, { ignoreFolders: ['src/theme.scss'] });

    const r = await runCli(dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /is a file — move it to ignoreFiles/);
    assert.deepEqual(await untouched(dir, files), files.slice().sort());
  });
});

test('a folder listed under ignoreFiles aborts', async () => {
  await withSandbox(async (dir) => {
    const files = await project(dir);
    await writeConfig(dir, { ignoreFiles: ['src/legacy'] });

    const r = await runCli(dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /is a directory — move it to ignoreFolders/);
    assert.deepEqual(await untouched(dir, files), files.slice().sort());
  });
});

// The tool rewrites in place with no undo, so an unreadable config must stop
// the run before a single file is touched.
for (const [label, body] of [
  ['malformed JSON', '{ "ignoreFolders": ["src/legacy",] }'],
  ['a non-array value', '{ "ignoreFolders": "src/legacy" }'],
  ['an array holding a non-string', '{ "ignoreFiles": ["ok.scss", 42] }'],
  ['an array at the top level', '["src/legacy"]'],
  ['a bare string at the top level', '"src/legacy"'],
]) {
  test(`invalid config (${label}) aborts without writing anything`, async () => {
    await withSandbox(async (dir) => {
      const files = await project(dir);
      await writeFile(join(dir, 'force-important.json'), body);

      const r = await runCli(dir);
      assert.equal(r.code, 1, `expected exit 1, got ${r.code}`);
      assert.match(r.stderr, /^✗ force-important\.json:/m);
      assert.equal(r.stdout.trim(), '', 'should not report any work');
      assert.deepEqual(await untouched(dir, files), files.slice().sort());
    });
  });
}

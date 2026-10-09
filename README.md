# force-important

[![CI](https://github.com/klagrida/force-important/actions/workflows/ci.yml/badge.svg)](https://github.com/klagrida/force-important/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/force-important)](https://www.npmjs.com/package/force-important)

Dev-only CLI that adds `!important` to every SCSS declaration in the current folder that doesn't already have it.

```bash
npx force-important
```

One pass, then it exits. **It rewrites files in place, so commit first.**

## What it does

- Scans `**/*.scss` from `process.cwd()`, recursively, at unlimited depth —
  including dot-directories and `.SCSS` / `.Scss` spellings
- Parses with `postcss-scss` (no regex)
- Adds `!important` to declarations that lack it
- Writes a file only if the result differs from the input

Ignored directories (dependency trees and generated output):

```
node_modules  dist  build  coverage  .git  .angular
.next  .nuxt  .svelte-kit  .cache  .parcel-cache  .turbo
```

These are always excluded. Everything else is fair game, so a folder like
`src/.config/` **is** processed. To skip more, add a [config file](#config).

## Example

```scss
// before
.btn {
  color: red;
  margin: 0 !important;
  $gap: 4px;
  --brand: #09f;
}

// after
.btn {
  color: red !important;
  margin: 0 !important;
  $gap: 4px;
  --brand: #09f;
}
```

## Skipped

| Case | Reason |
| --- | --- |
| `$variables` | not CSS declarations |
| `namespace.$variables` | Sass module variable assignments — see below |
| `--custom-props` | `!important` changes their semantics |
| Declarations anywhere inside `@keyframes` | `!important` is invalid there |
| Already `!important` | idempotent |

Declarations inside `@mixin` bodies, `@media` blocks, nested rules, and nested
property blocks (`font: { … }`) **are** modified. For nested properties that
means `font: { family: serif !important; }`, which Sass compiles to the valid
`font-family: serif !important`.

## Output

Every run announces the version it is using, so output pasted into a bug report
carries it:

```
force-important 0.2.0
✓ src/button.scss
✗ src/broken.scss — Unclosed block
12 scanned, 1 changed, 1 failed
```

To print just the version and exit, without scanning anything:

```bash
force-important --version    # or -v
0.2.0
```

A file that fails to parse is reported and skipped; the rest still run. Exit
code is `1` if any file failed, otherwise `0`.

## Tests

```bash
npm test
```

Each folder under `test/cases/` is a golden-file pair — `input.scss` and the
`expected.scss` it must produce. The runner copies the input into a throwaway
temp directory, runs the real CLI there, and compares the rewritten file to the
expectation. Alongside those, the suite covers idempotency, the ignore list,
exit codes, fail-soft behavior on an unparseable file, and the production guard.

To add a case, create `test/cases/<name>/input.scss` + `expected.scss`; it is
picked up automatically.

### Running one test

`--test-name-pattern` takes a regex matched against the test name:

```bash
npm run test:one -- keyframes          # one case
npm run test:one -- "fixture: basic"   # quote names containing spaces
```

Or call node directly, which is the same thing:

```bash
node --test --test-name-pattern="fixture: keyframes"   # one case
node --test --test-name-pattern="^fixture:"            # all golden-file cases
node --test --watch                                    # re-run on save
```

> **Don't use `npm test -- --test-name-pattern=…`.** npm appends the flag after
> the file path, where node ignores it — the filter is silently dropped and the
> whole suite runs instead. The flag has to come before the path, which is what
> `test:one` does. (The path can be omitted entirely: `test/run.test.mjs`
> matches node's default `*.test.mjs` discovery.)

## Config

Optional. Create a `force-important.json` in the folder you run the tool from —
your project root, next to `package.json`:

```
my-project/
├── force-important.json   ← here
├── package.json
└── src/
```

All keys go at the top level, and all are optional, so a file with just one of
them is valid:

```json
{
  "onlySelectors": ["mat-"]
}
```

The full shape:

```json
{
  "ignoreFolders": ["vendor", "src/legacy"],
  "ignoreFiles": ["_variables.scss", "src/theme.scss"],
  "onlySelectors": ["mat-"]
}
```

The config is looked up in the current directory only — it is not searched for
up the tree — so run the tool from the folder holding the file. If you don't see
the `config:` line in the output, it wasn't found.

| Key | Effect |
| --- | --- |
| `ignoreFolders` | folders to skip entirely |
| `ignoreFiles` | individual files to skip |
| `onlySelectors` | only force rules whose selector contains one of these — see [Targeting selectors](#targeting-selectors) |

All three are optional arrays of strings. Unknown keys warn and are ignored.

The two ignore keys follow the same path rule:

> **No slash → matches at any depth. Contains a slash → anchored to the root.**

| Entry | Key | Matches |
| --- | --- | --- |
| `vendor` | `ignoreFolders` | every folder named `vendor`, at any depth |
| `src/legacy` | `ignoreFolders` | only that one folder |
| `_variables.scss` | `ignoreFiles` | that filename, at any depth |
| `src/theme.scss` | `ignoreFiles` | only that one file |

So you never write `**/` or `/**` yourself — `ignoreFolders` appends `/**`, and a
slashless entry gets `**/` prefixed. Trailing slashes are trimmed. Explicit
globs (`**/_*.scss`) are passed through untouched.

Config entries **add to** the built-in ignore list above; they cannot shrink it,
so `node_modules` and friends stay excluded whatever you write.

When a config loads, the run says so:

```
force-important 0.2.0
config: force-important.json — 2 folders, 2 files
✓ src/app/button.scss
41 scanned, 12 changed
```

### Targeting selectors

By default every declaration in every scanned file is forced. `onlySelectors`
narrows that to rules whose selector contains one of the given substrings —
useful for overriding a component library without touching your own CSS:

```json
{
  "onlySelectors": ["mat-", ".legacy"]
}
```

```scss
// before
.mat-mdc-button { color: red; }
.my-card        { color: blue; }

// after
.mat-mdc-button { color: red !important; }
.my-card        { color: blue; }
```

Plain substring matching, case-sensitive — not a glob or a regex.

**Nesting counts.** `.mat-card { .inner { … } }` compiles to `.mat-card .inner`,
so a match on any *ancestor* selector carries down:

```scss
.mat-card {
  top: 0 !important;              // matched directly
  .inner { left: 0 !important; }  // matched via the ancestor
}
.plain {
  .inner { right: 0; }            // no match anywhere in the chain
}
```

This also means a declaration with **no enclosing selector is never matched** —
a bare `@mixin` body has no knowable final selector, so `onlySelectors` leaves
mixins alone entirely. That sidesteps the `@include`-propagation hazard, but it
does mean styles applied through a mixin won't be forced.

An omitted or empty array means "everything", the default. A pattern that
matches nothing warns:

```
⚠ force-important.json: onlySelectors: "nope-" — matched no selectors
```

### When it refuses to run

Because the tool rewrites files in place with no undo, a config it cannot
understand aborts with exit `1` before touching anything:

| Config | Result |
| --- | --- |
| Malformed JSON | `✗ invalid JSON — …`, exit 1 |
| Not a JSON object at the top level | `✗ expected a JSON object …`, exit 1 |
| `ignoreFolders` / `ignoreFiles` / `onlySelectors` not an array of strings | `✗ "…" must be an array of strings`, exit 1 |
| A file listed in `ignoreFolders` | `✗ … is a file — move it to ignoreFiles`, exit 1 |
| A folder listed in `ignoreFiles` | `✗ … is a directory — move it to ignoreFolders`, exit 1 |

These only warn, and the run continues:

| Config | Result |
| --- | --- |
| An unknown key | `⚠ unknown key "…" — ignored` |
| A folder that does not exist | `⚠ ignoreFolders: "…" — no such directory` |
| A plain filename matching nothing | `⚠ ignoreFiles: "…" — matched no files` |

An explicit glob that matches nothing is silent, since a glob may legitimately
match nothing today.

## Dev only

Exits immediately with code `0` when `NODE_ENV=production`.

## Install

```bash
npx force-important               # no install
npm i -D force-important          # or as a dev dependency
```

## Releasing

Publishing is done by `.github/workflows/publish.yml`, triggered by hand — there
are no release tags and no GitHub Releases involved.

```bash
gh workflow run publish.yml
```

Or: Actions tab → **Publish** → **Run workflow**.

The job runs `npm ci`, then the full test suite, then
`npm publish --provenance --access public`. A failing test aborts it, so a
broken build cannot reach the registry.

The version comes from `package.json`, so **bump it before every run** — npm
rejects republishing a version that already exists:

```bash
npm version patch --no-git-tag-version   # or minor / major
git commit -am "0.1.1"
git push
gh workflow run publish.yml
```

### Setup

One repository secret is required: `NPM_TOKEN`.

It must be a **Classic → Automation** token from npmjs.com → Access Tokens, or a
Granular token with **Bypass 2FA** enabled and write access to the package.
A Classic *Publish* token will not work — CI cannot answer a 2FA prompt, and the
registry rejects it with `E403 … two-factor authentication … is required`.

```bash
gh secret set NPM_TOKEN
```

`--access public` is required alongside `--provenance` for a package the
registry has not seen before; without it npm fails with
`EUSAGE … you must set access to public`.

## Known limitations

**Null-valued declarations produce invalid CSS.** Sass omits a declaration whose
value is `null`, but `!important` makes the value non-null, so Sass emits an
empty declaration instead of dropping it:

```scss
$maybe: null;
.x { font-family: $maybe; }
```

```css
/* before: the declaration is omitted entirely */
/* after:  */
.x { font-family: !important; }
```

That is invalid CSS. Browsers discard the declaration, so nothing that worked
before breaks, but the output is larger and will fail a CSS linter. This is not
detectable from the SCSS: the value is just a variable name, and resolving it
would mean evaluating Sass. Libraries that use `null` defaults heavily are
affected — on Bootstrap 5.3 it produces 73 such declarations across 14
properties. Covered by the `null-value` fixture.

**Sass variable assignments must be skipped, not just `$`-prefixed ones.** With the
Sass module system a variable can be assigned through its namespace:

```scss
sass-utils.$use-system-color-variables: map.get($config, use-system-variables) or false;
```

The prop here starts with `sass-utils.`, not `$`. Appending `!important` does not
mark a declaration important — it changes the *value*, and `false !important` is
truthy in Sass, so every `@if` reading that variable takes the other branch.
Running an earlier version of this tool over Angular Material corrupted exactly
this line and silently switched its whole typography system into
CSS-variable mode, changing 611 lines of compiled CSS. Any prop containing `$`
is now skipped; covered by the `namespaced-variable` fixture.

**Other limitations:**

- Destructive: no backup, no dry run
- `!important` inside a `@mixin` body affects every `@include` site
- Sass maps and `@include` arguments are not declarations and are left alone
- A folder named in `ignoreFolders` that does not exist only warns; the run
  continues, so a typo means the folder you meant to protect is still rewritten
- The config is read from `cwd` only — running the tool from a subfolder will
  not find the project-root config

## Caveat

Blanket `!important` makes specificity irrelevant — source order becomes the
only lever, and a later override needs `!important` *plus* higher specificity.
Inside a `@mixin`, it propagates to every `@include` site. Know what you're
buying before running this across a whole project.

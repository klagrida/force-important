# force-important

Dev-only CLI that adds `!important` to every SCSS declaration in the current folder that doesn't already have it.

```bash
npx force-important
```

One pass, then it exits. **It rewrites files in place, so commit first.**

## What it does

- Scans `**/*.scss` from `process.cwd()`
- Parses with `postcss-scss` (no regex)
- Adds `!important` to declarations that lack it
- Writes a file only if the result differs from the input

Ignored directories: `node_modules`, `dist`, `.git`, `.angular`.

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
| `--custom-props` | `!important` changes their semantics |
| Declarations anywhere inside `@keyframes` | `!important` is invalid there |
| Already `!important` | idempotent |

Declarations inside `@mixin` bodies, `@media` blocks, nested rules, and nested
property blocks (`font: { … }`) **are** modified. For nested properties that
means `font: { family: serif !important; }`, which Sass compiles to the valid
`font-family: serif !important`.

## Output

```
✓ src/button.scss
✗ src/broken.scss — Unclosed block
12 scanned, 1 changed, 1 failed
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

## Dev only

Exits immediately with code `0` when `NODE_ENV=production`.

## Install

```bash
npx force-important               # no install
npm i -D force-important          # or as a dev dependency
```

## Caveat

Blanket `!important` makes specificity irrelevant — source order becomes the
only lever, and a later override needs `!important` *plus* higher specificity.
Inside a `@mixin`, it propagates to every `@include` site. Know what you're
buying before running this across a whole project.

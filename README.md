# force-important

Dev-only CLI that adds `!important` to every SCSS declaration in the current folder that doesn't already have it.

```bash
npx force-important          # one pass
npx force-important --watch  # re-run on file changes
```

## What it does

- Scans `**/*.scss` from `process.cwd()`
- Parses with `postcss-scss` (no regex)
- Adds `!important` to declarations that lack it
- **Rewrites files in place**, so commit first

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
| `@keyframes` declarations | `!important` is invalid there |
| Nested props (`font: { ... }`) | parent has no value |
| Already `!important` | idempotent |

Declarations inside `@mixin` bodies **are** modified.

## Dev only

Exits immediately when `NODE_ENV=production`.

## Install

```bash
npx force-important               # no install
npm i -D force-important          # or as a dev dependency
```

```json
{ "scripts": { "important": "force-important --watch" } }
```

## Requirements

Node 18+.

## License

MIT
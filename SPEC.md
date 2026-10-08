# force-important: Spec

## Goal

A dev-mode CLI, run with `npx`, that ensures every SCSS declaration in the current project carries `!important`.

## Non-goals

- Processing `node_modules` or build output
- Being a build-time plugin (Vite/webpack/Sass importer)
- Removing `!important`
- Configurable rules (v0.x)

## CLI

```
force-important [--watch]
```

| Flag | Behavior |
| --- | --- |
| *(none)* | Single pass, then exit |
| `--watch` | Single pass, then watch for `add` / `change` |

Exit codes: `0` success (or skipped in production), `1` unexpected error.

## Behavior

1. If `NODE_ENV === 'production'`, exit `0` without touching anything.
2. Root is `process.cwd()`.
3. Match `**/*.scss`, excluding `**/node_modules/**`, `**/dist/**`, `**/.git/**`, `**/.angular/**`.
4. For each file: parse with `postcss-scss`, apply the transform, stringify.
5. Write back **only if the output differs** from the input.
6. Log `✓ <file>` per modified file; in single-pass mode, log a final `Done: N files scanned`.

## Transform rules

A declaration gets `important = true` unless one of these holds:

| Condition | Check |
| --- | --- |
| Already important | `decl.important` |
| SCSS variable | `prop` starts with `$` |
| CSS custom property | `prop` starts with `--` |
| Nested property block | `decl.isNested` |
| Inside keyframes | grandparent at-rule name ends with `keyframes` |

Everything else, including declarations in `@mixin` bodies, `@media`, and nested rules, is modified.

## Properties

- **Idempotent:** running twice yields the same result as running once.
- **Watch-safe:** the in-place write triggers `change`, the second pass is a no-op, and there is no loop.
- **Formatting-preserving:** postcss keeps whitespace and comments.

## Dependencies

| Package | Use |
| --- | --- |
| `postcss` | AST + plugin API |
| `postcss-scss` | SCSS syntax parser/stringifier |
| `fast-glob` | one-shot file discovery |
| `chokidar` | watch mode |

Runtime: Node 18+, ESM only.

## Layout

```
force-important/
├── cli.mjs        # entry (shebang), plugin + runner
├── package.json   # "bin": { "force-important": "./cli.mjs" }
├── README.md
└── SPEC.md
```

## Known limitations

- Destructive: no backup, no dry run
- `!important` inside `@mixin` bodies affects every `@include` site
- Sass maps and `@include` arguments are not declarations and are left alone
- Ignore list is hardcoded

## Future (not in scope)

- `--dry-run`, `--ignore <glob>`, `--out <dir>`
- `.force-importantrc` config
- PostCSS plugin export for build-time use
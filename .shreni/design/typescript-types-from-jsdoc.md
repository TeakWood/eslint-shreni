# TypeScript types for ESLint, from JSDoc in the sources

Tracking issue: `eslint-shreni-beads-y6r`

## The problem with the previous approach

ESLint used to ship hand-authored `.d.ts` files under `lib/types/`. Those files
were a second, parallel description of the implementation, maintained by hand,
with nothing mechanically tying the two together. Nothing failed when a
signature in `lib/` changed and the declaration did not. Drift was not a risk;
it was the steady state.

## The approach here

Types live in the JavaScript sources as JSDoc annotations, and `.d.ts` files
are **generated** from them:

```
lib/**/*.js  --(tsc --allowJs --declaration --emitDeclarationOnly)-->  dist/types/**/*.d.ts
```

A declaration cannot drift from its implementation because there is no
declaration to drift — only an output. The same annotations that produce the
declarations also type-check the source that carries them, so a wrong
annotation is a build failure rather than a silent lie to consumers.

## Goals

1. A TypeScript application developer using ESLint programmatically
   (`new ESLint()`, `lintFiles`, `Linter#verify`) gets real types rather than
   casting to `any`.
2. A plugin or custom-rule author writes rules in TypeScript against real
   `Rule`, `RuleContext`, `RuleModule` and `SourceCode` types.
3. A config author writes `eslint.config.ts` and gets autocomplete and
   type-checking on rule names and rule options.
4. An ESLint maintainer gets compiler-verified refactoring across `lib/`.

## Design decisions

### `strict: true` from the first commit

Not "start loose and tighten later". Loosening is a one-line config change;
tightening after 380 files have been annotated against a permissive compiler is
a rewrite. The cost of strictness is paid per file as each file is converted,
which is the only point at which anyone has the context to pay it.

### Per-file opt-in with `// @ts-check`, not repo-wide `checkJs`

`checkJs` is a program-wide switch: turn it on and _every_ `.js` file the
compiler loads is checked, including files pulled in transitively by a
`require()` from a file that has been converted. That makes the conversion
order a hostage to the dependency graph — converting a leaf module would fail
the build on its unconverted dependents' behalf.

So `checkJs` is `false` in `tsconfig.base.json`, and each converted file opts
in with a `// @ts-check` pragma on its first line. Unconverted transitive
dependencies still load (their inferred types flow in and are used), but they
are not themselves checked.

`tsconfig.json`'s `files` array is the allowlist of converted sources.
`tests/lib/types/types.js` enforces that the allowlist and the pragmas agree in
both directions, so neither can drift from the other.

### The shared vocabulary is hand-authored, in-repo, and small

`lib/types/core.d.ts` is the one hand-authored type file. It holds only types
that cross module boundaries and therefore have no single owning module —
`Severity`, `LintMessage`, `LintResult`, `Fix`, and so on. Anything owned by
exactly one module is declared with `@typedef` in that module's own `.js` file
and flows outward through declaration emit.

`@eslint/core` is deliberately **not** adopted. The vocabulary is the one thing
the whole conversion is anchored to; an external package that can change shape
between releases is the wrong place for it.

Every type in `core.d.ts` names, in its doc comment, the implementation site
that produces or consumes it, so the shape can be re-verified against the code
rather than trusted.

### Bottom-up along the dependency graph

Conversion proceeds from leaves inward, not from the public API outward. A
module is annotated only once everything it depends on is annotated, so no
shape is ever asserted before it has been verified against the code that
produces it. Surface-first would mean writing `SourceCode`'s type from the
documentation and hoping.

### Escape hatches are allowed, and must say why

Some code cannot be typed without being rewritten, and rewriting working code
to satisfy the compiler trades a real risk for a cosmetic one. Where an escape
hatch (`any`, a cast, `@ts-expect-error`) is used, it carries an inline comment
beginning `ESCAPE HATCH:` that states what was widened and the specific reason
the precise type is not expressible. A reader should never have to guess
whether an `any` is a decision or an oversight.

## Compatibility

- TypeScript 6.x floor.
- `moduleResolution`: `node16` / `nodenext` and `bundler`.
- Legacy `node10` resolution is **not** supported.

## Scope

In scope: all of `lib/` (381 files, ~96.7k LOC), `packages/js/src`,
`bin/eslint.js`.

Out of scope: `tools/`, `tests/`, `packages/eslint-config-eslint`.

## Phases

| Phase | Contents                                                                                                                              | Status       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 0     | Foundation: `tsconfig.base.json` / `tsconfig.json` / `tsconfig.types.json`, `lib/types/core.d.ts`, CI gate, declaration-emit pipeline | done         |
| 1     | Leaf layer: `lib/shared`, dependency-free `lib/rules/utils`, `lib/cli-engine/hash.js`, `packages/js/src`, `conf`                      | done         |
| 1b    | The `ast-utils` chokepoint: `lib/rules/utils/ast-utils.js` and its dependents (`fix-tracker.js`, `char-source.js`)                    | not started  |
| 2     | L1 layer: token-store, code-path-analysis, `lib/cli-engine`                                                                           | not started  |
| 3–9   | `lib/rules`, L3–L7, packaging, validation, the rule-options generator                                                                 | roadmap only |

### Why `ast-utils` is split out

`lib/rules/utils/ast-utils.js` is 2,962 lines and 137 of its functions take
implicitly-`any` parameters. Annotating those parameters with real ESTree types
is mechanical, but it is not the expensive part: once the parameters have types,
property access on ESTree's node unions starts failing, and each of those
failures is a small judgement about what the function actually accepts. It is
its own unit of work, and it blocks `fix-tracker.js` and `char-source.js`, which
is why those two are not in the Phase 1 allowlist despite being small.

## Commands

| Command                              | What it does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `npm run lint:types`                 | Type-check the allowlist. Also run by `npm run lint`. |
| `npm run build:types`                | Generate `.d.ts` into `dist/types` (gitignored).      |
| `npx mocha tests/lib/types/types.js` | Test the pipeline itself.                             |

## How to convert a file

1. Add `// @ts-check` as the file's first line.
2. Add the path to `files` in `tsconfig.json`, keeping the section order.
3. Run `npm run lint:types` and annotate until it is clean.
4. Prefer a module-local `@typedef` over adding to `core.d.ts`. Add to
   `core.d.ts` only when a second module needs the same type.
5. Where an escape hatch is unavoidable, write the `ESCAPE HATCH:` comment.

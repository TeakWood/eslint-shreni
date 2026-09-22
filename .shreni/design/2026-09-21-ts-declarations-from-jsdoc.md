---
title: First-party TypeScript declarations via JSDoc annotations
status: superseded
date: 2026-09-21
superseded-by: 2026-09-22-rules-annotation-resplit.md
epic: eslint-shreni-beads-yd9
---

# First-party TypeScript declarations via JSDoc annotations

## Context

This fork of ESLint ships a pure-JavaScript codebase. Consumers — plugin authors,
internal contributors, and end users — currently receive no type information when
importing the package. The JSDoc in the sources has descriptions but no type
annotations. The baseline was explicitly cleaned of all prior types to allow a
from-scratch, first-principles TS conversion rather than inheriting a partial or
inconsistent prior state.

## Decision

Use TypeScript's `checkJs` + `emitDeclarationOnly` pipeline. The sources remain
`.js`; tsc reads JSDoc type annotations and emits `.d.ts` files to `dist/types/`.
The runtime CJS output is unchanged.

**`tsconfig.json` at the repo root:**

```jsonc
{
	"compilerOptions": {
		"allowJs": true,
		"checkJs": false, // see "Per-file opt-in" below — NOT whole-program
		"strict": true,
		"declaration": true,
		"emitDeclarationOnly": true,
		"outDir": "dist/types",
		"skipLibCheck": true,
	},
	"include": [
		"lib/shared/**/*.js",
		"lib/config/**/*.js",
		"lib/rules/utils/**/*.js",
	], // expanded bead-by-bead
}
```

Two new npm scripts:

- `lint:types` — `tsc --noEmit` (type-check without emitting; run in CI and dev)
- `build:types` — `tsc` (emit `.d.ts` to `dist/types/`; run before publish)

Both run through `tools/lint-types.js`, a thin wrapper that suppresses TS18003
("No inputs were found") so the gate stays green while `include` is still narrow.
Each annotation bead expands `include` to cover its module group, so
`pnpm lint:types` stays green after every individual merge.

### Per-file opt-in: `checkJs: false` plus `// @ts-check`

This supersedes the `checkJs: true` originally recorded in this ADR. The
whole-program form is not merely inconvenient, it is unachievable mid-rollout:
`include` does **not** bound what tsc type-checks. Every module reached by a
`require()` from an included file joins the program and is checked, so narrowing
`include` does not narrow checking. Flipping `checkJs` back to `true` today
yields **4638 diagnostics**, dominated by 3774 `TS7006` (implicit `any`
parameter), because `lib/config` transitively pulls in `lib/rules`,
`lib/languages/js` and `lib/services` regardless of `include`.

The sanctioned lever is therefore per-file: `checkJs: false` globally, with each
annotated file opting in via a `// @ts-check` directive on its first line. This
did not bite on `lib/shared` (a leaf), which is why it surfaced only once
`lib/config` landed.

`skipLibCheck: true` is likewise required rather than cosmetic: once `lib/config`
widened the program, `@eslint-community/eslint-utils`'s bundled `.d.ts` imports
types from `eslint` — which this fork no longer ships — producing `TS7016` inside
`node_modules`. Expect the same from any bead that pulls in more of the
dependency graph.

**The failure mode this introduces:** a file inside `include` that lacks
`// @ts-check` is still compiled and still emits a `.d.ts`, so every
declaration-coverage assertion keeps passing while the file goes silently
unchecked. `tests/tools/lint-types.js` closes that hole with a test that reads
every source matched by `include` and asserts the directive is present. Any bead
that widens `include` inherits that guard automatically.

## Approach: central type hub at `lib/shared/types.js`

A new file `lib/shared/types.js` holds `@typedef` declarations for all core public
shapes: `LintResult`, `LintMessage`, `LintMessageType`, `SuppressedLintMessage`,
`RuleModule`, `RuleContext`, `RuleFixer`, `EditInfo`, `DeprecatedRuleInfo`. All
other modules import from this file with `@type {import('./types.js').Foo}`.

Centralising typedefs here avoids the circular-import problem: modules that
mutually `require()` each other (e.g. `lib/eslint/eslint.js` ↔
`lib/eslint/eslint-helpers.js`) would create circular type references if typedefs
were inlined in class files.

## Consumer compatibility

The `package.json` exports map gains a `"types"` condition on all four public
entries once all sources are annotated:

```jsonc
{
	".": { "types": "./dist/types/api.d.ts", "default": "./lib/api.js" },
	"./config": {
		"types": "./dist/types/config-api.d.ts",
		"default": "./lib/config-api.js",
	},
	"./universal": {
		"types": "./dist/types/universal.d.ts",
		"default": "./lib/universal.js",
	},
	"./use-at-your-own-risk": {
		"types": "./dist/types/unsupported-api.d.ts",
		"default": "./lib/unsupported-api.js",
	},
}
```

A probe package at `tests/types/index.ts` imports all four entry points and
exercises the key types; it is run under TS 5.x and TS 6.x in CI via a dedicated
`typecheck` job in `.github/workflows/ci.yml`.

## Annotation conventions

- **Every file added to `include` must carry `// @ts-check` on its first line.**
  Without it the file is compiled but not checked, and no other gate notices.
- `@typedef` declarations live in `lib/shared/types.js`; cross-file references use
  `@type {import('../shared/types.js').TypeName}`.
- `@param` and `@returns` annotations are required wherever tsc cannot infer the
  type from the surrounding JS.
- `// @ts-ignore` with an explanatory comment is acceptable only where tsc cannot
  express a valid invariant (expected in `lib/linter/code-path-analysis/` and the
  4 monster rule files).
- Each annotation bead's PR must leave `pnpm lint:types`, `pnpm lint`, and
  `pnpm test` all green — independently mergeable.

### Lint does not check types — only tsc does

`jsdoc/check-types`, `jsdoc/require-param-type`, `jsdoc/require-returns-type` and
`jsdoc/no-undefined-types` are all disabled in
`packages/eslint-config-eslint/base.js` (deliberately, for the type-free
baseline). The lint gate therefore applies **zero** pressure toward correct
types; `pnpm lint:types` is the only thing checking them. Two lint constraints do
still bite while annotating:

- `jsdoc/tag-lines` is `"never"` with `startLines: 0` — no blank lines anywhere
  inside a JSDoc block.
- `TS8032` forbids `@param options.foo` sub-tags unless the parent is typed
  literally as `{Object}` rather than as a named typedef.

### The rules layer needs its own node type

`lib/shared/types.js` defines `ASTNode` as `import("estree").Node`, which suits
`lib/shared` and `lib/config` because they only ever read `type` and walk visitor
keys. It does **not** suit the rules layer. The tree a rule receives is not the
bare ESTree union: the linter links every node to its `parent` and always
populates `range` and `loc`, `Literal` carries `regex` and `bigint` as one node
type rather than three, and third-party parsers feed in node types ESTree does
not describe at all (JSX, and the TypeScript nodes `ast-utils.js` already matches
on by name). Annotating `ast-utils.js` against the ESTree union produced 142
errors, 79 of them `TS2339` on properties that are genuinely there at runtime.

So Cru (`ozv`) introduces the rules-layer vocabulary in
`lib/rules/utils/ast-utils.js` itself — `ASTNode`, `Token` and `Comment`, each an
object type that pins the fields which hold for every node or token the linter
hands to a rule and leaves type-specific fields open via an index signature. Rule
files reference them as `import("./utils/ast-utils.js").ASTNode`. This is the
only place in the annotated tree where an index signature is used, and it is a
deliberate trade: narrowing the ESTree union would mean a cast at nearly every
property read here _and_ at every call site in the 289 rule files downstream,
without making a single one of those reads safer.

### Type-checking alone is not sufficient verification

`tsc --noEmit` cannot see a lost `this` binding. During C2 a refactor in
`lib/shared/traverser.js` hoisted `this._enter` into a local to satisfy a
non-null check, which dropped the receiver and crashed `npx eslint` on the repo's
own source — while the type gate stayed fully green. Any bead touching callback
dispatch must run `pnpm test` and lint the repo with its own build, not just the
type gate.

## Delivery sequence (bead dependency order)

```
C1 (pipeline) → C2 (shared) → C3 (config) ──→ C5 (linter) → C7 (eslint+services) → C9 (rule-tester) ──┐
                             ↓              ↑                                                            │
                             C4 (languages)─┘              C8 (cli-engine) ──────────────────────────── ┤
                C2 ──────────────────────────────────────→ C6 (code-path-analysis) [parallel]           │
                                                                                                         │
                C2 → Cru (rules/utils) ─┬→ Cr1 (rules batch1: accessor-pairs→new-parens, 73 files) ────┤
                                        ├→ Cr2 (rules batch2: newline-after-var→no-multi-spaces, 73)   ─┤
                                        ├→ Cr3 (rules batch3: no-multi-str→no-useless-catch, 73) ───── ─┤
                                        ├→ Cr4 (rules batch4: no-useless-computed-key→yoda, 70) ──────  ┤
                                        └→ Crm (rules monsters: indent×2, no-extra-parens, no-unused-vars) ┤
                                                                                                         ↓
                                                                              C15 (entry points + exports)
                                                                                                         ↓
                                                                              C16 (probe + CI gate)
```

Bead IDs:

- C1 `v7i`, C2 `k6g`, C3 `x04`, C4 `58n`, C5 `2ya`, C6 `08i`
- C7 `052`, C8 `0sf`, C9 `qs6`
- Cru `ozv`, Cr1 `7cu`, Cr2 `eft`, Cr3 `e6b`, Cr4 `9z0`, Crm `7qe`
- C15 `zye`, C16 `2oz`

The rules sub-tree (Cru + Cr1–Cr4 + Crm) runs in parallel with the main
annotation chain after C2 merges. Cr1–Cr4 and Crm all run in parallel with
each other once Cru is merged.

## Rollout status

Annotation coverage is measured by `tsconfig.json`'s `include`, and is
authoritative — a subtree is done when its files are included **and** carry
`// @ts-check`. As of Cru (`ozv`): **37 of 389 `lib/**/*.js` files** are covered.

| Bead      | Scope                                        | Files | Status |
| --------- | -------------------------------------------- | ----- | ------ |
| C1 `v7i`  | tsc pipeline, `tools/lint-types.js`, scripts | —     | landed |
| C2 `k6g`  | `lib/shared` + `types.js` hub                | 20    | landed |
| C3 `x04`  | `lib/config`                                 | 5     | landed |
| C4 `58n`  | `lib/languages`                              | 17    | open   |
| C5 `2ya`  | `lib/linter` (excl. code-path-analysis)      | 13    | open   |
| C6 `08i`  | `lib/linter/code-path-analysis`              | 7     | open   |
| C7 `052`  | `lib/eslint` + `lib/services`                | 8     | open   |
| C8 `0sf`  | `lib/cli-engine`                             | 6     | open   |
| C9 `qs6`  | `lib/rule-tester`                            | 2     | open   |
| Cru `ozv` | `lib/rules/utils`                            | 12    | landed |
| Cr1–Cr4   | `lib/rules` batches                          | 289   | open   |
| Crm `7qe` | 4 monster rule files (7158 lines total)      | 4     | open   |
| C15 `zye` | entry points + `types` exports               | 6     | open   |
| C16 `2oz` | probe package + CI gate                      | —     | open   |

The `types` conditions in the exports map (C15) and the probe package (C16) are
deliberately **not** wired up yet: pointing `types` at `dist/types/*.d.ts` before
the entry points are annotated would ship broken declarations to consumers. The
exports map stays `default`-only until C15.

## Epic tracking (`yd9`) — do not implement directly

`yd9` is a **tracking parent only**. All work lives in the 17 child beads above;
the epic carries no implementable body of its own and closes when they close.

Beads does not let an epic be blocked by its own children, so `yd9` keeps
appearing in `bd ready` and has been dispatched for implementation in error.
Anyone (human or agent) picking it up should implement the next ready **child**
instead. Attempting the epic as one unit means annotating 364 files — including
`indent.js` (2318 lines), `code-path-state.js` (2277), `ast-utils.js` (2962) and
`no-unused-vars.js` (1826) — in a single unreviewable change, and would collide
with every open child bead.

## Alternatives considered

**Handwritten `.d.ts` files.** Rejected. Would drift from the JS implementation
over time; every public API change requires a matching manual update to the `.d.ts`.

**Convert sources to `.ts`.** Out of scope for this decision. This ADR sets the
type contract so that an incremental `.js` → `.ts` file-by-file migration can
happen later without breaking consumers. That migration is a separate epic.

**Publish via `@types/eslint` community package only.** The fork diverges from
upstream; a community `@types` package would cover the wrong API surface and
would not be maintained by this project.

## Risks and mitigations

| Risk                                                                                                                                     | Mitigation                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `lib/linter/code-path-analysis/code-path-state.js` (2,277 lines, complex state machine) surfaces many implicit `any` under `strict:true` | Isolated in its own bead (C6 `08i`); `@ts-ignore` with comment is permitted here          |
| 4 monster rule files (indent 2318, no-unused-vars 1826, no-extra-parens 1657, indent-legacy 1357) need deep internal annotation          | Isolated in their own bead (Crm `7qe`); reviewed independently from the 4 uniform batches |
| `lib/rules/utils/ast-utils.js` (2,962 lines) is a shared dependency for all rules                                                        | Extracted into its own bead (Cru `ozv`) that must merge before any rule batch starts      |
| TS 5.x compat: TS 6 syntax may not round-trip to TS 5                                                                                    | Probe package CI check runs both; catches before merge                                    |
| Rules annotation pattern unclear until `lib/shared/types.js` is defined                                                                  | C2 delivers `RuleModule` typedef before Cru starts; validate against a sample in C2       |

## Open questions

1. Whether rule annotation requires only `@type {RuleModule}` on each export (if
   tsc infers the rest), or whether deep internal `@param` annotation is also
   needed. To be resolved during Cru (`ozv`) by validating against a sample before
   the rule batches start.
2. Whether any `require()` patterns in `lib/eslint/eslint-helpers.js` trigger
   module-resolution errors under `"moduleResolution": "node16"`. To be diagnosed
   during C7 (`052`).

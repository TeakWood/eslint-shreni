---
title: First-party TypeScript declarations via JSDoc annotations
status: accepted
date: 2026-09-21
superseded-by:
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
    "checkJs": true,
    "strict": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "dist/types",
    "moduleResolution": "node16",
    "target": "ES2022"
  },
  "include": []   // expanded bead-by-bead as modules are annotated
}
```

Two new npm scripts:
- `lint:types` — `tsc --noEmit` (type-check without emitting; run in CI and dev)
- `build:types` — `tsc` (emit `.d.ts` to `dist/types/`; run before publish)

The `include` array starts empty. Each annotation bead expands it to cover its
module group, so `pnpm lint:types` stays green after every individual merge.

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
  ".":                    { "types": "./dist/types/api.d.ts",           "default": "./lib/api.js" },
  "./config":             { "types": "./dist/types/config-api.d.ts",    "default": "./lib/config-api.js" },
  "./universal":          { "types": "./dist/types/universal.d.ts",     "default": "./lib/universal.js" },
  "./use-at-your-own-risk": { "types": "./dist/types/unsupported-api.d.ts", "default": "./lib/unsupported-api.js" }
}
```

A probe package at `tests/types/index.ts` imports all four entry points and
exercises the key types; it is run under TS 5.x and TS 6.x in CI via a dedicated
`typecheck` job in `.github/workflows/ci.yml`.

## Annotation conventions

- `@typedef` declarations live in `lib/shared/types.js`; cross-file references use
  `@type {import('../shared/types.js').TypeName}`.
- `@param` and `@returns` annotations are required wherever tsc cannot infer the
  type from the surrounding JS.
- `// @ts-ignore` with an explanatory comment is acceptable only where tsc cannot
  express a valid invariant (expected in `lib/linter/code-path-analysis/` and the
  4 monster rule files).
- Each annotation bead's PR must leave `pnpm lint:types`, `pnpm lint`, and
  `pnpm test` all green — independently mergeable.

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

| Risk | Mitigation |
|---|---|
| `lib/linter/code-path-analysis/code-path-state.js` (2,277 lines, complex state machine) surfaces many implicit `any` under `strict:true` | Isolated in its own bead (C6 `08i`); `@ts-ignore` with comment is permitted here |
| 4 monster rule files (indent 2318, no-unused-vars 1826, no-extra-parens 1657, indent-legacy 1357) need deep internal annotation | Isolated in their own bead (Crm `7qe`); reviewed independently from the 4 uniform batches |
| `lib/rules/utils/ast-utils.js` (2,962 lines) is a shared dependency for all rules | Extracted into its own bead (Cru `ozv`) that must merge before any rule batch starts |
| TS 5.x compat: TS 6 syntax may not round-trip to TS 5 | Probe package CI check runs both; catches before merge |
| Rules annotation pattern unclear until `lib/shared/types.js` is defined | C2 delivers `RuleModule` typedef before Cru starts; validate against a sample in C2 |

## Open questions

1. Whether rule annotation requires only `@type {RuleModule}` on each export (if
   tsc infers the rest), or whether deep internal `@param` annotation is also
   needed. To be resolved during Cru (`ozv`) by validating against a sample before
   the rule batches start.
2. Whether any `require()` patterns in `lib/eslint/eslint-helpers.js` trigger
   module-resolution errors under `"moduleResolution": "node16"`. To be diagnosed
   during C7 (`052`).

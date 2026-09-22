---
title: Re-splitting the lib/rules annotation into quota-safe, file-scoped units
status: accepted
date: 2026-09-22
supersedes: eslint-shreni-beads-7qe, 7cu, eft, e6b, 9z0
epic: eslint-shreni-beads-iti
---

# Re-splitting the `lib/rules` annotation into quota-safe, file-scoped units

Companion to [`2026-09-21-ts-declarations-from-jsdoc.md`](./2026-09-21-ts-declarations-from-jsdoc.md),
which owns the annotation conventions. This document owns only the _splitting_
of `lib/rules` and the mechanism that keeps the units independent.

## Context

`lib/rules` holds 293 files — the largest remaining tree in the conversion, and
bigger than every other `lib/` subtree combined.

The first attempt (`7qe`) died 14.4 minutes in on a provider quota reset with
**zero commits**, despite the work being nearly complete. The salvaged branch
(`salvage/7qe-monsters`, commit `912eed0f0`) shows ~450 changed lines per file
and a single `@ts-ignore` across all four monster files. Nothing was wrong with
the work; the problem was **scope without a commit checkpoint inside it**.

The four batch beads that followed (`7cu`, `eft`, `e6b`, `9z0`) were worse, at
roughly 16,000 lines each against `7qe`'s 7,158.

## Decision

Replace all five with **22 units**, sized so a quota interrupt costs at most one
unit:

| Unit        | Scope                                         | Files |
| ----------- | --------------------------------------------- | ----- |
| `.1`        | Spike: verify the include / `@ts-check` split | ≤1    |
| `.2`–`.17`  | 16 alphabetical sub-batches (R01–R16)         | 289   |
| `.18`–`.21` | The four monster files, one bead each         | 4     |
| `.22`       | Flip `include`, arm the completeness gate     | 0     |

Every unit is instructed to **commit per file or small group**, so an interrupt
leaves landed work behind rather than an empty branch.

### The four monsters get their own beads

`indent.js` (2318), `no-unused-vars.js` (1826), `no-extra-parens.js` (1657) and
`indent-legacy.js` (1357). Each produced ~430–490 changed lines in the salvage
branch — comparable to a whole 13-file sub-batch. They are isolated so that one
of them stalling cannot take a batch of unrelated rules down with it.

`indent.js` is the only one with a usable internal seam: three classes
(`IndexMap` at 130, `TokenInfo` at 180, `OffsetStorage` at 243) precede
`module.exports` at 502. Annotate and commit those first, then the `create()`
body. The other three are monolithic `create()` functions whose work lives in
nested helpers; commit at helper boundaries instead.

> `salvage/7qe-monsters` is **sizing evidence only**. It was never verified
> green. Reimplement from the baseline; do not cherry-pick it.

## The mechanism: `// @ts-check` checks, `include` only emits

This is what keeps 20 annotation beads free of shared-file conflicts, so it is
worth stating precisely.

With `checkJs: false`, **program membership does not imply checking**. A file is
type-checked if and only if it carries `// @ts-check`. Therefore an annotation
bead needs **no `tsconfig.json` edit** — which is exactly why 20 beads can run
without serialising on one shared file.

All 293 rule files are already in the tsc program: `lib/config/default-config.js:14`
requires `../rules`, and `lib/rules/index.js` names every rule in a `require()`
call.

### Verified, including the part the bead descriptions get wrong

The child beads say `lib/rules/index.js` "statically enumerates `require()`".
It does not — the requires are **lazy thunks** built for `LazyLoadingRuleMap`:

```js
"accessor-pairs": () => require("./accessor-pairs"),
```

The mechanism holds anyway, because tsc resolves a `require()` with a string
literal **syntactically**, regardless of the enclosing function. Module
membership does not depend on the call ever running. The conclusion is right;
the stated reason is not. Do not "fix" those thunks into eager requires on the
belief that type-checking depends on it, and do not doubt the mechanism on
seeing them.

Confirmed on the baseline with a two-arm probe on `lib/rules/no-debugger.js`,
injecting `/** @type {number} */ const PROBE_ARM = "definitely a string";`:

| Arm         | `// @ts-check` | `tsconfig.json` | `node tools/lint-types.js`              |
| ----------- | -------------- | --------------- | --------------------------------------- |
| A (control) | absent         | untouched       | silent, exit 0                          |
| B           | present        | untouched       | `TS2322` at the probe, plus `TS7006` ×2 |

Arm B's exact output:

```
lib/rules/no-debugger.js(11,7): error TS2322: Type 'string' is not assignable to type 'number'.
lib/rules/no-debugger.js(36,9): error TS7006: Parameter 'context' implicitly has an 'any' type.
lib/rules/no-debugger.js(38,22): error TS7006: Parameter 'node' implicitly has an 'any' type.
```

The directive alone flips checking on, with `include` untouched. Arm A rules out
"it was being checked all along".

### Rule declarations are _already_ emitted

A related claim in the child beads is wrong in a way that matters for `.22`.
`include` does **not** govern emit either: declaration emit covers the whole
program. On the baseline, before any rule file is annotated:

```
$ node tools/lint-types.js --emit && ls dist/types/lib/rules/*.d.ts | wc -l
293
```

So `.22` does **not** "bring 293 files into the emit set" — they are already
there, emitting `create(context: any)` because nothing is annotated yet. What
`.22` actually buys is **quality** of those declarations, and arming the
completeness gate below.

## The completeness gate — and the defect in bead `.22`

`.22` is meant to be the gate: flip `include` to `lib/rules/**/*.js` and let the
existing guard test, _"opts every included source into checking with
`// @ts-check`"_, fail unless all 293 files were annotated. No manifest, no
ratchet.

**That does not work as written, and the failure is silent.**

The guard builds its file list from `CHECKED_DIRECTORIES`, a hardcoded array in
`tests/tools/lint-types.js`. Nothing derives it from `include`; `include` is
only ever read by per-directory "does a pattern exist" assertions. Verified by
mutation — applying `.22`'s instruction exactly (swap `lib/rules/utils/**/*.js`
for `lib/rules/**/*.js`, touch nothing else) with all 293 files unannotated:

```
✔ opts every included source into checking with // @ts-check

1 passing
```

Green. The gate `.22` relies on would have landed **disarmed**, and an
unannotated rule file would still compile and still emit a `.d.ts` — the exact
silent failure the scan exists to prevent.

### Fix, landed with this document

A test, `"walks every directory that 'include' reaches"`, now asserts that every
directory reachable from `include` is covered by a `CHECKED_DIRECTORIES` entry
(itself or an ancestor — the walk recurses, which is why
`lib/linter/code-path-analysis` needs no entry of its own). It passes today and
fails loudly under the mutation above:

```
AssertionError: tsconfig.json 'include' reaches ["lib/rules"], which no
CHECKED_DIRECTORIES entry covers; add the directory there so the // @ts-check
scan below examines it
```

Note `lib/rules/utils` is a _descendant_ of `lib/rules`, not an ancestor, so it
cannot stand in for it.

### What `.22` must therefore do

1. In `tsconfig.json`, replace `"lib/rules/utils/**/*.js"` with
   `"lib/rules/**/*.js"` (the broader glob subsumes it).
2. **In `tests/tools/lint-types.js`, replace the `"lib/rules/utils"` entry in
   `CHECKED_DIRECTORIES` with `"lib/rules"`.** Without this the gate does not
   arm. The new test enforces it, so `.22` cannot land while it is missing.
3. Expect possible `TS4023`-class "cannot be named" errors on first emit and
   resolve them there. That risk is deliberately isolated in `.22`.

Step 2 is _not_ the "`CHECKED_FILES` array" that `.22` prohibits — that
prohibition is about enumerating 293 individual files, which stays unnecessary
because the directory glob covers them. Editing one string in an existing
directory array is the opposite of that.

The 20 annotation beads keep their "MUST NOT modify `tsconfig.json` or
`tests/tools/lint-types.js`" constraint unchanged; it is what keeps them
conflict-free. Only `.22` touches those two files.

## The 22 units partition the tree exactly

Verified by set comparison against the working tree, not by arithmetic:

```
planned entries: 293   unique: 293
actual files:    293
in plan but not on disk: (none)
on disk but not in plan: (none)
duplicated across batches: (none)
```

No gaps, no double-assignment, no phantom files. This matters because `.22` is a
completeness gate: a file omitted from every batch would surface only at the very
end, as an unexplained failure in the last bead of a 22-bead sequence.

`lib/rules/index.js` is deliberately inside R04 (`.5`). It is the rule registry
rather than a rule, but it matches `lib/rules/*.js` and so must carry the
directive for the gate to pass.

## Annotation conventions

Owned by the 2026-09-21 ADR; not restated here. The four that bite hardest in
this tree:

- **`jsdoc/tag-lines` is `"never"` with `startLines: 0`** — no blank lines
  anywhere inside a JSDoc block.
- **`TS8032`** forbids `@param options.foo` sub-tags unless the parent is typed
  literally as `{Object}`, not as a named typedef.
- **A bare `@type` cast on a function-valued const trips
  `jsdoc/require-description`** — add a description line. tsc stays green while
  `pnpm lint` fails, so this is invisible to the type gate.
- **`.c8rc` sets `all: true`**, so a multi-line cast inside an untested function
  costs real coverage points against the 99/98/99/99 thresholds. Prefer
  single-line casts.

Reference the rules-layer vocabulary as
`import("./utils/ast-utils.js").ASTNode` / `.Token` / `.Comment`, **not** the
bare ESTree union. The 2026-09-21 ADR records the measurement behind that: the
ESTree union produces 142 errors on `ast-utils.js` against 53 for the
rules-layer shape.

### Type-checking alone is not sufficient verification

Carried forward from the 2026-09-21 ADR, and it has now bitten twice. `strict`
reports a _missing_ type but never an explicit `any` one, so a lost annotation
leaves `pnpm lint:types` at exit 0 while the emitted declarations rot. Separately,
tsc cannot see a lost `this` binding — hoisting a method into a local to satisfy
a null check silently broke `lib/shared/traverser.js` while the type gate stayed
green.

Run `pnpm lint` and `pnpm test`, not just the type gate.

## Rollout status

| Unit  | Scope                                                        | Files | Status                |
| ----- | ------------------------------------------------------------ | ----- | --------------------- |
| `.1`  | Spike: verify the mechanism                                  | ≤1    | open — see note below |
| `.2`  | R01 `accessor-pairs` → `camelcase` (pilot)                   | 13    | open                  |
| `.3`  | R02 `capitalized-comments` → `dot-notation`                  | 16    | open                  |
| `.4`  | R03 `eol-last` → `id-length`                                 | 18    | open                  |
| `.5`  | R04 `id-match` → `lines-between-class-members`               | 12    | open                  |
| `.6`  | R05 `logical-assignment-operators` → `new-parens`            | 14    | open                  |
| `.7`  | R06 `newline-after-var` → `no-dupe-class-members`            | 28    | open                  |
| `.8`  | R07 `no-dupe-else-if` → `no-global-assign`                   | 22    | open                  |
| `.9`  | R08 `no-implicit-coercion` → `no-misleading-character-class` | 18    | open                  |
| `.10` | R09 `no-mixed-operators` → `no-regex-spaces`                 | 33    | open                  |
| `.11` | R10 `no-restricted-exports` → `no-sync`                      | 18    | open                  |
| `.12` | R11 `no-tabs` → `no-unused-private-class-members`            | 22    | open                  |
| `.13` | R12 `no-use-before-define` → `no-whitespace-before-property` | 15    | open                  |
| `.14` | R13 `no-with` → `padding-line-between-statements`            | 12    | open                  |
| `.15` | R14 `prefer-arrow-callback` → `prefer-template`              | 14    | open                  |
| `.16` | R15 `preserve-caught-error` → `sort-imports`                 | 13    | open                  |
| `.17` | R16 `sort-keys` → `yoda`                                     | 21    | open                  |
| `.18` | `indent.js`                                                  | 1     | open                  |
| `.19` | `no-unused-vars.js`                                          | 1     | open                  |
| `.20` | `no-extra-parens.js`                                         | 1     | open                  |
| `.21` | `indent-legacy.js`                                           | 1     | open                  |
| `.22` | Flip `include`, arm the gate                                 | 0     | open                  |

`.2` (R01) is the **pilot**: it calibrates the remaining 19 by recording actual
changed lines against the ~700 estimate, plus any annotation pattern worth
applying uniformly. If the pilot lands far off estimate, resize the rest before
running them.

### On the `.1` spike

`.1` asks for exactly the probe reproduced above, and its other two questions are
also settled here: `include` has no `lib/rules/*.js` entry beyond
`lib/rules/utils/**`, and `CHECKED_DIRECTORIES` lists `lib/rules/utils`, not
`lib/rules` — so the guard does not assert over rule files during rollout and
needs no change until `.22`. Whoever picks `.1` up should confirm rather than
re-derive, and can go straight to R01 if it reproduces.

## Epic tracking (`iti`) — do not implement directly

The epic carries no implementable body. It closes when its children close.
Anyone picking up `iti` should implement the next ready **child** instead.

Note that `bd` cannot block an epic on its own tasks, so `iti` will keep
appearing in `bd ready`; the header on its description is the only guard.

## Alternatives considered

**Keep the four 16,000-line batch beads.** Rejected: they are strictly worse
than the `7qe` scope that already failed, on the same failure mode.

**Cherry-pick `salvage/7qe-monsters`.** Rejected: never verified green, and
review would cost more than reimplementation at ~450 lines per file. Retained as
sizing evidence.

**A coverage ratchet or explicit file manifest.** Rejected as unnecessary: the
directory glob plus the `CHECKED_DIRECTORIES` link (now enforced by test) gives
the same completeness guarantee with nothing to keep in sync.

**One bead per file (293 units).** Rejected: the per-bead overhead — branch,
review, gates at ~5 minutes of `pnpm test` each — would dominate the actual work.

## Risks

**A batch stalls mid-way.** Mitigated by the commit-per-file instruction; a
partial batch leaves landed, green work and the remainder is re-runnable.

**Annotating `ast-utils.js` consumers surfaces a downstream wave.** Precedent
from the `lib/languages` bead, where sharpening `SourceCode`'s token getters
produced 29 nullability errors in `ast-utils.js`. `lib/rules/utils` is already
annotated, so the rules layer should be insulated — but a batch that hits an
unexpected wave should report it rather than widen types to silence it.

**`TS4023` on first emit at `.22`.** Deliberately isolated in that bead.

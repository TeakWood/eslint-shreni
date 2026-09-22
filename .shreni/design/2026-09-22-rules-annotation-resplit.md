---
title: lib/rules annotation re-split into quota-safe, file-scoped units
status: accepted
date: 2026-09-22
superseded-by:
epic: eslint-shreni-beads-iti
---

# lib/rules annotation re-split into quota-safe, file-scoped units

Supersedes [2026-09-21-ts-declarations-from-jsdoc.md](./2026-09-21-ts-declarations-from-jsdoc.md).

The core decision recorded there is unchanged and still in force: `checkJs: false` +
`emitDeclarationOnly`, per-file `// @ts-check` opt-in, the central typedef hub at
`lib/shared/types.js`, and the rules-layer `ASTNode`/`Token`/`Comment` vocabulary in
`lib/rules/utils/ast-utils.js`. What this ADR changes is the **delivery model for
`lib/rules/`**: how that subtree is carved into beads, and what the coverage ledger is.

## Context

`eslint-shreni-beads-7qe` — "annotate the 4 monster rule files" — failed with:

```
silpi: agent returned error — You've hit your session limit · resets 6am (Asia/Calcutta)
```

14.4 minutes in, **with zero commits**. The uncommitted work was salvaged by hand to
`salvage/7qe-monsters` (`912eed0f0`), and that branch is the most useful artefact the
failure produced, because it shows the work was nearly done:

| File                          | Lines | Changed in salvage | `@ts-ignore` |
| ----------------------------- | ----- | ------------------ | ------------ |
| `lib/rules/indent.js`         | 2318  | 431                | 1            |
| `lib/rules/no-unused-vars.js` | 1826  | 441                | 0            |
| `lib/rules/no-extra-parens.js`| 1657  | 487                | 0            |
| `lib/rules/indent-legacy.js`  | 1357  | 468                | 0            |

The 2026-09-21 ADR predicted these four would need heavy escape hatches ("`@ts-ignore`
with comment is permitted here"). They needed **one**, in `indent.js`. The annotation
itself was not the problem.

The problem was that 7,158 lines of scope contained **no commit checkpoint**, so a
provider quota wall destroyed all of it. And `7qe` was not the worst offender — it was
the bead singled out as the risky one. The four sibling batch beads were larger:

| Bead  | Scope                                        | Files | Lines   |
| ----- | -------------------------------------------- | ----- | ------- |
| `7cu` | rules batch 1, `accessor-pairs` → `new-parens` | 73  | ~16,000 |
| `eft` | rules batch 2, `newline-after-var` → `no-multi-spaces` | 73 | ~16,000 |
| `e6b` | rules batch 3, `no-multi-str` → `no-useless-catch` | 73 | ~16,000 |
| `9z0` | rules batch 4, `no-useless-computed-key` → `yoda` | 70 | ~15,500 |
| `7qe` | the 4 monsters                                | 4     | 7,158   |

`lib/rules/*.js` is 293 files and 70,681 lines in total, with a median rule of 179 lines
and a 10× spread in file size. Sizing by **file count** — which is what the original five
beads did — is therefore close to meaningless.

## Decision

### 1. `include` selects the emit set; `// @ts-check` selects the check set

The 2026-09-21 ADR treats `tsconfig.json`'s `include` as the coverage ledger:

> Annotation coverage is measured by `tsconfig.json`'s `include`, and is authoritative —
> a subtree is done when its files are included **and** carry `// @ts-check`.

For `lib/rules/` that conflates two mechanisms that are in fact independent:

- `lib/config/default-config.js:14` does `require("../rules")`.
- `lib/rules/index.js:13` statically enumerates `() => require("./accessor-pairs")` and
  one such entry for every one of the 293 rules. tsc resolves those `require()` calls
  statically even though they sit inside arrow functions.
- `lib/config/**/*.js` is already in `include`.

**Therefore every rule file is already in the tsc program**, and has been since `C3`
landed. This is the same transitive-program behaviour the prior ADR discovered the hard
way — flipping `checkJs: true` yielded 4,638 diagnostics precisely because `lib/config`
drags in `lib/rules`, `lib/languages/js` and `lib/services` regardless of `include`.

Under `checkJs: false`, program membership does not imply checking. `// @ts-check` does.
So the two axes are:

|                | governed by      | effect                                    |
| -------------- | ---------------- | ----------------------------------------- |
| **check set**  | `// @ts-check`   | what `pnpm lint:types` verifies           |
| **emit set**   | `include`        | which `.d.ts` land in `dist/types/`       |

During the `lib/rules/` rollout, **`include` needs no edit at all.** A bead that adds
`// @ts-check` and annotations to its own files is verified by `pnpm lint:types`
immediately, with no shared-file change. Emit for rules is not needed until `C15`
(`zye`) wires the `types` conditions, so it is deferred to a single final bead.

### 2. Consequence: the annotation beads touch zero shared files

This is the property that makes the re-split viable. Each of the 20 annotation beads owns
a disjoint set of rule files and nothing else. They can run in any order, concurrently,
without rebase conflicts.

The salvage branch shows what the alternative costs. It added a `CHECKED_FILES` array
naming the 4 monsters to `tsconfig.json`'s `include`, **and** mirrored that array into
`tests/tools/lint-types.js` with a new assertion:

```js
const CHECKED_FILES = [
	"lib/rules/indent.js",
	"lib/rules/indent-legacy.js",
	"lib/rules/no-extra-parens.js",
	"lib/rules/no-unused-vars.js",
];
```

That is tolerable for 4 files and one bead. At 289 files across 20 beads it is a
289-entry list duplicated in two files, every bead editing both — guaranteed permanent
conflict. It is not carried forward.

Each annotation bead's acceptance criteria state explicitly: **must not modify
`tsconfig.json` or `tests/tools/lint-types.js`.** The no-contention property is an
enforced constraint, not an assumption about how the work will happen to be done.

### 3. The completion gate falls out of the existing guard

`tests/tools/lint-types.js` already contains a test — *"opts every included source into
checking with `// @ts-check`"* — that reads every source matched by `include` and asserts
the directive is present. It exists to close the failure mode where a file inside
`include` is compiled and emits a `.d.ts` while silently going unchecked.

During the rollout that guard is untouched, because rules are not in `include`.

The final bead (`iti.22`) replaces the `lib/rules/utils/**/*.js` entry with
`lib/rules/**/*.js`. From that moment the existing guard asserts over all 293 rule files —
and **fails unless every one of them carries `// @ts-check`**.

So the last bead cannot land while any earlier bead is incomplete. No manifest file, no
coverage ratchet, no counter to maintain, and nothing for a bead to forget to update. The
completeness check is a consequence of the design rather than an addition to it.

### 4. Sizing by lines, not files

Sub-batches are contiguous alphabetical ranges of `lib/rules/*.js` (excluding the four
monsters) balanced to **~3,800 source lines** each. Against the salvage's observed ~19%
change ratio that is roughly 700 changed lines per bead. File counts fall out at 12–33
per batch precisely because they are not the thing being balanced.

The four monsters get one bead per file. This is the finest granularity available without
a runtime refactor — see *Alternatives*.

## Delivery sequence

```
iti.1  (mechanism spike)
   │
   ▼
iti.2  R01 pilot — accessor-pairs → camelcase
   │
   ├──────────────┬──────────────┐
   ▼              ▼              ▼
iti.3 … iti.17  iti.18 … iti.21  (all parallel, no shared files)
  R02–R16        M1–M4
   │              │
   └──────┬───────┘
          ▼
      iti.22  flip include → lib/rules/**/*.js
          ▼
      zye (C15) ──► 2oz (C16)
```

41 dependency edges. A pilot sits between the spike and the fan-out for two reasons:
it exercises the mechanism on a real multi-file range before 19 beads commit to it, and
it reports actual changed lines against the ~700 estimate so the remainder can be resized
before they run.

### Beads

| Id       | Scope                                                   | Files | Lines |
| -------- | ------------------------------------------------------- | ----- | ----- |
| `iti.1`  | mechanism spike — verify `@ts-check` without `include`   | —     | —     |
| `iti.2`  | R01 **pilot** `accessor-pairs` → `camelcase`             | 13    | 3874  |
| `iti.3`  | R02 `capitalized-comments` → `dot-notation`              | 16    | 3842  |
| `iti.4`  | R03 `eol-last` → `id-length`                             | 18    | 3814  |
| `iti.5`  | R04 `id-match` → `lines-between-class-members`           | 12    | 4072  |
| `iti.6`  | R05 `logical-assignment-operators` → `new-parens`        | 14    | 3884  |
| `iti.7`  | R06 `newline-after-var` → `no-dupe-class-members`        | 28    | 3886  |
| `iti.8`  | R07 `no-dupe-else-if` → `no-global-assign`               | 22    | 3870  |
| `iti.9`  | R08 `no-implicit-coercion` → `no-misleading-character-class` | 18 | 4030 |
| `iti.10` | R09 `no-mixed-operators` → `no-regex-spaces`             | 33    | 3889  |
| `iti.11` | R10 `no-restricted-exports` → `no-sync`                  | 18    | 3834  |
| `iti.12` | R11 `no-tabs` → `no-unused-private-class-members`        | 22    | 3983  |
| `iti.13` | R12 `no-use-before-define` → `no-whitespace-before-property` | 15 | 3835 |
| `iti.14` | R13 `no-with` → `padding-line-between-statements`        | 12    | 4114  |
| `iti.15` | R14 `prefer-arrow-callback` → `prefer-template`          | 14    | 3888  |
| `iti.16` | R15 `preserve-caught-error` → `sort-imports`             | 13    | 4076  |
| `iti.17` | R16 `sort-keys` → `yoda`                                 | 21    | 4632  |
| `iti.18` | M1 `indent.js`                                           | 1     | 2318  |
| `iti.19` | M2 `no-unused-vars.js`                                   | 1     | 1826  |
| `iti.20` | M3 `no-extra-parens.js`                                  | 1     | 1657  |
| `iti.21` | M4 `indent-legacy.js`                                    | 1     | 1357  |
| `iti.22` | flip `include`, emit rule declarations                   | —     | —     |

Total: 293 files, 70,681 lines.

`7qe`, `7cu`, `eft`, `e6b` and `9z0` are closed as **planning supersessions** — no
annotation work landed under any of them. `zye`'s five dependency edges on them were
removed and replaced with a single edge on `iti.22`.

### Commit checkpointing within a bead

Each bead commits per file or per small group rather than once at the end. This is what
actually converts a quota interrupt from total loss into partial progress, and it is
stated in every bead's acceptance criteria. `indent.js` gets an explicit checkpoint
instruction: annotate `IndexMap` (line 130), `TokenInfo` (180) and `OffsetStorage` (243),
commit, then the `create()` body at 502.

## Alternatives considered

**Enumerate annotated files in `include`, bead by bead** — the salvage branch's approach,
and the literal reading of the 2026-09-21 ADR's "expanded bead-by-bead". Rejected: a
289-entry array duplicated across `tsconfig.json` and `tests/tools/lint-types.js`, edited
by 20 beads. It also isn't necessary, because `include` was never what made these files
checked.

**Split the monsters below file level by extracting helpers.** `indent.js` is the only one
of the four with a top-level seam — `IndexMap`/`TokenInfo`/`OffsetStorage` occupy lines
130–501 before `module.exports` at 502. The other three (`indent-legacy.js` `create()` at
197, `no-extra-parens.js` at 115, `no-unused-vars.js` at 112) are a single monolithic
`create()` with all the work in nested helpers and no seam at all. Extracting modules
would be a runtime refactor of the largest and most intricate rules in the codebase,
which is the one thing most likely to break tests. Rejected. A file in `include` with
`// @ts-check` must type-check as a whole, so the file is the atomic unit either way.

**`@ts-ignore` as staging scaffold** — annotate a file coarsely with blanket ignores in
one bead, remove them region by region in follow-ups. Rejected: it leaves cleanup debt,
contradicts the standing rule that `@ts-ignore` is "acceptable only where tsc cannot
express a valid invariant", and the salvage evidence says these files need one ignore in
total, so there is nothing to stage around.

**Reuse the salvage branch.** Rejected. `912eed0f0` was never verified green — it was
scraped out of a dead agent's working tree. Seeding beads with it would have agents
reviewing unverified annotations they are predisposed to trust. It is retained as
**sizing evidence only**, and every bead says so explicitly.

**Smaller (~2,500 line) or larger (~6,000 line) sub-batches.** 2,500 gives 31 beads and
31 review cycles for a marginal reduction in per-bead risk; 6,000 gives 16 beads but each
is still comparable to all four monsters combined. ~3,800 was chosen as the knee.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| The `@ts-check`-without-`include` mechanism is **inferred, not executed** — it was derived from `lib/rules/index.js:13` + `lib/config/default-config.js:14` + the prior ADR's 4,638-diagnostic evidence, but this planning worktree has no `node_modules` so tsc could not be run | `iti.1` exists solely to verify it, blocks all 21 other beads, and is instructed to **stop and report** rather than annotate if the claim does not hold |
| 293 files joining the emit set at once may surface `TS4023`-class "cannot be named" errors on first declaration emit | Deliberately isolated in `iti.22`, the last bead, where it blocks nothing but `zye` |
| Per-bead effort estimate (~700 changed lines) is extrapolated from 4 atypically complex files onto 289 mostly-formulaic ones | The R01 pilot reports actual changed lines before the other 19 run; ranges can be resized |
| 19 beads eligible at once could themselves exhaust provider quota through concurrency | Dispatch concurrency is a Sthapathi setting, not a graph property; the graph permits parallelism without requiring it |
| `.c8rc` has `all: true`, so multi-line casts inside untested functions reduce measured coverage | Noted in every bead description; prefer single-line casts |

## Incident: the tracking epic was closed with children open

`eslint-shreni-beads-yd9` — the epic for the whole TS-declarations effort, whose own
description opens `DO NOT IMPLEMENT — epic, track only` — is **closed**, with:

```
Close reason: Merged: confidence=88 files=1 — Epic eslint-shreni-beads-yd9 is a
tracking-only parent ("DO NOT IMPLEMENT — epic, track only"; acceptance = "all child b…
```

It was closed while seven of its children were still open. This is the failure mode the
2026-09-21 ADR anticipated in its own "do not implement" section: beads does not let an
epic be blocked by its own children, so a tracking parent keeps surfacing in `bd ready`
and eventually gets dispatched. Here the reviewer correctly *identified* it as
tracking-only and closed it anyway.

The new epic `iti` carries the same `DO NOT IMPLEMENT` header and will surface in
`bd ready` the same way — the header is the only available guard. `yd9` was not reopened;
`iti` is filed as a root epic rather than as its child.

## Open questions

1. Whether `iti.22`'s `include` flip triggers `TS4023`-class declaration-emit errors, and
   how many. Unknown until 293 rule files are in the emit set; resolved in that bead.
2. Whether the ~3,800-line target is right for formulaic rules. The R01 pilot answers this
   with real numbers and the remaining ranges can be rebalanced before they run.
3. Whether beads should gain a mechanism for a genuinely non-dispatchable epic, so
   `DO NOT IMPLEMENT` does not depend on an agent reading a description. Out of scope
   here; belongs to the Shreni repo, not this one.

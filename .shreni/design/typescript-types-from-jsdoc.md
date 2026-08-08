# Adding TypeScript types to ESLint via JSDoc source annotation

Design note for epic `eslint-shreni-beads-y6r`.

Types are authored as JSDoc in the `.js` sources; `.d.ts` files are **generated**
by `tsc --allowJs --declaration --emitDeclarationOnly` at `strict: true`, so the
published declarations cannot drift from the implementation.

Scope: all of `lib/` (381 files), `packages/js/src`, `bin/eslint.js`.
Out of scope: `tools/`, `tests/`, `packages/eslint-config-eslint`.

---

## Phase 0 spike — runtime dependency type-availability audit

`eslint-shreni-beads-y6r.1`. No annotation work; findings only.

Under `strict: true`, a dependency that ships no declarations makes every value
that flows out of it an implicit `any`, and `noImplicitAny` turns the bare
`require()` itself into a hard error (TS7016). This spike establishes, for each
of the 28 runtime dependencies, whether declarations exist, where they come
from, and whether they actually typecheck against the call sites in `lib/`.

### Method

Three independent checks, none of them a reading of the README:

1. **Resolution.** `ts.resolveModuleName()` was run for every specifier that
   `lib/`, `bin/`, and `packages/js/src` actually `require()`, under
   `moduleResolution: node16` and `bundler`, with `allowJs` and
   `resolveJsonModule`. The recorded answer is the resolved file and its
   extension — `.d.ts`/`.d.cts`/`.d.mts` means typed, `.js`/`.cjs` means not.
   This is deliberately _not_ a read of the `types` field in `package.json`,
   because that field is ignored when an `exports` map is present — see
   `@humanwhocodes/module-importer` below, which is exactly that trap.
2. **Compilation.** Probe files reproducing the real import shapes and the real
   call sites (`esutils.keyword.isIdentifierES6(name)`,
   `fileDescriptor.meta.hashOfConfig`, `spawn.sync(cmd, args, {encoding})`, …)
   were compiled at `strict: true`. A dependency only counts as typed if the
   probe compiles clean, not if a declaration file merely exists.
3. **Registry.** `npm view @types/<dep>` for everything that failed check 1,
   and the candidate `@types` tarball was downloaded, staged into
   `node_modules/@types`, and put through check 2.

### Verdict

| Dependency                              | Version | Class         | Resolves to                                          |
| --------------------------------------- | ------- | ------------- | ---------------------------------------------------- |
| `@eslint-community/eslint-utils`        | 4.10.1  | ships-types   | `index.d.ts` (cjs) / `index.d.mts` (esm)             |
| `@eslint-community/regexpp`             | 4.12.2  | ships-types   | `index.d.ts`                                         |
| `@eslint/config-array`                  | 0.23.5  | ships-types   | `dist/cjs/index.d.cts`                               |
| `@eslint/config-helpers`                | 0.7.0   | ships-types   | `dist/cjs/index.d.cts`                               |
| `@eslint/plugin-kit`                    | 0.7.2   | ships-types   | `dist/cjs/index.d.cts`                               |
| `@humanfs/node`                         | 0.16.8  | ships-types   | `dist/index.d.ts` (ESM mode only)                    |
| `@humanwhocodes/retry`                  | 0.4.3   | ships-types   | `dist/retrier.d.cts`                                 |
| `ajv`                                   | 6.15.0  | ships-types   | `lib/ajv.d.ts`                                       |
| `escape-string-regexp`                  | 4.0.0   | ships-types   | `index.d.ts`                                         |
| `eslint-scope`                          | 9.1.2   | ships-types   | `lib/index.d.cts`                                    |
| `eslint-visitor-keys`                   | 5.0.1   | ships-types   | `dist/eslint-visitor-keys.d.cts`                     |
| `espree`                                | 11.2.0  | ships-types   | `dist/espree.d.cts`                                  |
| `fast-deep-equal`                       | 3.1.3   | ships-types   | `index.d.ts`                                         |
| `find-up`                               | 5.0.0   | ships-types   | `index.d.ts`                                         |
| `ignore`                                | 5.3.2   | ships-types   | `index.d.ts`                                         |
| `minimatch`                             | 10.2.6  | ships-types   | `dist/commonjs/index.d.ts`                           |
| `cross-spawn`                           | 7.0.6   | needs-@types  | `@types/cross-spawn@6.0.6`                           |
| `debug`                                 | 4.4.3   | needs-@types  | `@types/debug@4.1.13`                                |
| `esquery`                               | 1.7.0   | needs-@types  | `@types/esquery@1.5.4`                               |
| `glob-parent`                           | 6.0.2   | needs-@types  | `@types/glob-parent@5.1.3`                           |
| `imurmurhash`                           | 0.1.4   | needs-@types  | `@types/imurmurhash@0.1.4`                           |
| `is-glob`                               | 4.0.3   | needs-@types  | `@types/is-glob@4.0.4`                               |
| `json-stable-stringify-without-jsonify` | 1.0.1   | needs-@types  | `@types/json-stable-stringify-without-jsonify@1.0.2` |
| `natural-compare`                       | 1.4.0   | needs-@types  | `@types/natural-compare@1.4.3`                       |
| `esutils`                               | 2.0.3   | needs-ambient | `lib/utils.js`                                       |
| `file-entry-cache`                      | 8.0.0   | needs-ambient | `cache.js`                                           |
| `optionator`                            | 0.9.4   | needs-ambient | `lib/index.js`                                       |
| `@humanwhocodes/module-importer`        | 1.0.1   | needs-ambient | `src/module-importer.cjs`                            |

16 ship-types, 8 need a DefinitelyTyped package, 4 need a locally-authored
ambient module. The four `needs-ambient` entries are the entire cost this spike
was commissioned to size.

### The bead's prior assumptions, verified

Confirmed as stated: `@eslint/config-array`, `@eslint/plugin-kit`, and
`@eslint/config-helpers` all ship their own declarations, and `@eslint/core` is
not a dependency of this package (it arrives only transitively, under
`@eslint/plugin-kit`).

Corrected: the bead listed `ajv`, `minimatch`, `debug`, `@humanwhocodes/retry`,
and `@humanwhocodes/module-importer` as open questions. Four of those five are
settled cheaply — `ajv`, `minimatch`, and `@humanwhocodes/retry` ship
declarations, and `debug` has a maintained DT package. Only
`@humanwhocodes/module-importer` is a real problem, and not for the reason one
would guess.

### needs-ambient — why, and what the declaration must cover

Each of these needs a `.d.ts` in-repo (proposed home: `lib/types/vendor/`).
The listed surface is the complete set of symbols `lib/` touches — nothing
wider needs to be declared.

#### `optionator@0.9.4`

`npm view @types/optionator` returns **404**; no DefinitelyTyped package has
ever existed. This is the only dependency with no upstream option at all.

Used by `lib/options.js:12` only. Consumed surface:

- the factory call `optionator({ prepend, defaults, options })`, where `options`
  is the heterogeneous array of heading entries and option descriptors that
  makes up the whole of `lib/options.js`;
- on the returned instance, `parse(args)` (`lib/cli.js:204`) and
  `generateHelp()` (`lib/cli.js:215`).

`generateHelpForOption()` is advertised in the comment at `lib/options.js:22`
but is not called anywhere in `lib/` or `bin/`; it does not need declaring.
The `options` array is the interesting part — typing it precisely is what would
give `lib/cli.js` a checked `ParsedCLIOptions` instead of an `any`, so the
ambient module should be written option-descriptor-first, not as
`declare function optionator(o: any): any`.

#### `@humanwhocodes/module-importer@1.0.1`

The package **does** ship `dist/module-importer.d.ts` and
`dist/module-importer.d.cts`, and its `package.json` sets
`"types": "dist/module-importer.d.ts"`. It is still untyped in practice: the
`exports` map is

```json
"exports": { "require": "./src/module-importer.cjs", "import": "./src/module-importer.js" }
```

with no `types` condition. When `exports` is present TypeScript resolves through
it and ignores the top-level `types` field, then looks for a declaration file
sitting next to the resolved `./src/module-importer.cjs` — and the declarations
are in `dist/`, not `src/`. Verified: resolution lands on `.cjs`, and the probe
fails with TS7016.

Used by `lib/shared/translate-cli-options.js:15,115`. Consumed surface: the
named export `ModuleImporter`, its constructor (`new ModuleImporter()`, called
with no arguments), and whichever of `import()` / `resolve()` that file uses.

A `paths` mapping in `tsconfig.json` pointing the specifier at the shipped
`dist/module-importer.d.cts` is a legitimate alternative to hand-authoring, and
is cheaper; it is also fragile across upgrades. Either way this must be a
conscious decision, because the naive check ("does `package.json` have a
`types` field?") says yes and is wrong.

#### `esutils@2.0.3`

`@types/esutils@2.0.2` exists, and adopting it makes things **worse**. It
declares both identifier predicates with a required second parameter:

```ts
isIdentifierES5: (id: any, strict: any) => boolean;
isIdentifierES6: (id: any, strict: any) => boolean;
```

At runtime `strict` is optional (`esutils/lib/keyword.js:145,149` —
`isIdentifierNameES5(id) && !isReservedWordES5(id, strict)`, where a falsy
`strict` is the normal path). Both real call sites pass one argument, so with
the DT package staged the probe fails:

```
esutils-probe.js(4,36): error TS2554: Expected 2 arguments, but got 1.
esutils-probe.js(5,36): error TS2554: Expected 2 arguments, but got 1.
```

Rewriting the call sites to satisfy a wrong declaration would be a runtime
change made to appease the type system, which is the wrong trade. Author the
ambient module instead.

Consumed surface, complete:

- `keyword.isIdentifierES5(id: string, strict?: boolean): boolean` —
  `lib/rules/func-name-matching.js:59`
- `keyword.isIdentifierES6(id: string, strict?: boolean): boolean` —
  `lib/rules/func-name-matching.js:57`
- `ast.trailingStatement(node)` — `lib/rules/utils/ast-utils.js:1700`, re-exported
  as `getTrailingStatement`. Returns the trailing statement node or `null`
  (`esutils/lib/ast.js:94`); the DT package types it as bare `any`, so the
  ambient version should give it a real return type — this one is on the
  `ast-utils` critical path.

All three blocks are now written. One carries a debt worth naming: the node
union the AST spike below settles on is authored by a later bead and does not
exist yet, so `trailingStatement` is declared against a placeholder
`StatementNode` in the same block — `type`, plus the `range` and `loc` that
ESLint guarantees on every node, reusing `core.d.ts` for the position types
rather than re-declaring them. It is a real type rather than `any`, and
`tests/lib/types/vendor.js` pins the return to `StatementNode | null` so a
regression to `any` fails. When the node union lands, re-point that one
signature at `Statement | null` and delete the placeholder; nothing else in the
block changes.

#### `file-entry-cache@8.0.0`

Two DT versions exist and neither works. `@types/file-entry-cache@10.0.87`
(the `latest` tag) is a deprecated stub — _"This is a stub types definition.
file-entry-cache provides its own type definitions, so you do not need this
installed"_ — which is true of `file-entry-cache@10`, and false of the `^8.0.0`
pinned here. The last real declarations are `@types/file-entry-cache@5.0.4`,
written against v5, where `FileDescriptor.meta` is
`{ size?, mtime?, hash? }` and is itself optional and `readonly`.

`lib/cli-engine/lint-result-cache.js` stores ESLint's own payload on `meta`.
With 5.0.4 staged the probe fails four times over:

```
error TS18048: 'fd.meta' is possibly 'undefined'.
error TS2339: Property 'hashOfConfig' does not exist on type '{ readonly size?: ...; readonly mtime?: ...; readonly hash?: ... }'.
error TS18048: 'fd.meta' is possibly 'undefined'.
error TS2339: Property 'results' does not exist on type '{ ... }'.
```

Consumed surface:

- `create(cacheName: string, directory?: string, useChecksum?: boolean)` —
  called at `lint-result-cache.js:90` as
  `create(cacheFileLocation, void 0, useChecksum)`, i.e. a full path is passed
  as `cacheName` with `directory` explicitly `undefined`;
- `getFileDescriptor(filePath: string)` — `:150`, `:185`;
- `reconcile(): void` — `:212`;
- on the descriptor: `notFound: boolean`, `changed?: boolean`, and a
  **mutable, non-optional** `meta` carrying `results: LintResult` and
  `hashOfConfig: string` (read at `:160`, `:167`; written at `:202`, `:203`).

`meta` is the whole reason this needs a local declaration: `lint-result-cache`
writes application-defined fields into it, so it has to be typed as ESLint's own
payload shape, which no upstream package can know. Type it against
`LintResult` from the `lib/types/core.d.ts` vocabulary rather than as
`Record<string, unknown>`.

### needs-@types — all eight verified compile-clean

Every DT package in the table above was staged into `node_modules/@types` and
compiled against the real call sites at `strict: true`. All eight probes passed.
Notes worth carrying forward:

- **`@types/cross-spawn@6.0.6` vs `cross-spawn@7.0.6`** — a major-version skew,
  but the consumed surface is only `spawn.sync(cmd, args, { encoding: "utf8" })`
  (`lib/cli.js:268`, `lib/shared/runtime-info.js:53`, `bin/eslint.js:72`), and
  the DT package types `sync` as `typeof child_process.spawnSync`, which is
  correct for v7. It carries a `/// <reference types="node" />`.
- **`@types/esquery@1.5.4`** — covers `parse()` and `matches()`, which is
  exactly what `lib/linter/esquery.js:253,309` uses. It types nodes as
  `estree.Node`, so it drags in `@types/estree` and will couple ESLint's AST
  handling to the estree vocabulary at the boundary. Acceptable, but it is a
  design decision, not a free win.
- **`@types/debug@4.1.13`** — already resolvable in the tree today, but only by
  accident. See below.

### Undeclared `@types` the gate silently depends on

Three DefinitelyTyped packages are resolvable from the repo root right now and
**none of them is declared in `package.json`**:

| Package         | Needed by                                                                                                                                                  | Present because                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `@types/node`   | every `lib/` file that requires a `node:` builtin                                                                                                          | transitive                                                                    |
| `@types/estree` | `eslint-scope`'s `index.d.cts` (`import type * as ESTree from "estree"`), `@eslint-community/eslint-utils`'s `index.d.ts`, and `@types/esquery` if adopted | transitive                                                                    |
| `@types/debug`  | 11 `require("debug")` call sites in `lib/` and `bin/`                                                                                                      | dev-dependency of `eslint-plugin-jsdoc`, `eslint-plugin-yml`, and `micromark` |

`@types/debug` is the clearest case: it is in the tree only because
`eslint-plugin-jsdoc` and `eslint-plugin-yml` happen to depend on it. Any
unrelated lint-plugin upgrade can drop it and break the type gate for reasons
that will look completely unconnected to types. All three must be added as
explicit `devDependencies` by the tsconfig bead, **before** any allowlist grows,
so the gate depends on declared inputs only.

### tsconfig requirements that fall out of this audit

- **`resolveJsonModule: true` is mandatory**, not optional. Two `lib/` modules
  require JSON across a package boundary — `lib/shared/ajv.js:12`
  (`ajv/lib/refs/json-schema-draft-04.json`) and `lib/config/config-loader.js:489`
  (`jiti/package.json`). Without the flag both fail to resolve.
- **`@humanfs/node` resolves only in ESM mode.** Its `exports` map has no
  `require` condition. `lib/eslint/eslint-helpers.js:187,281` reaches it via
  `await import("@humanfs/node")` from a CJS file, which TypeScript resolves in
  ESM mode, so it works — a probe confirms it. Anyone who "simplifies" that
  dynamic import into a top-level `require()` breaks the type gate, and the
  error will point at the import rather than at the refactor.
- `moduleResolution: node16` and `bundler` were both checked. They disagree on
  which declaration file is picked for six dual-published packages
  (`@eslint/*`, `eslint-scope`, `espree`, `@eslint-community/eslint-utils`,
  `minimatch`) — `.d.cts` versus `.d.ts` — but every probe compiles under both.
  No dependency forces a choice between them.

### Impact on the `ast-utils` chokepoint

`lib/rules/utils/ast-utils.js` has four external dependencies:
`eslint-visitor-keys`, `espree`, `escape-string-regexp` (all ships-types), and
`esutils` (needs-ambient). So the file with 193 inbound edges is gated on
exactly one hand-authored declaration, and only three symbols of it — and just
one of those, `ast.trailingStatement`, is on `ast-utils`'s own export surface.

That is a much smaller blocker than the epic assumed. The `esutils` ambient
module should be written first, before any annotation work, since ~75% of `lib/`
is downstream of it.

### Follow-up work this spike implies

1. Add `@types/node`, `@types/estree`, and `@types/debug` as explicit
   `devDependencies` (blocking; belongs in the tsconfig bead).
2. Add the eight `needs-@types` packages as `devDependencies`.
3. Author four ambient modules, `esutils` first.
4. Set `resolveJsonModule: true` in `tsconfig.json`.
5. Decide `paths`-mapping versus hand-authoring for
   `@humanwhocodes/module-importer`, and record the decision here.

The audit is guarded by `tests/lib/types/dependency-type-availability.js`, which
re-derives the resolution facts from the installed tree on every test run and
fails if a dependency's type availability changes or a new runtime dependency is
added without being classified here.

## Phase 0 spike — the AST node vocabulary decision

`eslint-shreni-beads-y6r.15`. No annotation work; findings only.

`lib/types/core.d.ts` covers the _results_ half of the vocabulary — `LintMessage`,
`LintResult`, `Severity`, `Fix`, `Position` — and contains no AST node types at
all. Every remaining bead in this epic discriminates on AST nodes: the ~94
exports of `ast-utils.js`, the token-store overload families, the six
`switch (node.type)` ladders in `code-path-analyzer.js`. No bead owned the
choice of node vocabulary, and all of them are downstream of it.

**Decision: hand-author the node vocabulary in `lib/types/`** (candidate (b)),
mirroring `@types/estree`'s shapes closely enough to stay assignable to them at
the package boundaries, and keep `@types/estree` as an explicit devDependency
regardless. Candidates (a) and (c) were both measured and both fail.

### Method

Nothing below is read off a README or a `types` field. Three kinds of evidence:

1. **Runtime observation.** espree 11.2.0 was run over source exercising
   hashbangs, bigints, private fields, static blocks, JSX, and
   `sourceType: "commonjs"`, and the resulting nodes, comments, and tokens were
   enumerated by walking the tree.
2. **Compiler expansion.** `@types/estree`'s `Node["type"]`, `Comment["type"]`,
   and `Program["sourceType"]` unions were expanded with the TypeScript checker
   rather than by reading the declaration file, and diffed against espree's own
   `Syntax` table.
3. **Compilation against real call-site shapes.** Each candidate vocabulary was
   compiled at `strict: true` against probes reproducing code that actually
   exists in `lib/` — `isIdentifierReference`'s switch ladder verbatim,
   `isDirective`, unconditional `.range`/`.loc`/`.parent` reads. A candidate
   only survives if the probe compiles, not if the shape looks plausible.

### What espree actually produces

espree's own declarations do not speak estree at all: `dist/espree.d.ts` types
`parse()` as returning **`acorn.Program`**, and `acorn.Node` is
`{ start: number; end: number; type: string; range?; loc? }` — an open `type`
and no node union whatsoever. So "adopt espree's types" is not an available
option; espree publishes no node vocabulary to adopt. The comparison that
matters is therefore between what espree _emits at runtime_ and what
`@types/estree` _declares_.

ESLint pins the parser options that decide most of this. `lib/languages/js/index.js:242-245`
forces `loc: true`, `range: true`, `tokens: true`, `comment: true` on every
parse, and `lib/languages/js/source-code/source-code.js:1140` assigns
`node.parent` during traversal. None of those four guarantees is expressible in
`@types/estree`.

### Divergences, enumerated

`additive` means espree produces something estree does not describe, and a
vocabulary can extend estree without contradicting it. `contradictory` means
estree makes a claim that is wrong for ESLint, so no extension can repair it.

| #   | Divergence                          | ESLint / espree reality                                    | `@types/estree` declares                             | Class         |
| --- | ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ------------- |
| 1   | `node.range`                        | always present (`range: true` is forced)                   | `range?: [number, number] \| undefined`              | contradictory |
| 2   | `node.loc`                          | always present (`loc: true` is forced)                     | `loc?: SourceLocation \| null \| undefined`          | contradictory |
| 3   | `node.parent`                       | assigned to every node during traversal                    | absent                                               | additive      |
| 4   | `node.start` / `node.end`           | on every node, inherited from acorn                        | absent                                               | additive      |
| 5   | `Program.tokens`                    | present (`tokens: true` is forced)                         | absent                                               | additive      |
| 6   | `Program.comments`                  | always present                                             | `comments?: Comment[] \| undefined`                  | contradictory |
| 7   | JSX and friends                     | 18 extra node types in `espree.Syntax` (89 vs estree's 71) | absent                                               | additive      |
| 8   | `Comment.type`                      | `"Line" \| "Block" \| "Hashbang"`                          | `"Line" \| "Block"`                                  | contradictory |
| 9   | `Program.sourceType`                | `"script" \| "module" \| "commonjs"`                       | `"script" \| "module"`                               | contradictory |
| 10  | TS-ESTree node types                | `ast-utils.js` references 9 of them at 14 sites            | absent                                               | additive      |
| 11  | `ExpressionStatement` / `Directive` | one runtime shape; `.directive` tested by `isDirective`    | two interfaces sharing `type: "ExpressionStatement"` | contradictory |

On #7, the estree union is a strict _subset_ of espree's: all 71 of estree's
node types appear in `espree.Syntax`, and espree adds 18 — the 16 `JSX*` types,
`ImportAttribute`, and the two `Experimental*` spread types.

On #10, this is the divergence the bead did not anticipate and the one that
decides the shape of the answer. ESLint core is parser-agnostic, and
`ast-utils.js` handles typescript-eslint's nodes directly:
`TSPropertySignature` and `TSMethodSignature` (`:311`, `:312`, `:2229-2230`,
`:2258`, `:2291`, `:2406-2407`), `TSModuleBlock` (`:1308`), `TSDeclareFunction`
(`:1470`), `TSImportEqualsDeclaration` (`:1471-1472`), and the
`TS_TYPE_NODE_TYPES` set (`:1415-1419`). Neither espree nor `@types/estree`
declares any of them.

On #11 — estree splits one runtime shape into `ExpressionStatement` and
`Directive`, both carrying `type: "ExpressionStatement"`, with `.directive` on
only the latter. A discriminant that appears on two members cannot separate
them, so `ast-utils.js:1318`'s `isDirective` is **unnarrowable** under the
estree union no matter how it is extended.

### Candidate (a) — adopt `@types/estree` directly: rejected

Seven probes reproducing real `lib/` shapes were compiled against
`estree.Node`. Six failed:

```
TS18048: 'node.range' is possibly 'undefined'.
TS2339:  Property 'parent' does not exist on type 'Node'.
TS18049: 'node.loc' is possibly 'null' or 'undefined'.
TS2367:  types '...59 more...' and '"JSXElement"' have no overlap.
TS2367:  types '"Line" | "Block"' and '"Hashbang"' have no overlap.
TS2322:  Type 'Expression | null | undefined' is not assignable to 'Node | null'.
```

The only probe that passed was indexing a `Record<string, …>` by `node.type`.

The scale matters more than the count. Across `lib/` there are **791** `.range`
reads, **573** `.loc` reads, and **985** `.parent` reads. Under candidate (a)
every one of the first two needs a non-null assertion or a guard, and every one
of the third is a hard error. In JSDoc that assertion is spelled
`/** @type {[number, number]} */ (node.range)` — roughly 1,364 casts written to
work around a declaration that is simply wrong about ESLint. That is precisely
the "casting to `any`" experience user story 1 exists to eliminate.

### Candidate (c) — an estree hybrid: rejected in all three forms

This was the cheap answer and it was tested hardest. Three forms, all measured.

**(c1) Intersect the union.** `type ESLintNode = ESTree.Node & { parent; range; loc }`.
Discrimination survives the intersection and the additions are present on the
node itself — but they **do not reach children**, because estree's interface
bodies still type their fields with estree's own unions:

```
TS18048: 'node.test.range' is possibly 'undefined'.
TS2339:  Property 'parent' does not exist on type 'ModuleDeclaration | Statement | Directive'.
```

Walking into children is most of what ESLint does, so this fails where it counts.

**(c2) Augment the estree module.** This is the strongest form, and it partly
works: augmenting `BaseNode` with `parent` _does_ propagate to children, and
because `NodeMap` is an interface, JSX types _can_ be added to the `Node` union.
What it cannot do is **change** anything that already exists. Strengthening
`range` from optional to required, or widening `Comment["type"]` to include
`"Hashbang"`, is rejected by TS2717 / TS2687.

The decisive part is how that rejection presents. `tsconfig.base.json` sets
`skipLibCheck: true`, and those diagnostics are reported _in the declaration
file_ — so under the gate this repo actually ships, a broken augmentation
produces **no diagnostic at all**. It compiles, it is ignored, and the only
symptom is that `range` is still optional at the use site. An author would write
the augmentation, see green, and annotate hundreds of files on a false premise.
A mechanism whose failure mode is silence is not one to build a vocabulary on.

**(c3) Derive with a recursive mapped type.** The clever option, and the one
that came closest — `parent`, narrowing, child extras, and estree assignability
all hold. It fails on three counts. It is still a closed estree union, so
`node.type === "TSPropertySignature"` remains an error. `isDirective` still
cannot narrow. And the diagnostics it produces are unreadable — a single
missing property yields a 400-character structural dump beginning
`'{ type: "ExpressionStatement"; expression: ({ type: "ClassExpression"; id?: ...`.
It also quietly corrupts the shapes it copies: `range` comes out as
`number[] & [number, number]`, because the recursion rewrites the tuple through
its array branch, so `.push()` is legal on a two-element position pair. Types
whose errors cannot be read are a worse tool than no types, and user stories 2
and 3 are entirely about what a consumer sees on hover.

### Candidate (b) — hand-authored: adopted

Cost, stated honestly: roughly 89 node interfaces plus the supporting unions,
mirroring estree's shapes. It is the most typing of the three options. It is
also the only one that is correct on all eleven divergences, and the cost is
mechanical, one-time, and paid in a single file.

Two properties were verified rather than assumed.

**Interop holds.** Hand-authored nodes are structurally assignable to
`estree.Node` and pass through real `@eslint-community/eslint-utils` signatures
— but only while the shapes mirror estree's own unions. The probe initially
failed because a single `Literal` interface is not assignable to estree's
three-way `SimpleLiteral | RegExpLiteral | BigIntLiteral` split. Mirroring that
split fixes it. This is a real constraint on the authoring, not a formality, and
it is guarded by a test.

**The additions reach children**, which is exactly what (c1) could not do:
`node.expression.range[0]` and `node.expression.parent.range[1]` both compile,
because our own interfaces type their fields with our own unions.

### The `node.type` discrimination strategy

Concretely, so that `y6r.3` can author against it without re-deciding:

1. **A base interface carrying ESLint's guarantees.** `range: [number, number]`
   and `loc: SourceLocation` **required** (not optional — this is divergence
   #1/#2 and the whole reason estree does not fit), plus `parent: Node`. Reuse
   `SourceRange`, `Position`, and `SourceLocation` already exported from
   `core.d.ts`; do not re-declare them.
2. **One interface per node type, each with a string-literal `type`.** The 71
   estree types plus espree's 18 extras.
3. **The union is closed**, and third-party node types are declared as
   first-class members rather than accommodated by an escape hatch. The obvious
   alternative — an `UnknownNode { type: string }` member — was tested and
   **destroys narrowing on every other member**: `node.type === "Identifier"`
   narrows to `Identifier | UnknownNode` and `node.name` becomes an error. Since
   ESLint core references exactly 9 TS-ESTree names, declare those 9 minimally
   (`key`, `computed`, `static`, `kind` — only the fields `ast-utils.js` reads)
   and keep the union closed.
4. **`Comment` and `Token` are separate from `Node`.** `Comment["type"]` is
   `"Line" | "Block" | "Hashbang"`; tokens carry their own discriminant
   (`"Keyword"`, `"Identifier"`, `"Punctuator"`, `"Numeric"`, `"String"`,
   `"PrivateIdentifier"`, …). `ast-utils.js` has 28 single-argument _token_
   predicates against 22 strict node predicates, so this is not a minor
   sub-vocabulary.
5. **`Directive` is not a separate interface.** Give `ExpressionStatement` an
   optional `directive?: string` — one interface, one discriminant — which is
   what makes `isDirective` narrow.

The adopted shape was compiled with all five properties exercised and is clean;
the probe lives in `tests/lib/types/ast-vocabulary.js` so it stays that way.

### Validated against the real consumers

**`ast-utils.js`** — 94 exports, of which 22 are strict `(node) => boolean`
predicates, 28 are token predicates, and 18 are multi-argument. Beyond the
`.parent`/`.range`/`.loc` counts above, three patterns constrain the vocabulary:

- **Literal narrowing.** `isNullLiteral` (`:192`), `getStaticStringValue`
  (`:247`), `isNumericLiteral` (`:2600`) and `equalLiteralValue` (`:407`) all
  read `.regex` and `.bigint` after `type === "Literal"`. estree's three-way
  split makes each of those an error on the members that lack the field. Our
  vocabulary must mirror the split for interop (above) _and_ these sites need
  real narrowing — this is the single largest annotation cost in the file, and
  `y6r.6` should budget for it rather than discover it.
- **Guard/access mismatch.** `getFunctionNameWithKind` (`:2222-2296`) guards on
  a disjunction across **two different variables** (`parent.type === … || node.type === …`),
  so entering the block narrows neither. Four escape hatches or a restructure;
  either way it is not a mechanical annotation.
- **Open-string treatment of `type`.** `node.type in eslintVisitorKeys`
  (`:2042`), five regex tests against `.type` (`:131`, `:149`, `:165`, `:871`,
  `:1652`), six `Set<string>.has(node.type)` calls, and
  `switch (node && node.type)` (`:304`) whose discriminant is
  `Node["type"] | undefined | null` and therefore narrows nothing. A closed
  literal union does not break these — they keep working — but it also does not
  _help_ them, so they will need explicit predicates to recover narrowing.
  `STATEMENT_LIST_PARENTS` (`:48`) is an exported `Set<string>` that ~193
  downstream consumers test `node.type` against.

**`code-path-analyzer.js`** — six `switch` ladders, not the two the bead
assumed: `:88`, `:134`, `:260`, `:437`, `:544`, `:688`. Every case label is a
real ESTree node type; none is synthetic. The `default:` arms never dereference
a node, so the residual type is never a problem. Compiling the `:134` ladder
verbatim against a discriminated union produces exactly three errors, all in
shared case bodies:

```
TS2339: Property 'id' does not exist on type 'ClassDeclaration | ClassExpression | ArrowFunctionExpression | …'.
TS2339: Property 'shorthand' does not exist on type 'AssignmentProperty | Property | MethodDefinition | PropertyDefinition'.
TS2339: Property 'key' does not exist on type 'AssignmentPattern'.
```

These arise under _any_ discriminated union, hand-authored or estree, so they
are a cost of the strategy rather than an argument between candidates. The first
two are benign — `undefined` is falsy and the expressions reduce correctly — and
want a documented widening. The third is not; see below.

**`code-path-state.js`** — worth recording because it changes the bead's
premise: it **never touches an AST node**. Its entire contact surface is the
`type` and `label` _strings_ the analyzer passes in. Its internal contexts are
ES classes, and `LoopContext`'s discriminant field is literally named `type`
with values drawn from the AST type names (`"WhileStatement"`,
`"ForInStatement"`, …). A `Node | LoopContext` union discriminated on `type`
would be genuinely ambiguous, so `y6r.13` must keep those vocabularies apart —
and note that `LoopContextBase` assigns `this.type` from an unannotated
parameter, so it infers as `string` and the `switch` at `:1790` narrows nothing
until literal types are declared.

### A latent defect this surfaced

`code-path-analyzer.js:159-160`:

```js
case "AssignmentPattern":
    return parent.key !== node;
```

`AssignmentPattern` has `left` and `right`; it has no `key`. The expression is
therefore `undefined !== node`, always `true` — identical to the `default:` arm
two lines below, making the case dead code that reads as though it does
something. The evident intent was `parent.left !== node`, which would classify a
default-parameter binding identifier as _not_ a reference. As written,
`isIdentifierReference` returns `true` there, so
`makeFirstThrowablePathInTryOrCatchBlock` adds a throwable path edge for
binding identifiers that cannot throw.

This is upstream ESLint code and the fix is a behaviour change, so it is **not**
made here — this bead is findings-only. It should be filed separately and
handled before `y6r.12` annotates the file, because a discriminated union
rejects the line outright and the temptation will be to silence it with a cast
rather than fix it.

### `@types/estree` stays an explicit devDependency

Independent of this decision. `eslint-scope/lib/index.d.cts:33` does
`import type * as ESTree from "estree"`, and
`@eslint-community/eslint-utils`'s `index.d.ts` aliases sixteen estree types
into its own public signatures. Both are runtime dependencies, so the compiler
needs `@types/estree` to type anything that touches a scope or a util —
regardless of what ESLint's own node vocabulary looks like. `@types/esquery`
would add a third such boundary if adopted.

This is what the y6r.1 audit meant by "a design decision, not a free win": the
question was never whether `@types/estree` is present, but whether it is
ESLint's _vocabulary_. It is present, and it is not the vocabulary.

### Consistency with not adopting `@eslint/core`

The two decisions are the same decision, reached the same way, and it is worth
being explicit that this is not a coincidence.

`@eslint/core` was rejected so the declaration pipeline has no external
dependency that can change shape underneath it. Adopting `@types/estree` as the
node vocabulary would have reintroduced exactly that coupling in the larger
half of the surface — and worse, against a package that is DefinitelyTyped
(`nonNpm: true`), versioned independently of any implementation, and
demonstrably wrong about ESLint on six counts.

The distinction the epic draws is between **depending on a package's types at a
boundary** and **speaking its vocabulary internally**. ESLint does the former
for `@eslint/config-array`, `@eslint/plugin-kit`, `eslint-scope`, and
`eslint-utils`, and will keep doing it — our node types are deliberately
authored to stay assignable at those boundaries. It does not do the latter for
`@eslint/core`, and after this spike it does not do it for `@types/estree`
either.

### Follow-up work this spike implies

1. `y6r.14` can now give `esutils.ast.trailingStatement` a real return type: the
   node union from this vocabulary, or `null`.
2. `y6r.3` authors the node vocabulary per the discrimination strategy above.
   It is large enough to be worth splitting from the rule/config half.
3. File the `AssignmentPattern` defect in `code-path-analyzer.js` separately.
4. `y6r.6` should budget explicitly for the `Literal` three-way split and for
   `getFunctionNameWithKind`'s cross-variable guard; neither is mechanical.

The decision is guarded by `tests/lib/types/ast-vocabulary.js`, which re-derives
every divergence from the installed espree and `@types/estree` on each run,
recompiles the rejected candidates to confirm they still fail for the recorded
reasons, and recompiles the adopted shape to confirm it still holds.

## The type-check gate

`npm run lint:types` (`tsc -p tsconfig.json`) type-checks the allowlist under
`strict: true`. It runs in three places: as its own blocking **Type Check** CI
job, inside `node Makefile lint` so the local `npm run lint` catches it too, and
as `stack.buildCommand` in `.shreni/kshetra.yaml`.

`tsconfig.base.json` holds the compiler options, `tsconfig.json` adds the
allowlist and `noEmit`, and `tsconfig.types.json` extends that for declaration
emit (`npm run build:types`). Splitting them means the checked file set and the
emitted file set cannot drift apart.

### The include-vs-traversal trap, and what resolves it

A `files`/`include` list selects only the **root** files of the program.
Everything those roots require is pulled in as well, and under `checkJs: true`
it is type-checked with them. On a codebase converting incrementally that makes
a growing allowlist unworkable: adding one annotated module drags its entire
un-annotated dependency subtree into the build and fails on code nobody has
touched. A "growing allowlist" is not, on its own, a strategy.

The companion mechanism is **`checkJs: false` plus a per-file `// @ts-check`
pragma**:

- The allowlist decides what is _in the program_.
- The pragma decides what is _checked_.

A required file with no pragma is still parsed and still used for inference —
so callers get real types from it — but nothing in it is ever reported. That
makes conversion order independent of the dependency graph, which is what lets
the work proceed bottom-up one file at a time.

The alternative considered was `// @ts-nocheck` headers on every un-annotated
file, removed as each is claimed. It was rejected: it requires touching ~370
files that no one is converting, it inverts the default so a _new_ un-annotated
file silently breaks the build, and `@ts-nocheck` suppresses errors in a file
that a later reader cannot distinguish from a file that genuinely passes.
`checkJs: false` gets the same result with no source churn.

### Demonstrated, not asserted

`tests/lib/types/include-traversal.js` proves the mechanism against the real
compiler rather than restating it. It builds programs from the shipped
`tsconfig.json` and checks:

1. **The trap is real.** Files outside the allowlist do reach the program.
   Adding `tests/fixtures/types/allowlist-growth/annotated-consumer.js` — an
   annotated stand-in for the next file to be converted — pulls in
   `lib/rules/utils/ast-utils.js`, which is neither annotated nor allowlisted.
   The test also asserts `ast-utils.js` still lacks a pragma, so the
   demonstration cannot quietly become vacuous once that file is converted.
2. **The mechanism holds.** That same program reports **0 errors**.
3. **It is load-bearing, not luck.** The identical file set compiled with
   `checkJs: true` reports **158 errors, every one of them from
   `ast-utils.js`** — an un-annotated file. This is the counterfactual that
   makes result (2) mean something.
4. **Checking is genuinely on.** `annotated-with-error.js` carries a pragma and
   a deliberate type error, and is reported. Without this, result (2) would
   also be satisfied by a compiler checking nothing at all.

Point 3 is why the suite is worth its runtime: flipping `checkJs` to `true` in
`tsconfig.base.json` fails these tests immediately, so the decision cannot be
reverted by accident.

### Declared inputs

`@types/node`, `@types/estree`, and `@types/debug` are now explicit
`devDependencies`, closing the gap recorded above. `@types/estree` is in
`knip.jsonc`'s `ignoreDependencies` because nothing `require()`s it — it is
consumed by the compiler, through `eslint-scope`'s own declarations, which Knip
cannot see. The remaining six `needs-@types` packages followed; see
[The `@types` packages the gate depends on](#the-types-packages-the-gate-depends-on).

## The rule / config half of `core.d.ts`

`eslint-shreni-beads-y6r.3`. PR #1 landed the _results_ half — `LintMessage`,
`LintResult`, `Severity`, `Fix`, the position types. This adds the half that
everything downstream of `lib/shared` actually needs: `RuleDefinition`,
`RuleContext`, `RuleFixer`, `ReportDescriptor`, `SourceCode`, `Language`,
`LanguageOptions`, `Parser`, `Processor`, `Config`, the config-array entry
shapes, and the formatter contract. Nothing is copied from upstream ESLint or
from `@eslint/core`; every shape names the file and line it was read off.

### The AST seam

The node union decided by the y6r.15 spike is roughly 89 interfaces, and that
spike explicitly recommended splitting it out of this bead. It is not authored
here. What is authored is the union's agreed **base** — `ASTNode`, carrying
`type`, a required `range`, a required `loc`, and `parent` — so the rule and
config vocabulary can name nodes without inventing a second, inconsistent shape.
`Program`, `Comment` and `Token` are declared in full, because they are small,
fully specified by the spike, and load-bearing for `SourceCode`'s surface.

`ASTNode.type` is a bare `string`, which the spike warns against for a union
_member_. That warning does not apply to a single interim type: it is about a
fallback member alongside literal-typed siblings, which collapses narrowing on
all of them. When the union lands, `ASTNode` becomes that union and every
reference written here keeps working unchanged.

### Boundaries we speak someone else's types at

`ScopeManager`, `Scope`, `Variable`, `Reference` (from `eslint-scope`) and
`Directive` / `TraversalStep` (from `@eslint/plugin-kit`) are inline
`import(...)` aliases rather than re-declarations. Both packages are runtime
dependencies that ship types, and the epic's stated position is that ESLint
depends on a package's types _at a boundary_ while owning its vocabulary
internally. Re-declaring them would be exactly the "second, inconsistent
vocabulary" the spike warns against.

This was verified, not assumed: the declaration-emit gate recompiles `core.d.ts`
standalone with `types: []` and `skipLibCheck: false`, which is the harshest
environment in the repo, and both aliases resolve clean there.

### `Omit` over an index-signature type silently destroys it

`Config` is the resolved form of `ConfigObject`, so writing it as
`interface Config extends Omit<ConfigObject, "language" | …>` is the obvious
move. It is wrong. `ConfigObject` carries `[key: string]: unknown` — it must, or
it is not assignable at the `@eslint/config-array` boundary, and it matches what
`config.js:450` does with unrecognised keys. That makes `keyof ConfigObject`
equal to `string | number`, so `Exclude` removes nothing and `Omit` collapses the
result to bare index signatures. `config.name` comes out as `unknown` rather than
`string | undefined`, with no diagnostic anywhere.

Measured with the compiler, not reasoned about. `Config`'s carried-over members
are therefore spelled out, and `tests/lib/types/core-vocabulary.js` pins the
property types so reintroducing the `Omit` fails loudly.

### Why this needs its own test suite

`npm run lint:types` cannot validate any of this. The gate is a `files`
allowlist, and not one of the modules these types describe — `linter.js`,
`config.js`, `source-code.js`, `rule-fixer.js` — is in it yet. A vocabulary
authored ahead of its consumers compiles clean by construction, so a green `tsc`
says nothing about whether the shapes are right. This is the same structural gap
`tests/lib/types/vendor.js` closes for the ambient declarations, and it recurs
for every type authored before the code it describes.

`tests/lib/types/core-vocabulary.js` closes it two ways. Compile probes, every
positive one paired with a negative, because a declaration widened to `any`
passes positives just as happily. And re-derivation: `RuleFixer`'s method list is
recomputed from `rule-fixer.js`'s class body, `LinterOptions`' keys from
`flatConfigSchema.linterOptions.schema`, `SourceType`'s values by running the
real `validateLanguageOptions`, `TokenType` against tokens espree actually emits,
and `CommentType`'s shebang value from the rewrite in `source-code.js`. Those
five claims fail here the day the implementation moves, rather than being
believed.

## The `@types` packages the gate depends on

`eslint-shreni-beads-y6r.16`. The audit's follow-up item 2 — declare the
`needs-@types` bucket — is now done. Seven DefinitelyTyped packages join the
three declared with the gate itself:

| Package                                              | Types                                         | Consumed at                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@types/cross-spawn@6.0.6`                           | `cross-spawn@7.0.6`                           | `lib/shared/runtime-info.js:53`, `lib/cli.js:268`, `bin/eslint.js:72`                                                    |
| `@types/esquery@1.5.4`                               | `esquery@1.7.0`                               | `lib/linter/esquery.js:253,309`                                                                                          |
| `@types/glob-parent@5.1.3`                           | `glob-parent@6.0.2`                           | `lib/eslint/eslint-helpers.js:589`                                                                                       |
| `@types/imurmurhash@0.1.4`                           | `imurmurhash@0.1.4`                           | `lib/cli-engine/hash.js:29`                                                                                              |
| `@types/is-glob@4.0.4`                               | `is-glob@4.0.3`                               | `lib/eslint/eslint-helpers.js:174`                                                                                       |
| `@types/json-stable-stringify-without-jsonify@1.0.2` | `json-stable-stringify-without-jsonify@1.0.1` | `lib/cli-engine/lint-result-cache.js:54`, `lib/rule-tester/rule-tester.js:22`, `lib/services/suppressions-service.js:15` |
| `@types/natural-compare@1.4.3`                       | `natural-compare@1.4.0`                       | `lib/rules/sort-keys.js:55,58`                                                                                           |

No runtime dependency changed — every package above is compile-time only.

`@types/imurmurhash` arrived last, in `eslint-shreni-beads-y6r.17`, replacing a
hand-written ambient block in `lib/types/vendor.d.ts` whose stated reason —
"no `@types/imurmurhash` on npm" — was false. That is the reverse of the
`esutils` / `file-entry-cache` / `@humanwhocodes/module-importer` decision below,
and the two directions are decided by the same test rather than by preference:
adopt the DefinitelyTyped package when it compiles against the real call site,
hand-author when it does not. Here it does, and the DT package is the better
declaration besides — it models the `new` form and the chaining
`hash()`/`reset()` return that the hand-written block flattened.

It is also the only entry in this table whose consumer, `lib/cli-engine/hash.js`,
is already in the `tsconfig.json` allowlist. That does not make its probes
redundant: dropping the ambient without declaring anything leaves
`require("imurmurhash")` an implicit `any`, and `any` compiles clean forever. The
suite pins the resolution to `node_modules/@types/imurmurhash` explicitly.

DefinitelyTyped versions its packages against a major rather than a patch, so
most of the version gaps in that table are cosmetic. Two are real major-version
skews and were probed rather than waved through:

- **`@types/cross-spawn@6` against `cross-spawn@7`.** Correct anyway, because
  the consumed surface is only `sync`, which the DT package types as
  `typeof child_process.spawnSync`. The probe pins the `encoding: "utf8"`
  overload specifically, since that is what makes `stdout` a `string` rather
  than a `Buffer` at `runtime-info.js:53`.
- **`@types/glob-parent@5` against `glob-parent@6`.** The consumed surface is
  the single call `globParent(pattern)`, whose signature is unchanged across
  that major.

### `@types/esquery` speaks estree, and that is consistent

`@types/esquery` types every node as `estree.Node`. Adopting it therefore adds a
third boundary at which ESLint speaks the estree vocabulary, alongside
`eslint-scope` and `@eslint-community/eslint-utils`.

That is exactly the distinction the AST vocabulary spike drew and it does not
re-open it: ESLint depends on estree's types **at boundaries** and does not
speak estree **internally**. `lib/linter/esquery.js` is a boundary — a thin
wrapper over someone else's matcher — so this is the former. What it must not
become is a reason to describe ESLint's own nodes in estree terms; the node
vocabulary is hand-authored in `lib/types/core.d.ts` and stays that way.

`y6r.9`, which annotates `lib/linter/esquery.js`, is where that seam gets
written. Expect a documented widening there rather than a fight: our node types
are authored to stay assignable at estree boundaries, and
`tests/lib/types/ast-vocabulary.js` pins that they do.

### Knip needed nothing, and that was checked in both directions

`@types/estree` required a `knip.jsonc` `ignoreDependencies` entry because
nothing in the repository depends on a package called `estree` — Knip saw an
unused devDependency and was right to.

None of these seven needs one. Knip resolves `@types/x` through `x`, and all
seven runtime counterparts are declared dependencies with live `require()` sites,
so each `@types` package is attributed to a used dependency. Verified rather than
assumed, each time one was added: `npx knip` reports the same findings before and
after — at `y6r.16` that was two (`lib/eslint/worker.js` unused, and the
`packages/js` `eslint` hint); since `6qe.1` closed both, it is exit 0 with an
empty report, and `@types/imurmurhash` left it that way. Adding a redundant
ignore entry would have been silently wrong in the other direction — Knip reports
unnecessary ignores as configuration hints.

### The gate can check almost none of this yet

Only `@types/imurmurhash` has a consumer in the `tsconfig.json` allowlist. The
other six do not — `runtime-info.js`, `esquery.js`, `eslint-helpers.js`,
`lint-result-cache.js` and `sort-keys.js` are all converted by later beads — so
`npm run lint:types` compiles without ever resolving them, and a green gate says
nothing about those.

Nor does it say much about the one it does resolve. An unresolved bare specifier
in a `// @ts-check` file is an implicit `any`, and `any` compiles clean forever,
so "the gate is green" and "the dependency is typed" stay different claims even
for `hash.js`.

This is the same structural gap `tests/lib/types/vendor.js` closes for the
ambient declarations, and it is closed the same way.
`tests/lib/types/declared-types-packages.js` compiles a probe per package that
mirrors the real call site, pairs each with a negative probe asserting a specific
error code (so a package resolving to `any` fails rather than passing), and pins
the installed version against the one the y6r.1 audit actually verified. For
`imurmurhash` it additionally pins where the declarations come from, resolving
the specifier the way `hash.js` does and requiring the answer to land in
`node_modules/@types/imurmurhash`.

It also guards the bucket as a whole rather than just the seven: every
`needs-@types` row in the verdict table above must be answered by a `@types`
devDependency **or** by a `declare module` block in `lib/types/vendor.d.ts`, and
never by both. Adding a new `needs-@types` dependency fails that test, and so
would half of the `y6r.17` swap have — deleting the `imurmurhash` ambient without
declaring `@types/imurmurhash`, or declaring it without deleting the ambient.
That is the guard doing the job it was written for: the swap could not land in
one direction only.

## Writing a probe suite

Compiling an in-memory probe against the installed `node_modules` is this
epic's established way of testing a declaration the gate cannot reach, and every
remaining annotation bead reuses it. The pattern has one sharp edge, and it has
already cut four suites, so it is written down here rather than left to be
rediscovered.

### Compiler host keys MUST be forward-slash normalized

A probe suite builds a `ts.CompilerHost` whose `getSourceFile` / `fileExists` /
`readFile` overrides serve synthetic sources out of a `Map` keyed by absolute
path. Build that key with `path.join` alone and it is correct on POSIX and wrong
on Windows: TypeScript runs `normalizePath` over every root name and asks the
host for **forward-slash** paths on every platform, so a
`D:\a\repo\lib\probe.ts` key never matches what the host is asked for. The
override falls through to the real filesystem, the file is not there, and the
probe leaves the program.

The failure mode is what makes this worth a rule. A dropped probe produces no
diagnostics, so every `expectError` assertion built on it — "this source must
NOT compile" — passes on an empty array and asserts the opposite of the truth,
and `program.getSourceFile()` returns `undefined`, which crashes inside the
checker at `getSymbolAtLocation`. That is 26 of the 28 Windows failures the
`6qe.2` bead fixed, and the count had grown 2 → 7 → 13 → 28 as each suite
landed, because each new suite copied the same host construction.

So, in every suite:

- Build host keys, `.d.ts` root names, and anything later handed to
  `program.getSourceFile()` with `probePath()` from
  `tests/_utils/type-probe-paths.js` — one convention per file, not two that
  differ by accident.
- Call `assertProbesLoaded(program, roots)` immediately after
  `ts.createProgram`. A key that is wrong again then fails loudly instead of
  quietly inverting an assertion.

`tests/lib/types/probe-host-paths.js` enforces both. It also demonstrates the
bug and the fix on whatever platform it runs on — `normalizeSlashes` rewrites
backslashes everywhere, so a backslash-keyed host reproduces the Windows
behaviour exactly on macOS and Linux — and it fails when a _new_ suite in
`tests/lib/types/` builds a compiler host without the helper.

### Do not launch `node_modules/.bin/tsc`

A suite that shells out to the compiler must invoke
`node_modules/typescript/bin/tsc` through `process.execPath`, never the `.bin`
shim. On Windows npm writes `tsc.cmd` and `tsc.ps1` there, and the
extension-less `tsc` is a POSIX shell script `CreateProcess` cannot execute:
`spawnSync` fails _before launch_, leaving `status` null and both streams empty
— indistinguishable from a clean run until you notice the assertion message has
nothing in it. Choosing `tsc.cmd` on `win32` instead would work but requires
`shell: true`, which is worse. `tests/lib/types/types.js` pins the entry-point
form.

## Annotating a source file

Two things fell out of converting the four dependency-blocked files in
`lib/shared` (`ajv.js`, `traverser.js`, `translate-cli-options.js`,
`runtime-info.js`) that every later annotation bead will hit.

### A nullable method slot cannot be hoisted into a local

`Traverser` stores its visitors in `this._enter` / `this._leave`, `null` until
`traverse()` runs, and `_traverse` calls them as `this._enter(node, parent)`.
Under `strict`, that is `TS2721: cannot invoke an object which is possibly
null`, and the obvious fix — narrow once into a local and call the local — is a
**silent runtime break**. Visitors are invoked as methods and real ones depend
on it: `hasDynamicExpressions` in
`lib/rules/no-unmodified-loop-condition.js:243` calls `this.break()` and
`this.skip()` from inside `enter`. Hoisting drops that binding, and nothing
type-checks it away.

The form that works is a cast around the member expression and nothing else:

```js
/** @type {TraverserVisitor} */ (this._enter)(node, parent);
```

Parentheses around a member expression preserve the reference, so the call is
still a method call — the cast is a comment and the emitted code is unchanged.
Then give the callback typedef an explicit `this` parameter
(`(this: Traverser, node: ASTNode, …) => void`) so the binding is part of the
declared contract rather than an accident the next reader can hoist away again.

The general rule: when `strict` complains about a `null`-initialized slot, check
whether the value is _called_ before reaching for a local. Escape hatches that
are comment-only are safe; the ones that move code are not.

### `lib/shared` is a leaf, and that is now enforced

`lib/shared` requires nothing else inside `lib/` — only Node builtins, external
packages, other `lib/shared` files, and the root `package.json`. That is the
whole reason it could be annotated before anything else, and a single
`require("../linter/…")` would destroy it without failing any existing gate.
`tests/lib/types/shared-leaf.js` scans the directory's `require()` and dynamic
`import()` specifiers and fails on a relative one that resolves inside `lib/`
but outside `lib/shared/`.

That suite also carries the two-sided compile probes for the four files. They
are worth having even though these files _are_ in the allowlist and _are_
compiled by the gate: an undocumented parameter in a `.js` file is an implicit
`any`, and `any` type-checks clean forever. "The gate is green" and "the module
is typed" are different claims, and only the probes assert the second.

### Types that belong to a later phase

`translate-cli-options.js` needs two shapes that are not in `core.d.ts`: the
parsed CLI options `optionator` produces, and the `ESLint` constructor options
it returns. Both were declared as local `@typedef`s in the file rather than
added to the vocabulary, because the CLI and `lib/eslint/` are annotated in
phase 3+ and that is where those types belong. Each carries a comment saying so.
When those phases land, **move** them — do not leave a second copy behind.

### Annotating `ast-utils.js` before the node union exists

`lib/rules/utils/ast-utils.js` has 193 inbound edges and ~94 exports, most of
them predicates over AST nodes — and the node union those predicates want does
not exist yet. `core.d.ts` carries only the union's agreed base (see "The AST
seam" above): `type` is a bare `string`, and there are no per-node members at
all. Annotating every signature as `ASTNode` and stopping there produces roughly
a thousand `TS2339`s, one per `node.callee` / `node.quasis` / `node.operator`.

What shipped instead is a **single file-local widening**, and it is worth
copying rather than reinventing when the same wall is hit in
`code-path-analyzer.js` or the token store:

```js
/** @typedef {ASTNode & NodeMembers} Node */
```

`NodeMembers` declares the ~35 members this module actually reads. Every
exported signature still names an `ASTNode` — the widening is a view over the
vocabulary, deliberately not a second vocabulary — and it buys no narrowing,
because `type` is still a `string`. It costs 51 annotations and 45 assertions
across 2,962 lines, and its retirement is one delete: when the union lands,
drop `Node` and `NodeMembers` and replace every `Node` with `ASTNode`.

Three decisions inside it are the interesting part.

**Members are non-optional.** The union will make each member present exactly
on the node kinds that have it. An interim view that cannot discriminate has
only two options: offer them unconditionally, or make all 35 `| undefined`. The
second buys no safety — it moves the assertion to every read instead of
concentrating it in one typedef. Nullability the runtime expresses through a
member's _value_ (`id`, `test`, `init`, `alternate`, `elements`, `options`) is
kept, because the code already branches on it.

**`parent` is declared non-`null`, and that is the one overstatement.**
`ASTNode` declares it `ASTNode | null`; the intersection narrows it to `Node`.
`Program.parent` really is `null`, so this is a claim the runtime does not
support. It is made because the alternative is ~40 non-null assertions at sites
that all read `parent` off a node the caller already knows is not the root. The
two walks that _do_ reach the root — `getUpperFunction` and
`isStartOfExpressionStatement` — still test it at runtime, and **those guards
are load-bearing**: nothing stops a later reader from deleting them because the
type says they cannot fire.

**`body` is the one member the widening cannot collapse.** It is a statement
list on `Program` and `BlockStatement` and a single node on every function and
loop, so it is declared `Node | Node[]` and six call sites assert which they
have. That is the honest shape; an `Node[] & Node` intersection would have made
all six compile and would have said something false about every one of them.

The `__proto__: null` lookup table at `needsPrecedingSemicolon` needs its own
assertion, and it needs to go through `unknown`: its inferred type carries a
`__proto__` property typed `null`, so a direct assertion to
`Record<string, string>` is rejected.

`tests/lib/types/rules-ast-utils.js` carries the probes. Two of them outlive the
bead: one walks all 94 exports through the type checker and fails if any
parameter or return type is `any` — the gate cannot see that, because an
implicit `any` type-checks clean forever — and one fails the day `ASTNode.type`
stops being a bare `string`, telling the reader to retire the widening.

### Declaration emit reaches files the allowlist never named

Adding `ast-utils.js` to the allowlist pulled `conf/globals.js` into the program
and therefore into `npm run build:types`. Its tables are plain object literals,
so declaration emit turned each one into an `export namespace` with one `let`
per global — including `let eval`, which is a syntax error in a module (TS1215),
because modules are automatically strict. `tsc --noEmit` never sees it; only
`tests/lib/types/types.js`, which recompiles the emitted declarations, does.

The fix is one `@type {Record<string, boolean>}` per table. No pragma and no
allowlist entry: JSDoc types are read regardless of `checkJs`, so annotating a
file is enough to fix its emit without converting it.

**The transferable rule: an allowlist entry drags its whole `require` subtree
into declaration emit.** Any un-annotated JS file in that subtree whose inferred
shape emits invalid syntax will fail the emit suite, and the error will name a
file nobody touched.

### The traversal demonstration moves when its subject is converted

`tests/lib/types/include-traversal.js` demonstrates the include-vs-traversal
trap against a real un-annotated file, and asserts that its subject still lacks
a `// @ts-check` pragma so the demonstration cannot silently become vacuous.
That guard fired on this bead: its subject _was_ `ast-utils.js`. It now points
at `lib/rules/no-unused-vars.js`, which is in `lib/rules/` and therefore outside
phases 0-2 entirely. When that file is converted, the constant, the fixture in
`tests/fixtures/types/allowlist-growth/` and the two assertions naming it all
move together.

### Deriving a node type instead of restating one

`lib/rules/utils/fix-tracker.js` needs the same node view `ast-utils.js`
invented, because `retainEnclosingFunction` passes its argument straight to
`getUpperFunction`. It does not restate it. It derives it:

```js
/** @typedef {Parameters<typeof astUtils.getUpperFunction>[0]} Node */
```

A second `ASTNode & NodeMembers` typedef would have been shorter to read and
would have drifted the moment either file was edited. More importantly, the
derived form **retires itself**: when the closed union lands and `ast-utils.js`
drops its widening, this typedef silently becomes `ASTNode` and nothing has to
be found and deleted. `tests/lib/types/rules-utils-remainder.js` pins the
coupling from the other side — one test asserts `ast-utils.js` still widens, and
fails with the follow-up written into its message when it stops.

**Prefer deriving a type from the module that owns it over restating it**
wherever one annotated file consumes another's interim vocabulary.

### The `__proto__: null` widening is a recurring shape, not a one-off

`char-source.js` has the same prototype-less dispatch table as
`needsPrecedingSemicolon` in `ast-utils.js`, and it needs the same two-step
widening through `unknown` for the same reason — the inferred type carries a
`__proto__` property typed `null`, which no `Record<...>` assertion accepts
directly.

Two things about it are worth carrying to the next table:

- **Annotating the declaration does not work.** `@type {{[k: string]: string}}`
  on the object literal makes the `__proto__: null` member itself an error
  (`null` is not a `string`). The widening has to sit at the read site.
- **The value type is `string | undefined`, not `string`.** Every one of these
  tables is read by code that tests the result for truthiness and falls through
  on a miss. Typing the lookup `string` makes that guard read as dead code to
  the next person who edits it.

## What this work cost CI, and the two debts it left

`eslint-shreni-beads-6qe`. CI had never been green on this fork. Two of the
three failing jobs trace back to this epic's own footprint — one to the baseline
type strip that preceded it, one to the root `tsconfig.json` it introduced —
and both are held closed by configuration rather than by code. Each carries an
obligation a later phase has to discharge.

### `lib/eslint/worker.js` is a Knip entry point — a STOPGAP, delete it in phase 3+

`worker.js` is loaded only dynamically, through `pathToFileURL` at
`lib/eslint/eslint.js:450`, which Knip cannot follow. Upstream it stayed
reachable through a **static** JSDoc tag at `lib/eslint/eslint.js:67`:

```js
 * @import { WorkerLintResults } from "./worker.js";
```

Commit `6386c7b42` ("Remove types from project for baseline") stripped every
`@import`/`@typedef` repo-wide and deleted that last static reference, so
`npm run lint:unused` has reported `Unused files (1) lib/eslint/worker.js` and
exited 1 on every run since. This is inherited from the strip, not caused by any
annotation bead.

The file is declared in the `"."` workspace's **`entry`** array in `knip.jsonc`,
not in `ignore`. `entry` states the truth — it genuinely is a worker-thread
entry point — where `ignore` would merely silence the report and would also
suppress any real future finding inside the file.

> **Obligation.** The correct long-term fix is the `@import` tag coming back
> when `lib/eslint/` is annotated. `lib/eslint/eslint.js` is outside the
> phases 0–2 scope of `eslint-shreni-beads-y6r`, which is why this could not
> simply be waited out — the job would have stayed red for the rest of that
> epic. **The phase 3+ bead that annotates `lib/eslint/eslint.js` must delete
> the `lib/eslint/worker.js` entry from `knip.jsonc` and confirm `knip` still
> exits 0.** Left in place past that point it masks `worker.js` from Knip
> permanently: if the file later becomes genuinely orphaned, or its real entry
> points change, nothing reports it.

### `ignoreDeprecations` is scoped to `ts-node`, and must stay that way

Cypress loads `cypress.config.js` through its **bundled ts-node** but using
**this project's TypeScript**, and hard-codes
`compilerOptions: { module: "commonjs", moduleResolution: "node" }`. ts-node
only hooks `.js` files when `allowJs` is on — which it became the moment this
fork added a root `tsconfig.json` extending `tsconfig.base.json`. Under
TypeScript 6 that injected `node10` is a hard error:

```text
error TS5107: Option 'moduleResolution=node10' is deprecated and will stop
functioning in TypeScript 7.0.
```

Cypress dies loading its config file, before a single spec runs. The webpack
build succeeds and no `.d.ts` reaches the bundle — nothing about `lib/types/` or
the `@types` devDependencies is involved. The tell is one line above the error:
upstream's green log prints `Couldn't find tsconfig.json`, ours prints
`Missing baseUrl in compilerOptions`, i.e. it found one. So this was introduced
by commit `186ce5981`, and the root `tsconfig.json` is load-bearing and
permanent — it will not resolve itself.

The fix is a top-level `"ts-node"` key in `tsconfig.json`. ts-node reads that
key; `tsc` ignores it entirely.

> **Keep the silencing where it is.** Putting `ignoreDeprecations` into
> `compilerOptions` — in `tsconfig.json` or, worse, `tsconfig.base.json` — also
> makes Cypress load, and also leaves `tsc` at exit 0. It would also silence
> deprecation errors for the **real type-check gate**, which is the one thing in
> this repo that must keep shouting when TypeScript deprecates something.
> Confine it to the ts-node consumer that needs it.

Do not "fix" this instead by removing or renaming the root `tsconfig.json` to
restore upstream's layout. That reaches `package.json` (`lint:types`),
`Makefile.js`, `tsconfig.types.json`, `tests/lib/types/types.js`,
`tests/lib/types/include-traversal.js` and the CI workflow comments — a large
structural change to undo a one-line configuration gap.

### Demonstrated, not asserted

`tests/lib/types/ci-config.js` pins both. The ts-node half does not take
ts-node's merge semantics on trust: it replicates them against the real
compiler — resolving the shipped `tsconfig.json`, overlaying the
`moduleResolution: "node"` Cypress injects, and reading
`program.getOptionsDiagnostics()`. **TS5107 is present without the `ts-node`
key's compiler options and absent with them**, so deleting the key fails the
suite rather than quietly re-breaking Browser Test.

## Publishing a package's declarations

`@eslint/js` is the first package in this repo to ship types, and it is the
cheapest one that could: `packages/js/src` has zero `require` edges into `lib/`
and no runtime dependencies at all. Its whole public surface is one object with
two keys.

### Emitted is not resolved

The repo-root `tsconfig.types.json` emits into `dist/types/` at the root. That
directory is **outside `packages/js`**, so nothing emitted there can ever reach
a consumer of that tarball — the published contents are exactly what
`packages/js/package.json`'s `files` array lists. The package therefore emits
its own declarations, through `packages/js/tsconfig.types.json`, into its own
`dist/`, and `target.buildTypes` in `Makefile.js` runs both.

`rootDir` is the package directory rather than `src`, because `src/index.js`
reads `../package.json` and `resolveJsonModule` makes that JSON file an input to
the program — an input outside `rootDir` is TS6059. Output therefore lands at
`dist/src/*.d.ts`, and that is the path the `types` conditions name.

### The `exports` trap, and why the compiler alone will not catch it

The phase-0 audit's most consequential finding was
`@humanwhocodes/module-importer`: it ships `dist/module-importer.d.ts` **and**
sets a top-level `types` field, and TypeScript still cannot see either, because
its `exports` map has no `types` condition — and once an `exports` map is
present the top-level `types` field is **ignored**. We hand-wrote an ambient
module for it in `lib/types/vendor.d.ts`. Our own package must not become
somebody else's version of that bug.

Two rules, both now pinned by `tests/lib/types/js-package.js`:

- Put a `types` condition **inside** every conditional `exports` entry. Keep the
  top-level `types` field as well, for resolvers that predate `exports` maps,
  but never rely on it.
- Put `types` **first** in each condition object. Conditions match in
  declaration order, so a `types` key after `default` is unreachable.

> **The compiler will not tell you the order is wrong.** Moving `types` after
> `default` was mutation-tested: all fifteen resolution probes in the suite kept
> passing, and only the explicit key-order assertion and `@arethetypeswrong/cli`
> (`FallbackCondition`) failed. That is the argument for attw belonging in this
> phase rather than a later packaging one — the packaging question is not fully
> answerable from the compiler side.

### `eslint` is an optional peer dependency, so the types must stand alone

The ideal typing of `configs.all` / `configs.recommended` would reference the
`Config` vocabulary in `lib/types/core.d.ts`. It deliberately does not:
`@eslint/js` declares `eslint` as an **optional** peer dependency, so a
declaration reaching into the main package would break for every consumer who
never installed it.

Leaving the frozen config literals unannotated is not a compromise here, it is
strictly better. Inference produces the exact rule-name-to-severity map —
`"no-undef": "error"` and 190 siblings — which is precisely the shape user story
3 needs for `eslint.config.ts` autocomplete. A `@type {Config}` annotation would
_widen_ every rule name to `string` **and** create the dependency. The generated
files say so in a header comment, and `tools/update-eslint-{all,recommended}.js`
regenerate both that comment and the `// @ts-check` pragma — the pragma, not the
allowlist, is what turns checking on under `checkJs: false`.

The suite demonstrates the independence rather than asserting it: each
resolution probe compiles with `types: []` and then asserts the program contains
**no source file outside the package** apart from the default `lib` files.

### `cjs-module-lexer` sees bindings, not object literals

`src/index.js` used to build its export inline:

```js
module.exports = { meta: { … }, configs: { all: require(…), … } };
```

attw reported `NamedExports` with `isMissingAllNamed: true`. Node determines
which named exports a CommonJS module offers to ESM importers with
`cjs-module-lexer`, a **static** scan: it recognises shorthand over a binding
but not an inline object literal whose values are expressions. So TypeScript
happily type-checked `import { configs } from "@eslint/js"` while Node threw
`SyntaxError: Named export 'configs' not found` — measured against real Node,
not inferred. Hoisting the two values into `const` bindings and assigning
`module.exports = { meta, configs }` fixes it, with no change to the object
graph.

This is a class of defect neither `tsc` nor a `.d.ts` can see, which is why the
suite pairs the compiler's answer with a real `await import()` of the entry
point.

### `npm run test:types:packaged`

`attw --pack packages/js --profile node16` packs the real tarball and checks it.
`--profile node16` ignores the node10 resolution mode, matching this epic's
stated floor of node16/nodenext and bundler. Phase 7, which owns the main
`eslint` package's own `exports` map — four entries, none with a `types`
condition today — should reuse this script rather than inventing another.

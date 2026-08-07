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
cannot see.

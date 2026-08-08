/**
 * @fileoverview Ambient declarations for runtime dependencies that ship no
 * types of their own and have no `@types/*` package.
 *
 * ESCAPE HATCH. Each declaration here is a hand-written stand-in for a
 * dependency's real types, so it is exactly the kind of drift risk the rest of
 * this project exists to remove. Keep every declaration minimal — declare only
 * the surface ESLint actually calls, so an upstream change to anything else
 * cannot silently invalidate what we wrote. Delete a block the moment the
 * dependency ships its own types.
 */

/**
 * Reason: the package ships `dist/module-importer.d.cts` and sets a top-level
 * `types` field, but its `exports` map has only `require` and `import`
 * conditions — no `types`. TypeScript resolves through `exports` to
 * `src/module-importer.cjs`, never consults the top-level `types` field, and
 * finds no declarations beside the `.cjs` (TS7016). A `paths` mapping in
 * `tsconfig.json` was considered and rejected: it would break silently on an
 * upgrade and is invisible at the call site.
 *
 * Consumed surface, complete: the named `ModuleImporter` export, constructed
 * with no arguments, and its `import` method.
 * `lib/shared/translate-cli-options.js:115` constructs it; `:37` and `:141`
 * call `import`. `resolve` is never used, so it is not declared.
 */
declare module "@humanwhocodes/module-importer" {
	class ModuleImporter {
		/**
		 * Creates an importer that resolves specifiers relative to the current
		 * working directory. ESLint never passes a base directory.
		 */
		constructor();

		/**
		 * Dynamically imports a module by name or path.
		 *
		 * The resolved value is a module namespace object whose members are
		 * whatever the imported plugin or parser chose to export, so `unknown`
		 * is the honest value type — callers must narrow before use, which is
		 * exactly what the `"default" in module` guard at
		 * `translate-cli-options.js:39` does.
		 * @param specifier The module name or path to import.
		 */
		import(specifier: string): Promise<Record<string, unknown>>;
	}
}

/**
 * Reason: `esutils` ships no declarations, and `@types/esutils@2.0.2` is not
 * usable — it declares `strict` as a REQUIRED second parameter of the
 * `isIdentifier*` predicates when it is optional at runtime
 * (`esutils/lib/keyword.js:145,149`), and both ESLint call sites pass one
 * argument, so the package fails to compile against them (TS2554). Adopting it
 * would mean editing runtime code to satisfy a wrong declaration.
 *
 * Consumed surface, complete — three symbols:
 * `keyword.isIdentifierES6` (`lib/rules/func-name-matching.js:57`),
 * `keyword.isIdentifierES5` (`:59`), and `ast.trailingStatement`
 * (`lib/rules/utils/ast-utils.js:1700`, re-exported as `getTrailingStatement`).
 */
declare module "esutils" {
	/**
	 * A statement node, as `ast.trailingStatement` accepts and returns one.
	 *
	 * PLACEHOLDER, deliberately. The phase-0 spike settled on a hand-authored
	 * node vocabulary (see the AST section of
	 * `.shreni/design/typescript-types-from-jsdoc.md`), but the union itself is
	 * authored by a later bead and does not exist yet. This is the smallest
	 * shape that keeps `trailingStatement` — the only `esutils` symbol on
	 * `ast-utils`'s own export surface — off `any`: it carries the two fields
	 * ESLint guarantees on every node and reuses `core.d.ts` for them rather
	 * than re-declaring positions here. Replace it with `Statement | null` the
	 * moment the node union lands; nothing else in this block changes.
	 */
	interface StatementNode {
		type: string;
		range: import("./core.js").SourceRange;
		loc: import("./core.js").SourceLocation;
	}

	namespace keyword {
		/**
		 * Whether `id` is a valid ES5 identifier.
		 * @param id The candidate identifier name.
		 * @param strict Whether to reject strict-mode reserved words. Optional
		 * at runtime, and ESLint always omits it.
		 */
		function isIdentifierES5(id: string, strict?: boolean): boolean;

		/**
		 * Whether `id` is a valid ES6 identifier.
		 * @param id The candidate identifier name.
		 * @param strict Whether to reject strict-mode reserved words. Optional
		 * at runtime, and ESLint always omits it.
		 */
		function isIdentifierES6(id: string, strict?: boolean): boolean;
	}

	namespace ast {
		/**
		 * The statement a node ends with — `alternate` or `consequent` for an
		 * `IfStatement`, `body` for a labeled statement or a loop — or `null`
		 * for every other node type (`esutils/lib/ast.js:94`).
		 * @param node The node to inspect.
		 */
		function trailingStatement(node: StatementNode): StatementNode | null;
	}
}

/**
 * Reason: `file-entry-cache@8` ships no declarations, and neither DefinitelyTyped
 * version fits. `@types/file-entry-cache@10.x` is a deprecated stub that is only
 * correct for v10, and `@types/file-entry-cache@5.0.4` describes v5, where
 * `FileDescriptor.meta` is optional, `readonly`, and holds `{ size, mtime, hash }`.
 *
 * `meta` is the whole reason this block exists: `lib/cli-engine/lint-result-cache.js`
 * writes ESLint's own payload into it, which no upstream package can know about.
 *
 * Consumed surface, complete: `create` (`lint-result-cache.js:90`),
 * `getFileDescriptor` (`:150`, `:185`), `reconcile` (`:212`), and `notFound`,
 * `changed` and `meta` on the descriptor.
 */
declare module "file-entry-cache" {
	/**
	 * A `LintResult` in the form the cache stores it.
	 *
	 * Identical to `LintResult` except for `source`, which is written back as
	 * `null` — rather than dropped — when it was stripped before serialization;
	 * that `null` is the signal `getCachedLintResults` uses to reread the file
	 * from disk. Grounding: written at `lint-result-cache.js:196-203`, read at
	 * `:120-127`.
	 */
	type CachedLintResult = Omit<import("./core.js").LintResult, "source"> & {
		source?: string | null;
	};

	/**
	 * The application-defined payload ESLint stores on a cache entry.
	 *
	 * Both fields are non-optional even though a freshly created entry carries
	 * neither: `getValidCachedLintResults` only reads `results` after
	 * `hashOfConfig` has matched, and `hashOfConfig` only matches once
	 * `setCachedLintResults` has written both. Declaring them optional would
	 * describe a state the readers have already excluded.
	 */
	interface FileDescriptorMeta {
		/** The cached lint result for the entry's file. */
		results: CachedLintResult;

		/** Hash of the config the file was last linted with. */
		hashOfConfig: string;
	}

	/** A cache entry for one file. */
	interface FileDescriptor {
		/** `true` when the file is no longer on disk. */
		notFound: boolean;

		/** `true` when the file changed since the cache was last reconciled. */
		changed?: boolean;

		/** Mutable — `setCachedLintResults` assigns into it directly. */
		meta: FileDescriptorMeta;
	}

	interface FileEntryCache {
		/**
		 * Looks up (or creates) the cache entry for a file.
		 * @param filePath Absolute path to the file.
		 */
		getFileDescriptor(filePath: string): FileDescriptor;

		/** Persists the in-memory cache to disk. */
		reconcile(): void;
	}

	/**
	 * Creates a file entry cache.
	 * @param cacheName Name of the cache file. ESLint passes a full path here
	 * and leaves `directory` undefined.
	 * @param directory Directory to place the cache file in.
	 * @param useChecksum Whether to detect changes by content hash rather than
	 * by size and mtime.
	 */
	function create(
		cacheName: string,
		directory?: string,
		useChecksum?: boolean,
	): FileEntryCache;
}

/**
 * Reason: `imurmurhash` has no bundled types and no `@types/imurmurhash` on
 * npm. Used by `lib/cli-engine/hash.js` only, via the functional form.
 */
declare module "imurmurhash" {
	interface MurmurHash3 {
		/** Incrementally hashes more text into the current state. */
		hash(value: string): MurmurHash3;

		/** Returns the 32-bit hash of everything hashed so far. */
		result(): number;

		/** Resets the state, optionally to a new seed. */
		reset(seed?: number): MurmurHash3;
	}

	/** Creates a hasher, optionally seeding it with an initial string. */
	function murmurHash3(value?: string, seed?: number): MurmurHash3;

	export = murmurHash3;
}

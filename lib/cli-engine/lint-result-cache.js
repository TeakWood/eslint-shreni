/**
 * @fileoverview Utility for caching lint results.
 * @author Kevin Partington
 */

// @ts-check

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const fs = require("node:fs");

/*
 * `file-entry-cache` publishes no type declarations and has no `@types`
 * package, so tsc cannot infer a type for it. Only the two members this file
 * uses are described, by the `FileEntryCacheModule` typedef below, and the
 * module is read through that type so the `any` never reaches the emitted
 * declarations.
 */
/** @type {FileEntryCacheModule} */
// @ts-ignore -- untyped dependency, see above
const fileEntryCache = require("file-entry-cache");
const stringify = require("json-stable-stringify-without-jsonify");
const pkg = require("../../package.json");
const assert = require("../shared/assert");
const hash = require("./hash");

const debug = require("debug")("eslint:lint-result-cache");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").LintResult} LintResult */

/**
 * How a file's freshness is decided: `"metadata"` compares size and mtime,
 * `"content"` compares a checksum of the file's contents.
 * @typedef {"metadata" | "content"} CacheStrategy
 */

/**
 * A lint result as it is held in the cache file. `source` is stored as `null`
 * rather than as the file's text, which is what tells
 * `getCachedLintResults()` to read it back off disk.
 * @typedef {Omit<LintResult, "source"> & { source?: string | null }} CachedLintResult
 */

/**
 * The bookkeeping `file-entry-cache` stores alongside each file, extended with
 * the two properties this module adds to it.
 * @typedef {Object} FileDescriptorMeta
 * @property {CachedLintResult} [results] The lint result recorded for the file.
 * @property {string} [hashOfConfig] The hash of the config the file was linted with.
 */

/**
 * The entry `file-entry-cache` returns for a single file.
 * @typedef {Object} FileDescriptor
 * @property {string} key The path the entry is stored under.
 * @property {boolean} changed Whether the file changed since it was last seen.
 * @property {boolean} [notFound] Whether the file is missing from the filesystem.
 * @property {FileDescriptorMeta} meta The bookkeeping stored for the file.
 */

/**
 * The part of the `file-entry-cache` module this file depends on.
 * @typedef {Object} FileEntryCacheModule
 * @property {(cacheId: string, directory?: string, useChecksum?: boolean) => FileEntryCacheInstance} create Creates a cache backed by the given file.
 */

/**
 * The part of a `file-entry-cache` instance this file depends on.
 * @typedef {Object} FileEntryCacheInstance
 * @property {(filePath: string) => FileDescriptor} getFileDescriptor Returns the entry for a file, creating it if necessary.
 * @property {() => void} reconcile Writes the in-memory entries out to disk.
 */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/** @type {WeakMap<object, string>} */
const configHashCache = new WeakMap();
const nodeVersion = process && process.version;

/** @type {Array<CacheStrategy>} */
const validCacheStrategies = ["metadata", "content"];
const invalidCacheStrategyErrorMessage = `Cache strategy must be one of: ${validCacheStrategies
	.map(strategy => `"${strategy}"`)
	.join(", ")}`;

/**
 * Tests whether a provided cacheStrategy is valid
 * @param {CacheStrategy} cacheStrategy The cache strategy to use
 * @returns {boolean} true if `cacheStrategy` is one of `validCacheStrategies`; false otherwise
 */
function isValidCacheStrategy(cacheStrategy) {
	return validCacheStrategies.includes(cacheStrategy);
}

/**
 * Calculates the hash of the config
 * @param {object} config The config.
 * @returns {string} The hash of the config
 */
function hashOfConfigFor(config) {
	if (!configHashCache.has(config)) {
		configHashCache.set(
			config,
			hash(`${pkg.version}_${nodeVersion}_${stringify(config)}`),
		);
	}

	/*
	 * The `set()` above runs whenever the key is absent, so the lookup can no
	 * longer miss.
	 */
	return /** @type {string} */ (configHashCache.get(config));
}

//-----------------------------------------------------------------------------
// Public Interface
//-----------------------------------------------------------------------------

/**
 * Lint result cache. This wraps around the file-entry-cache module,
 * transparently removing properties that are difficult or expensive to
 * serialize and adding them back in on retrieval.
 */
class LintResultCache {
	/**
	 * Creates a new LintResultCache instance.
	 * @param {string} cacheFileLocation The cache file location.
	 * @param {CacheStrategy} cacheStrategy The cache strategy to use.
	 * @throws {Error} When either argument is missing or the strategy is unknown.
	 */
	constructor(cacheFileLocation, cacheStrategy) {
		assert(cacheFileLocation, "Cache file location is required");
		assert(cacheStrategy, "Cache strategy is required");
		assert(
			isValidCacheStrategy(cacheStrategy),
			invalidCacheStrategyErrorMessage,
		);

		debug(`Caching results to ${cacheFileLocation}`);

		const useChecksum = cacheStrategy === "content";

		debug(`Using "${cacheStrategy}" strategy to detect changes`);

		this.fileEntryCache = fileEntryCache.create(
			cacheFileLocation,
			void 0,
			useChecksum,
		);
		this.cacheFileLocation = cacheFileLocation;
	}

	/**
	 * Retrieve cached lint results for a given file path, if present in the
	 * cache. If the file is present and has not been changed, rebuild any
	 * missing result information.
	 * @param {string} filePath The file for which to retrieve lint results.
	 * @param {object} config The config of the file.
	 * @returns {LintResult|null|undefined} The rebuilt lint results, or null if the file is
	 *   changed or not in the filesystem.
	 */
	getCachedLintResults(filePath, config) {
		const cachedResults = this.getValidCachedLintResults(filePath, config);

		if (!cachedResults) {
			return cachedResults;
		}

		/*
		 * Shallow clone the object to ensure that any properties added or modified afterwards
		 * will not be accidentally stored in the cache file when `reconcile()` is called.
		 * https://github.com/eslint/eslint/issues/13507
		 * All intentional changes to the cache file must be done through `setCachedLintResults()`.
		 */
		const results = { ...cachedResults };

		// If source is present but null, need to reread the file from the filesystem.
		if (results.source === null) {
			debug(
				`Rereading cached result source from filesystem: ${filePath}`,
			);
			results.source = fs.readFileSync(filePath, "utf-8");
		}

		/*
		 * The only way `source` reaches the cache is as `null`, and the branch
		 * above has just replaced any such value with the file's text, so what
		 * leaves here has the plain `LintResult` shape again.
		 */
		return /** @type {LintResult} */ (results);
	}

	/**
	 * Retrieve cached lint results for a given file path, if present in the
	 * cache and still valid.
	 * @param {string} filePath The file for which to retrieve lint results.
	 * @param {object} config The config of the file.
	 * @returns {CachedLintResult|null|undefined} The cached lint results if present in the cache
	 * and still valid; null otherwise. `undefined` when the entry is valid but
	 * carries no result, which a cache file written by an older version can do.
	 */
	getValidCachedLintResults(filePath, config) {
		/*
		 * Cached lint results are valid if and only if:
		 * 1. The file is present in the filesystem
		 * 2. The file has not changed since the time it was previously linted
		 * 3. The ESLint configuration has not changed since the time the file
		 *    was previously linted
		 * If any of these are not true, we will not reuse the lint results.
		 */
		const fileDescriptor = this.fileEntryCache.getFileDescriptor(filePath);

		if (fileDescriptor.notFound) {
			debug(`File not found on the file system: ${filePath}`);
			return null;
		}

		const hashOfConfig = hashOfConfigFor(config);
		const changed =
			fileDescriptor.changed ||
			fileDescriptor.meta.hashOfConfig !== hashOfConfig;

		if (changed) {
			debug(`Cache entry not found or no longer valid: ${filePath}`);
			return null;
		}

		return fileDescriptor.meta.results;
	}

	/**
	 * Set the cached lint results for a given file path, after removing any
	 * information that will be both unnecessary and difficult to serialize.
	 * Avoids caching results with an "output" property (meaning fixes were
	 * applied), to prevent potentially incorrect results if fixes are not
	 * written to disk.
	 * @param {string} filePath The file for which to set lint results.
	 * @param {object} config The config of the file.
	 * @param {LintResult} [result] The lint result to be set for the file.
	 * @returns {void}
	 */
	setCachedLintResults(filePath, config, result) {
		if (result && Object.hasOwn(result, "output")) {
			return;
		}

		const fileDescriptor = this.fileEntryCache.getFileDescriptor(filePath);

		if (fileDescriptor && !fileDescriptor.notFound) {
			debug(`Updating cached result: ${filePath}`);

			// Serialize the result, except that we want to remove the file source if present.
			const resultToSerialize = /** @type {CachedLintResult} */ (
				Object.assign({}, result)
			);

			/*
			 * Set result.source to null.
			 * In `getCachedLintResults`, if source is explicitly null, we will
			 * read the file from the filesystem to set the value again.
			 */
			if (Object.hasOwn(resultToSerialize, "source")) {
				resultToSerialize.source = null;
			}

			fileDescriptor.meta.results = resultToSerialize;
			fileDescriptor.meta.hashOfConfig = hashOfConfigFor(config);
		}
	}

	/**
	 * Persists the in-memory cache to disk.
	 * @returns {void}
	 */
	reconcile() {
		debug(`Persisting cached results: ${this.cacheFileLocation}`);
		this.fileEntryCache.reconcile();
	}
}

module.exports = LintResultCache;

/**
 * @fileoverview Worker thread for multithread linting.
 * @author Francesco Trotta
 */

// @ts-check

"use strict";

const hrtimeBigint = process.hrtime.bigint;

const startTime = hrtimeBigint();

// eslint-disable-next-line n/no-unsupported-features/node-builtins -- enable V8's code cache if supported
require("node:module").enableCompileCache?.();

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { parentPort, threadId, workerData } = require("node:worker_threads");
const {
	createConfigLoader,
	createDebug,
	createDefaultConfigs,
	createLinter,
	createLintResultCache,
	getCacheFile,
	lintFile,
	loadOptionsFromModule,
	processOptions,
} = require("./eslint-helpers");
const { WarningService } = require("../services/warning-service");
const timing = require("../linter/timing");

const depsLoadedTime = hrtimeBigint();

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").LintResult} LintResult */
/** @typedef {import("../linter/timing.js").TimingData} TimingData */
/** @typedef {import("./eslint-helpers.js").ESLintOptions} ESLintOptions */

/**
 * A lint result tagged with the index of the file it came from, so the
 * controlling thread can restore the original file order.
 * @typedef {LintResult & { index: number }} IndexedLintResult
 */

/**
 * The message a worker posts back. It is an array of results that also carries
 * the thread's own measurements as properties on the array itself.
 * @typedef {Array<IndexedLintResult> & {
 *   netLintingDuration?: bigint,
 *   timings?: TimingData
 * }} WorkerMessage
 */

/**
 * The data the controlling thread hands each worker on startup.
 * @typedef {Object} WorkerData
 * @property {ESLintOptions|string} eslintOptionsOrURL The unprocessed ESLint
 *      options, or the URL of the module to load them from.
 * @property {Uint32Array} filePathIndexArray The shared cursor workers use to
 *      claim the next file.
 * @property {Array<string>} filePaths The file paths to lint.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const debug = createDebug(`eslint:worker:thread-${threadId}`);

//------------------------------------------------------------------------------
// Main
//------------------------------------------------------------------------------

/*
 * Prevent timing module from printing profiling output from worker threads.
 * The main thread is responsible for displaying any aggregated timings.
 */
timing.disableDisplay();

debug("Dependencies loaded in %t", depsLoadedTime - startTime);

(async () => {
	const { eslintOptionsOrURL, filePathIndexArray, filePaths } =
		/** @type {WorkerData} */ (workerData);
	const eslintOptions =
		typeof eslintOptionsOrURL === "object"
			? eslintOptionsOrURL
			: await loadOptionsFromModule(eslintOptionsOrURL);
	const processedESLintOptions = processOptions(eslintOptions);

	const warningService = new WarningService();

	// These warnings are always emitted by the controlling thread.
	warningService.emitEmptyConfigWarning =
		warningService.emitInactiveFlagWarning = () => {};

	const linter = createLinter(processedESLintOptions, warningService);

	const cacheFilePath = getCacheFile(
		processedESLintOptions.cacheLocation,
		processedESLintOptions.cwd,
	);

	const lintResultCache = createLintResultCache(
		processedESLintOptions,
		cacheFilePath,
	);
	const defaultConfigs = createDefaultConfigs(eslintOptions.plugins);

	const configLoader = createConfigLoader(
		processedESLintOptions,
		defaultConfigs,
		linter,
		warningService,
	);

	/** @type {WorkerMessage} */
	const indexedResults = [];

	let loadConfigTotalDuration = 0n;
	const readFileCounter = { duration: 0n };

	const lintingStartTime = hrtimeBigint();
	debug(
		"Linting started %t after dependencies loaded",
		lintingStartTime - depsLoadedTime,
	);

	for (;;) {
		const fileLintingStartTime = hrtimeBigint();

		// It seems hard to produce an arithmetic overflow under realistic conditions here.
		const index = Atomics.add(filePathIndexArray, 0, 1);

		const filePath = filePaths[index];
		if (!filePath) {
			break;
		}

		const loadConfigEnterTime = hrtimeBigint();
		const configs = await configLoader.loadConfigArrayForFile(filePath);
		const loadConfigExitTime = hrtimeBigint();
		const loadConfigDuration = loadConfigExitTime - loadConfigEnterTime;
		debug(
			'Config array for file "%s" loaded in %t',
			filePath,
			loadConfigDuration,
		);
		loadConfigTotalDuration += loadConfigDuration;

		const result = await lintFile(
			filePath,
			configs,
			processedESLintOptions,
			linter,
			lintResultCache,
			readFileCounter,
		);
		if (result) {
			/*
			 * Tagging the result is what makes it an indexed one; the cast
			 * names the shape the very next line establishes.
			 */
			const indexedResult = /** @type {IndexedLintResult} */ (result);

			indexedResult.index = index;
			indexedResults.push(indexedResult);
		}

		const fileLintingEndTime = hrtimeBigint();
		debug(
			'File "%s" processed in %t',
			filePath,
			fileLintingEndTime - fileLintingStartTime,
		);
	}

	const lintingDuration = hrtimeBigint() - lintingStartTime;

	/*
	 * The net linting duration is the total linting time minus the time spent loading configs and reading files.
	 * It captures the processing time dedicated to computation-intensive tasks that are highly parallelizable and not repeated across threads.
	 */
	indexedResults.netLintingDuration =
		lintingDuration - loadConfigTotalDuration - readFileCounter.duration;

	if (timing.enabled) {
		indexedResults.timings = timing.getData();
	}

	// This module only ever runs as a worker, so there is always a parent port.
	/** @type {MessagePort} */ (parentPort).postMessage(indexedResults);
})();

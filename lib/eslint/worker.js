// @ts-check
/**
 * @fileoverview Worker thread for multithread linting.
 * @author Francesco Trotta
 */

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

/** @typedef {import("../linter/timing.js").TimingData} TimingData */
/** @typedef {import("../shared/types.js").LintResult} LintResult */
/** @typedef {import("./eslint-helpers.js").ESLintOptions} ESLintOptions */

/**
 * A lint result tagged with the position its file holds in the shared file
 * list, so that the controlling thread can put the results from every thread
 * back into the order the caller asked for. The tag is deleted there.
 * @typedef {LintResult & { index: number }} IndexedLintResult
 */

/**
 * What a worker posts back to the controlling thread.
 *
 * The thread's own measurements ride along as properties on the array rather
 * than in a wrapper object, which is the shape `lib/eslint/eslint.js` reads.
 * @typedef {IndexedLintResult[] & { netLintingDuration?: bigint, timings?: TimingData }} WorkerResults
 */

/**
 * The data the controlling thread passes to this worker.
 * @typedef {Object} WorkerInput
 * @property {ESLintOptions | string} eslintOptionsOrURL The unprocessed ESLint options, or the URL of the module to load them from.
 * @property {Uint32Array} filePathIndexArray The shared cursor into `filePaths`, which every thread advances atomically.
 * @property {string[]} filePaths The paths of every file to lint.
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
		/** @type {WorkerInput} */ (workerData);
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

	/** @type {WorkerResults} */
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

	/*
	 * Only ever loaded as a worker thread's entry point, where `parentPort` is
	 * always set; it is `null` only on the main thread.
	 */
	const port = /** @type {MessagePort} */ (parentPort);

	port.postMessage(indexedResults);
})();

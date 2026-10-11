/**
 * @fileoverview Type-level tests for the `lib/eslint/` annotations.
 *
 * `lib/eslint/` is the consumer-facing API, so these tests assert what its
 * annotations accept and reject rather than that the tags are present. Each one
 * type-checks a probe module through the real `tsconfig.json`, so it fails if a
 * later change loosens a shape.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert;

const {
	formatDiagnostics,
	typeCheckProbe,
} = require("../../_utils/type-probe");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/*
 * The probe sits inside `lib/eslint/`, so it reaches the modules under test
 * through the same relative paths they use on each other. It never touches the
 * source tree: `typeCheckProbe()` serves it from memory.
 */
const PROBE_PATH = "lib/eslint/__type-probe__.js";

/**
 * Type-checks a probe module as if it sat in `lib/eslint/`.
 * @param {string[]} lines The probe's lines, joined with newlines.
 * @returns {readonly import("typescript").Diagnostic[]} The probe's diagnostics.
 */
function checkProbe(lines) {
	return typeCheckProbe(['"use strict";', ...lines].join("\n"), PROBE_PATH);
}

/**
 * Asserts that a probe type-checks cleanly.
 * @param {string[]} lines The probe's lines.
 * @param {string} message The assertion message.
 * @returns {void}
 */
function assertAccepts(lines, message) {
	const diagnostics = checkProbe(lines);

	assert.strictEqual(
		diagnostics.length,
		0,
		`${message}:\n${formatDiagnostics(diagnostics)}`,
	);
}

/**
 * Asserts that a probe is rejected, and for a reason of its own.
 *
 * A probe that declares a stand-in with `let` rather than `declared()` is
 * rejected for being read before assignment, which would make any negative
 * assertion pass without testing anything.
 * @param {string[]} lines The probe's lines.
 * @param {string} message The assertion message.
 * @returns {void}
 */
function assertRejects(lines, message) {
	const diagnostics = checkProbe(lines);

	assert.isNotEmpty(diagnostics, message);
	assert.notInclude(
		diagnostics.map(diagnostic => diagnostic.code),
		2454,
		`${message}, not for an unassigned stand-in:\n${formatDiagnostics(diagnostics)}`,
	);
}

/*
 * Every probe needs values to call methods on, and building a real config array
 * or lint result means running a lint. This stands in for one: it is only ever
 * type-checked, never run.
 */
const DECLARE_STAND_IN = [
	"/**",
	" * Stands in for a value the probe never evaluates.",
	" * @returns {any} Nothing; a type-level probe is not run.",
	" */",
	"function declared() {",
	'	throw new Error("type-level only");',
	"}",
];

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("eslint types", () => {
	describe("ESLintOptions", () => {
		it("should accept the full set of supported options", () => {
			assertAccepts(
				[
					'const { processOptions } = require("./eslint-helpers.js");',
					"",
					"processOptions({",
					"	allowInlineConfig: false,",
					"	baseConfig: [{ rules: {} }],",
					"	cache: true,",
					'	cacheLocation: ".cache",',
					'	cacheStrategy: "content",',
					"	concurrency: 4,",
					'	cwd: "/tmp",',
					"	errorOnUnmatchedPattern: false,",
					"	fix: message => message.severity === 2,",
					'	fixTypes: ["directive", "problem"],',
					'	flags: ["x_feature"],',
					"	globInputPaths: false,",
					"	ignore: false,",
					'	ignorePatterns: ["dist"],',
					"	overrideConfig: { rules: {} },",
					'	overrideConfigFile: "eslint.config.js",',
					"	plugins: {},",
					"	stats: true,",
					"	warnIgnored: false,",
					"	passOnNoPatterns: true,",
					"	ruleFilter: ({ ruleId, severity }) => {",
					"		void ruleId;",
					"		return severity === 2;",
					"	},",
					"	applySuppressions: true,",
					'	suppressionsLocation: "s.json",',
					"});",
				],
				"every supported option should be accepted",
			);
		});

		it("should reject an unknown option, so the type catches what the runtime check reports", () => {
			/*
			 * `processOptions()` collects unknown keys into an error message at
			 * runtime. Keeping the typedef closed means a typed caller never
			 * gets that far.
			 */
			assertRejects(
				[
					'const { processOptions } = require("./eslint-helpers.js");',
					"",
					'processOptions({ cacheFile: ".cache" });',
				],
				"a removed option should be rejected",
			);
		});

		it("should reject a wrongly-typed known option", () => {
			assertRejects(
				[
					'const { processOptions } = require("./eslint-helpers.js");',
					"",
					'processOptions({ cacheStrategy: "mtime" });',
				],
				"an unsupported cache strategy should be rejected",
			);
		});

		it("should reject a fix type no rule can report", () => {
			assertRejects(
				[
					'const { processOptions } = require("./eslint-helpers.js");',
					"",
					'processOptions({ fixTypes: ["stylistic"] });',
				],
				"an unknown fix type should be rejected",
			);
		});
	});

	describe("ProcessedESLintOptions", () => {
		it("should fill in every default, so `cwd` is no longer optional", () => {
			assertAccepts(
				[
					'const { processOptions } = require("./eslint-helpers.js");',
					"",
					"/** @type {string} */",
					"const cwd = processOptions({}).cwd;",
					"",
					"void cwd;",
				],
				"`cwd` should be present after processing",
			);
		});

		it("should resolve `overrideConfigFile: true` into `configFile: false`", () => {
			/*
			 * `true` means "use no config file and do not look for one", which
			 * the loader spells as `false`. The processed type therefore has no
			 * `true` in it.
			 */
			assertRejects(
				[
					'const { processOptions } = require("./eslint-helpers.js");',
					"",
					"/** @type {true} */",
					"const configFile = processOptions({",
					"	overrideConfigFile: true,",
					"}).configFile;",
					"",
					"void configFile;",
				],
				"`configFile` should never be `true`",
			);
		});

		it("should satisfy `ConfigLoaderOptions`, which the loader is built from", () => {
			/*
			 * `processOptions()` defaults `overrideConfigFile` to `null`, so
			 * `configFile` is `null` rather than absent. `ConfigLoaderOptions`
			 * has to admit that, or `createConfigLoader()` cannot be typed.
			 */
			assertAccepts(
				[
					'const { ConfigLoader } = require("../config/config-loader.js");',
					'const { processOptions } = require("./eslint-helpers.js");',
					"",
					"const { cwd, configFile } = processOptions({});",
					"",
					"void new ConfigLoader({ cwd, configFile });",
				],
				"a processed `configFile` should be a valid loader option",
			);
		});
	});

	describe("verifyText", () => {
		it("should require the working directory, which the placeholder path is built from", () => {
			assertRejects(
				[
					'const { verifyText } = require("./eslint-helpers.js");',
					...DECLARE_STAND_IN,
					"",
					"verifyText({",
					'	text: "foo;",',
					"	configs: declared(),",
					"	fix: false,",
					"	allowInlineConfig: true,",
					"	ruleFilter: () => true,",
					"	stats: false,",
					"	linter: declared(),",
					"});",
				],
				"omitting `cwd` should be rejected",
			);
		});

		it("should accept a fix predicate, which is how `fixTypes` is applied", () => {
			/*
			 * `getFixerForFixTypes()` turns the `fixTypes` option into a
			 * predicate and hands it to `verifyText()` as `fix`, which then
			 * passes it to `Linter#verifyAndFix`. Both have to accept one.
			 */
			assertAccepts(
				[
					'const { verifyText } = require("./eslint-helpers.js");',
					...DECLARE_STAND_IN,
					"",
					"verifyText({",
					'	text: "foo;",',
					'	cwd: "/tmp",',
					"	configs: declared(),",
					"	fix: message => message.ruleId !== null,",
					"	allowInlineConfig: true,",
					"	ruleFilter: () => true,",
					"	stats: false,",
					"	linter: declared(),",
					"});",
				],
				"a fix predicate should be accepted",
			);
		});
	});

	describe("ESLint", () => {
		it("should accept either a pattern or a list of them", () => {
			assertAccepts(
				[
					'const { ESLint } = require("./eslint.js");',
					"",
					"const eslint = new ESLint();",
					"",
					'void eslint.lintFiles("lib");',
					'void eslint.lintFiles(["lib", "tests"]);',
				],
				"both pattern forms should be accepted",
			);
		});

		it("should reject a pattern that is not a string", () => {
			assertRejects(
				[
					'const { ESLint } = require("./eslint.js");',
					"",
					"void new ESLint().lintFiles(42);",
				],
				"a numeric pattern should be rejected",
			);
		});

		it("should reject an unknown `lintText` option, which it reports at runtime too", () => {
			assertRejects(
				[
					'const { ESLint } = require("./eslint.js");',
					"",
					'void new ESLint().lintText("foo;", { fileName: "a.js" });',
				],
				"a misspelled option should be rejected",
			);
		});

		it("should hand back results whose messages carry a severity", () => {
			assertAccepts(
				[
					'const { ESLint } = require("./eslint.js");',
					"",
					"/**",
					" * Reads the first severity reported for a file.",
					" * @param {string} file The file to lint.",
					" * @returns {Promise<number | undefined>} The severity, if any.",
					" */",
					"async function firstSeverity(file) {",
					"	const results = await new ESLint().lintFiles(file);",
					"",
					"	return results[0].messages[0]?.severity;",
					"}",
					"",
					"void firstSeverity;",
				],
				"a lint result should be fully typed",
			);
		});

		it("should resolve a config for a file to `undefined` when the file is ignored", () => {
			/*
			 * `calculateConfigForFile()` returns nothing for a path no config
			 * object matches, which is exactly what `isPathIgnored()` reads, so
			 * a caller has to handle the gap.
			 */
			assertRejects(
				[
					'const { ESLint } = require("./eslint.js");',
					"",
					"/**",
					" * Reads the rules configured for a file.",
					" * @param {string} file The file to look up.",
					" * @returns {Promise<unknown>} The configured rules.",
					" */",
					"async function rulesFor(file) {",
					"	const config = await new ESLint().calculateConfigForFile(file);",
					"",
					"	return config.rules;",
					"}",
					"",
					"void rulesFor;",
				],
				"a missing config should have to be handled",
			);
		});

		it("should keep a rule's `meta` optional in the results metadata", () => {
			/*
			 * `createRulesMeta()` copies `rule.meta` straight across, and a
			 * rule need not declare one, so a caller has to handle the gap.
			 */
			assertRejects(
				[
					'const { ESLint } = require("./eslint.js");',
					...DECLARE_STAND_IN,
					"",
					"const rulesMeta = new ESLint().getRulesMetaForResults(",
					"	declared(),",
					");",
					"",
					'void rulesMeta["no-undef"].type;',
				],
				"a missing `meta` should have to be handled",
			);
		});

		it("should require a URL for `fromOptionsModule`", () => {
			assertRejects(
				[
					'const { ESLint } = require("./eslint.js");',
					"",
					'void ESLint.fromOptionsModule("file:///options.mjs");',
				],
				"a string should be rejected where a URL is required",
			);
		});

		it("should resolve a formatter to an object with a `format` method", () => {
			assertAccepts(
				[
					'const { ESLint } = require("./eslint.js");',
					...DECLARE_STAND_IN,
					"",
					"/**",
					" * Formats results with the default formatter.",
					' * @param {import("../shared/types.js").LintResult[]} results The results.',
					" * @returns {Promise<string>} The formatted output.",
					" */",
					"async function format(results) {",
					"	const formatter = await new ESLint().loadFormatter();",
					"",
					"	return formatter.format(results, {",
					"		maxWarningsExceeded: { maxWarnings: 1, foundWarnings: 2 },",
					"	});",
					"}",
					"",
					"void format;",
				],
				"a loaded formatter should be callable with results and metadata",
			);
		});
	});

	describe("calculateWorkerCount", () => {
		it("should accept an `os` stand-in that only provides `availableParallelism`", () => {
			/*
			 * This is the seam `tests/lib/eslint/eslint.js` uses to pin the
			 * worker-count arithmetic without depending on the host's core
			 * count, so the parameter must not require the whole `os` module.
			 */
			assertAccepts(
				[
					'const { calculateWorkerCount } = require("./eslint.js");',
					...DECLARE_STAND_IN,
					"",
					"void calculateWorkerCount(declared(), [], {",
					"	availableParallelism: () => 8,",
					"});",
				],
				"an `availableParallelism`-only stand-in should be accepted",
			);
		});
	});

	describe("worker protocol", () => {
		it("should tag each result with its index and carry the thread's timings on the array", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					"",
					'/** @type {import("./worker.js").WorkerResults} */',
					"const results = declared();",
					"",
					"/** @type {number} */",
					"const index = results[0].index;",
					"",
					"/** @type {bigint | undefined} */",
					"const duration = results.netLintingDuration;",
					"",
					"void index;",
					"void duration;",
				],
				"the worker protocol should be typed on both the array and its elements",
			);
		});
	});
});

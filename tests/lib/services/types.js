/**
 * @fileoverview Type-level tests for the `lib/services/` annotations.
 *
 * The three services sit on the boundary between `Linter`/`ESLint` and a
 * user-supplied language or processor, so these tests assert what their
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
 * The probe sits inside `lib/services/`, so it reaches the modules under test
 * through the same relative paths they use on each other. It never touches the
 * source tree: `typeCheckProbe()` serves it from memory.
 */
const PROBE_PATH = "lib/services/__type-probe__.js";

/**
 * Type-checks a probe module as if it sat in `lib/services/`.
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
 * Every probe needs values to call methods on, and building a real config or
 * source code object means building a whole config array and AST. This stands
 * in for one: it is only ever type-checked, never run.
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

describe("services types", () => {
	describe("ParserService", () => {
		it("should keep the parse result a union, so a caller has to check `ok` first", () => {
			assertRejects(
				[
					'const { ParserService } = require("./parser-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const result = new ParserService().parseSync(",
					"	declared(),",
					"	declared(),",
					");",
					"",
					"void result.sourceCode;",
				],
				"reading `sourceCode` without checking `ok` should be rejected",
			);
		});

		it("should narrow to the source code once `ok` is checked", () => {
			assertAccepts(
				[
					'const { ParserService } = require("./parser-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const result = new ParserService().parseSync(",
					"	declared(),",
					"	declared(),",
					");",
					"",
					"if (result.ok) {",
					"	void result.sourceCode;",
					"} else {",
					"	/** @type {import('../shared/types.js').LintMessage[]} */",
					"	const errors = result.errors;",
					"",
					"	void errors;",
					"}",
				],
				"`ok` should discriminate the parse result",
			);
		});
	});

	describe("ProcessorService", () => {
		it("should keep the preprocess result a union, so a caller has to check `ok` first", () => {
			assertRejects(
				[
					'const { ProcessorService } = require("./processor-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const result = new ProcessorService().preprocessSync(",
					"	declared(),",
					"	declared(),",
					");",
					"",
					"void result.files;",
				],
				"reading `files` without checking `ok` should be rejected",
			);
		});

		it("should hand back blocks that may still be bare strings, which is the legacy form", () => {
			assertAccepts(
				[
					'const { ProcessorService } = require("./processor-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const result = new ProcessorService().preprocessSync(",
					"	declared(),",
					"	declared(),",
					");",
					"",
					"if (result.ok) {",
					"	/** @type {(string | import('../linter/vfile.js').VFile)[]} */",
					"	const files = result.files;",
					"",
					"	void files;",
					"}",
				],
				"a block should be either a file or a string",
			);
		});

		it("should accept the inline processor `Linter` builds out of its verify options", () => {
			/*
			 * `lib/linter/linter.js` calls the service with `{ processor: {
			 * preprocess, postprocess } }`, where both come from the verify
			 * options rather than from a config. Typing `processor` as the
			 * hub's `Processor` has to keep accepting that.
			 */
			assertAccepts(
				[
					'const { ProcessorService } = require("./processor-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const service = new ProcessorService();",
					"",
					"service.preprocessSync(declared(), {",
					"	processor: {",
					"		preprocess: rawText => [rawText],",
					"		postprocess: messagesList => messagesList.flat(),",
					"	},",
					"});",
				],
				"the inline processor should satisfy `ProcessorConfig`",
			);
		});

		it("should reject a processor whose `preprocess` is not callable", () => {
			assertRejects(
				[
					'const { ProcessorService } = require("./processor-service.js");',
					...DECLARE_STAND_IN,
					"",
					"new ProcessorService().preprocessSync(declared(), {",
					'	processor: { preprocess: "nope", postprocess: () => [] },',
					"});",
				],
				"a non-callable `preprocess` should be rejected",
			);
		});
	});

	describe("WarningService", () => {
		it("should accept an `emitWarning` taking only the message", () => {
			/*
			 * The type is written so that a caller can supply a narrower
			 * function than `process.emitWarning`, which the browser build and
			 * the tests both do.
			 */
			assertAccepts(
				[
					'const { WarningService } = require("./warning-service.js");',
					"",
					"const service = new WarningService({",
					"	emitWarning: message => {",
					"		void message.length;",
					"	},",
					"});",
					"",
					'service.emitCircularFixesWarning("a.js");',
				],
				"a one-parameter `emitWarning` should be accepted",
			);
		});

		it("should reject a non-function `emitWarning`", () => {
			assertRejects(
				[
					'const { WarningService } = require("./warning-service.js");',
					"",
					'new WarningService({ emitWarning: "nope" });',
				],
				"a non-callable `emitWarning` should be rejected",
			);
		});

		it("should reject a misspelled option key", () => {
			assertRejects(
				[
					'const { WarningService } = require("./warning-service.js");',
					"",
					"new WarningService({ emitWarnings: () => {} });",
				],
				"an unknown option should be rejected",
			);
		});
	});

	describe("SuppressionsService", () => {
		it("should require both of its options", () => {
			assertRejects(
				[
					'const { SuppressionsService } = require("./suppressions-service.js");',
					"",
					'new SuppressionsService({ filePath: "s.json" });',
					"",
				],
				"omitting `cwd` should be rejected",
			);
		});

		it("should report unused suppressions as counts nested by file and rule", () => {
			assertAccepts(
				[
					'const { SuppressionsService } = require("./suppressions-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const service = new SuppressionsService({",
					'	filePath: "s.json",',
					'	cwd: "/",',
					"});",
					"const { unused } = service.applySuppressions(declared(), {});",
					"",
					"/** @type {number} */",
					'const count = unused["a.js"]["no-undef"].count;',
					"",
					"void count;",
				],
				"`unused` should be a nested record of counts",
			);
		});

		it("should reject a suppressions record whose entries are bare numbers", () => {
			/*
			 * The file format wraps every count in an object so that a future
			 * version can add fields to it; a bare number is the shape it is
			 * most likely to be confused with.
			 */
			assertRejects(
				[
					'const { SuppressionsService } = require("./suppressions-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const service = new SuppressionsService({",
					'	filePath: "s.json",',
					'	cwd: "/",',
					"});",
					"",
					"service.applySuppressions(declared(), {",
					'	"a.js": { "no-undef": 2 },',
					"});",
				],
				"a bare count should be rejected",
			);
		});

		it("should count violations into a record rather than a bare object", () => {
			assertRejects(
				[
					'const { SuppressionsService } = require("./suppressions-service.js");',
					...DECLARE_STAND_IN,
					"",
					"const totals = SuppressionsService.countViolationsByRule(",
					"	declared(),",
					");",
					"",
					'void totals["no-undef"].total;',
				],
				"an entry should only carry a `count`",
			);
		});
	});
});

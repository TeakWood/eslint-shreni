/**
 * @fileoverview Type-level tests for the `lib/linter/` annotations.
 *
 * `lib/linter/` is the engine every rule runs inside, so these tests assert
 * what its annotations accept and reject rather than that the tags are present.
 * Each one type-checks a probe module through the real `tsconfig.json`, so it
 * fails if a later change loosens a shape.
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
 * The probe sits inside `lib/linter/`, so it reaches the modules under test
 * through the same relative paths they use on each other. It never touches the
 * source tree: `typeCheckProbe()` serves it from memory.
 */
const PROBE_PATH = "lib/linter/__type-probe__.js";

/**
 * Type-checks a probe module as if it sat in `lib/linter/`.
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
 * Every probe needs values to call methods on, and building a real source code
 * object means building a whole AST. This stands in for one: it is only ever
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

describe("linter types", () => {
	describe("SourceCodeVisitor", () => {
		it("should reject a non-function registered under a name", () => {
			assertRejects(
				[
					'const { SourceCodeVisitor } = require("./source-code-visitor.js");',
					"",
					"const visitor = new SourceCodeVisitor();",
					"",
					'visitor.add("Identifier", "not a function");',
				],
				"a visitor function should have to be callable",
			);
		});

		it("should hand back a read-only list, so a caller cannot mutate the shared empty array", () => {
			/*
			 * `get()` returns one frozen array for every unregistered name, so
			 * typing it mutable would invite a caller to push into state the
			 * next lookup shares.
			 */
			assertRejects(
				[
					'const { SourceCodeVisitor } = require("./source-code-visitor.js");',
					"",
					"const visitor = new SourceCodeVisitor();",
					"",
					'visitor.get("Identifier").push(() => {});',
				],
				"the returned list should be read-only",
			);
		});

		it("should accept a listener taking any arguments, as a traversal step supplies", () => {
			assertAccepts(
				[
					'const { SourceCodeVisitor } = require("./source-code-visitor.js");',
					"",
					"const visitor = new SourceCodeVisitor();",
					"",
					'visitor.add("onCodePathStart", (codePath, node) => {',
					"	void codePath;",
					"	void node;",
					"});",
					'visitor.callSync("onCodePathStart", {}, {});',
				],
				"a listener should be able to take the step's own arguments",
			);
		});
	});

	describe("RuleFixer", () => {
		it("should satisfy the `RuleFixer` shape rules are written against", () => {
			/*
			 * `lib/shared/types.js` declares the fixer every `fix:` callback
			 * receives. This pins the class to it, so the hub and the
			 * implementation cannot drift apart.
			 */
			assertAccepts(
				[
					'const { RuleFixer } = require("./rule-fixer.js");',
					...DECLARE_STAND_IN,
					"",
					'/** @type {import("../shared/types.js").RuleFixer} */',
					"const fixer = new RuleFixer({ sourceCode: declared() });",
					"",
					"void fixer;",
				],
				"RuleFixer should satisfy the hub's `RuleFixer`",
			);
		});

		it("should infer an inline range literal as a pair", () => {
			assertAccepts(
				[
					'const { RuleFixer } = require("./rule-fixer.js");',
					...DECLARE_STAND_IN,
					"",
					"const fixer = new RuleFixer({ sourceCode: declared() });",
					"",
					'/** @type {import("../shared/types.js").EditInfo} */',
					'const edit = fixer.replaceTextRange([0, 3], "foo");',
					"",
					"void edit;",
					"",
					"/** @type {[number, number]} */",
					"const range = edit.range;",
					"",
					"void range;",
				],
				"a range should stay a pair rather than widening to number[]",
			);
		});

		it("should reject a range of the wrong length", () => {
			assertRejects(
				[
					'const { RuleFixer } = require("./rule-fixer.js");',
					...DECLARE_STAND_IN,
					"",
					"const fixer = new RuleFixer({ sourceCode: declared() });",
					"",
					'fixer.replaceTextRange([0], "foo");',
				],
				"a one-element range should be rejected",
			);
		});

		it("should reject a non-string replacement, which `assertIsString` throws on", () => {
			assertRejects(
				[
					'const { RuleFixer } = require("./rule-fixer.js");',
					...DECLARE_STAND_IN,
					"",
					"const fixer = new RuleFixer({ sourceCode: declared() });",
					"",
					"fixer.replaceTextRange([0, 3], 42);",
				],
				"a non-string replacement should be rejected",
			);
		});
	});

	describe("SourceCodeFixer", () => {
		it("should accept a predicate as `shouldFix`, as well as a boolean", () => {
			assertAccepts(
				[
					'const SourceCodeFixer = require("./source-code-fixer.js");',
					...DECLARE_STAND_IN,
					"",
					'/** @type {import("../shared/types.js").LintMessage[]} */',
					"const messages = declared();",
					"",
					'SourceCodeFixer.applyFixes("var x = 1", messages, true);',
					'SourceCodeFixer.applyFixes("var x = 1", messages, false);',
					"SourceCodeFixer.applyFixes(",
					'	"var x = 1",',
					"	messages,",
					"	message => message.ruleId !== null,",
					");",
				],
				"`shouldFix` should accept a boolean or a predicate",
			);
		});

		it("should report whether anything was fixed alongside the output", () => {
			assertAccepts(
				[
					'const SourceCodeFixer = require("./source-code-fixer.js");',
					...DECLARE_STAND_IN,
					"",
					'/** @type {import("../shared/types.js").LintMessage[]} */',
					"const messages = declared();",
					"",
					"const result = SourceCodeFixer.applyFixes(",
					'	"var x = 1",',
					"	messages,",
					"	true,",
					");",
					"",
					"/** @type {boolean} */",
					"const fixed = result.fixed;",
					"",
					"/** @type {string} */",
					"const output = result.output;",
					"",
					"void fixed;",
					"void output;",
				],
				"the fix report should carry `fixed` and `output`",
			);
		});
	});

	describe("VFile", () => {
		it("should satisfy the `File` shape a language's `parse()` receives", () => {
			/*
			 * `@eslint/core`'s `File` declares `body` as `string | Uint8Array`,
			 * because a language may be read as text or as bytes. Pinning
			 * `VFile` to it is what keeps a language plugin's `parse()` able to
			 * take the file the linter hands it.
			 */
			assertAccepts(
				[
					'const { VFile } = require("./vfile.js");',
					"",
					'/** @type {import("@eslint/core").File} */',
					'const file = new VFile("a.js", "var x = 1;", {',
					'	physicalPath: "/a.js",',
					"});",
					"",
					"void file;",
				],
				"VFile should satisfy `@eslint/core`'s `File`",
			);
		});

		it("should accept a byte body, for a language read as binary", () => {
			assertAccepts(
				[
					'const { VFile } = require("./vfile.js");',
					"",
					'const file = new VFile("a.bin", new Uint8Array([1, 2]));',
					"",
					"/** @type {string | Uint8Array} */",
					"const body = file.body;",
					"",
					"void body;",
				],
				"a byte body should be accepted",
			);
		});

		it("should require a `typeof` check before using the body as text", () => {
			/*
			 * The union is the point: a consumer that assumes text has to say
			 * so, rather than silently treating a byte body as a string.
			 */
			assertRejects(
				[
					'const { VFile } = require("./vfile.js");',
					"",
					'const file = new VFile("a.js", "var x = 1;");',
					"",
					"/** @type {string} */",
					"const body = file.body;",
					"",
					"void body;",
				],
				"reading the body as text without a check should be rejected",
			);
		});

		it("should reject a non-string path", () => {
			assertRejects(
				[
					'const { VFile } = require("./vfile.js");',
					"",
					'new VFile(42, "var x = 1;");',
					"",
				],
				"a non-string path should be rejected",
			);
		});
	});

	describe("FileContext", () => {
		it("should keep the extension's own members as well as the prototype's", () => {
			/*
			 * `extend()` is what builds a rule context, so the result has to
			 * carry both halves: the shared file members and the per-rule ones.
			 */
			assertAccepts(
				[
					'const { FileContext } = require("./file-context.js");',
					...DECLARE_STAND_IN,
					"",
					"const fileContext = new FileContext({",
					'	cwd: "/",',
					'	filename: "a.js",',
					'	physicalFilename: "/a.js",',
					"	sourceCode: declared(),",
					"	languageOptions: {},",
					"	settings: {},",
					"});",
					"",
					'const ruleContext = fileContext.extend({ id: "no-undef" });',
					"",
					"/** @type {string} */",
					"const id = ruleContext.id;",
					"",
					"/** @type {string} */",
					"const filename = ruleContext.filename;",
					"",
					"void id;",
					"void filename;",
				],
				"`extend()` should keep both halves of the context",
			);
		});

		it("should reject a context missing a required member", () => {
			assertRejects(
				[
					'const { FileContext } = require("./file-context.js");',
					...DECLARE_STAND_IN,
					"",
					"new FileContext({",
					'	cwd: "/",',
					'	filename: "a.js",',
					"	sourceCode: declared(),",
					"	languageOptions: {},",
					"	settings: {},",
					"});",
				],
				"a context without `physicalFilename` should be rejected",
			);
		});
	});

	describe("esquery", () => {
		it("should narrow a parsed selector's node types to a nullable list", () => {
			/*
			 * `null` means "could match any node type", which is what sends a
			 * selector to the any-type list in `source-code-traverser.js`. A
			 * non-nullable list would hide that branch.
			 */
			assertAccepts(
				[
					'const { parse } = require("./esquery.js");',
					"",
					'const selector = parse("Identifier:exit");',
					"",
					"/** @type {string[] | null} */",
					"const nodeTypes = selector.nodeTypes;",
					"",
					"/** @type {boolean} */",
					"const isExit = selector.isExit;",
					"",
					"void nodeTypes;",
					"void isExit;",
				],
				"`nodeTypes` should be nullable",
			);
		});

		it("should reject reading a parsed selector's node types as a plain list", () => {
			assertRejects(
				[
					'const { parse } = require("./esquery.js");',
					"",
					"/** @type {string[]} */",
					'const nodeTypes = parse("Identifier").nodeTypes;',
					"",
					"void nodeTypes;",
				],
				"`nodeTypes` should not be assignable to a non-nullable list",
			);
		});

		it("should accept a visitor-keys fallback returning a read-only list", () => {
			/*
			 * `eslint-visitor-keys` and `Traverser.getKeys()` both return
			 * `readonly string[]`, which `@types/esquery` does not allow. The
			 * annotation widens the option so the real fallbacks fit.
			 */
			assertAccepts(
				[
					'const { matches, parse } = require("./esquery.js");',
					'const vk = require("eslint-visitor-keys");',
					...DECLARE_STAND_IN,
					"",
					'matches(declared(), parse("Identifier").root, [], {',
					"	fallback: vk.getKeys,",
					"});",
				],
				"a read-only fallback should be accepted",
			);
		});
	});

	describe("apply-disable-directives", () => {
		it("should accept the directive shape `linter.js` builds", () => {
			assertAccepts(
				[
					'const applyDisableDirectives = require("./apply-disable-directives.js");',
					...DECLARE_STAND_IN,
					"",
					"applyDisableDirectives({",
					"	language: { columnStart: 0, lineStart: 1 },",
					"	sourceCode: declared(),",
					"	directives: [",
					"		{",
					"			parentDirective: {",
					"				node: declared(),",
					'				value: "no-undef",',
					'				ruleIds: ["no-undef"],',
					"			},",
					'			type: "disable-next-line",',
					"			line: 1,",
					"			column: 1,",
					'			ruleId: "no-undef",',
					'			justification: "because",',
					"		},",
					"	],",
					"	problems: [],",
					'	reportUnusedDisableDirectives: "warn",',
					"});",
				],
				"the directive shape the linter builds should be accepted",
			);
		});

		it("should allow a directive with no rule ID, which applies to every rule", () => {
			assertAccepts(
				[
					'const applyDisableDirectives = require("./apply-disable-directives.js");',
					...DECLARE_STAND_IN,
					"",
					"applyDisableDirectives({",
					"	language: {},",
					"	sourceCode: declared(),",
					"	directives: [",
					"		{",
					'			parentDirective: { node: declared(), value: "", ruleIds: [] },',
					'			type: "disable",',
					"			line: 1,",
					"			column: 1,",
					"			ruleId: null,",
					"		},",
					"	],",
					"	problems: [],",
					"});",
				],
				"a null rule ID should be accepted",
			);
		});

		it("should reject an unnormalized `reportUnusedDisableDirectives`", () => {
			/*
			 * `normalizeVerifyOptions()` resolves the config's severity to one
			 * of three strings before calling in, so a raw numeric severity
			 * reaching here would be a bug.
			 */
			assertRejects(
				[
					'const applyDisableDirectives = require("./apply-disable-directives.js");',
					...DECLARE_STAND_IN,
					"",
					"applyDisableDirectives({",
					"	language: {},",
					"	sourceCode: declared(),",
					"	directives: [],",
					"	problems: [],",
					"	reportUnusedDisableDirectives: 1,",
					"});",
				],
				"a numeric severity should be rejected",
			);
		});
	});

	describe("FileReport", () => {
		it("should report messages typed as `LintMessage`", () => {
			assertAccepts(
				[
					'const { FileReport } = require("./file-report.js");',
					...DECLARE_STAND_IN,
					"",
					"const report = new FileReport({",
					"	ruleMapper: declared(),",
					"	sourceCode: declared(),",
					"	language: { columnStart: 0, lineStart: 1 },",
					"});",
					"",
					'/** @type {import("../shared/types.js").LintMessage[]} */',
					"const messages = report.messages;",
					"",
					"void messages;",
				],
				"`messages` should be a list of `LintMessage`",
			);
		});

		it("should reject a severity of 0, which never reaches a reported message", () => {
			assertRejects(
				[
					'const { FileReport } = require("./file-report.js");',
					...DECLARE_STAND_IN,
					"",
					"const report = new FileReport({",
					"	ruleMapper: declared(),",
					"	sourceCode: declared(),",
					"	language: {},",
					"});",
					"",
					'report.addRuleMessage("no-undef", 0);',
				],
				"a severity of 0 should be rejected",
			);
		});

		it("should accept a problem descriptor with only a rule ID", () => {
			/*
			 * `addError({ ruleId })` is how the linter reports a configured
			 * rule that does not exist, so every other member has to be
			 * optional.
			 */
			assertAccepts(
				[
					'const { FileReport } = require("./file-report.js");',
					...DECLARE_STAND_IN,
					"",
					"const report = new FileReport({",
					"	ruleMapper: declared(),",
					"	sourceCode: declared(),",
					"	language: {},",
					"});",
					"",
					'report.addError({ ruleId: "no-such-rule" });',
				],
				"a descriptor with only a rule ID should be accepted",
			);
		});

		it("should export `updateLocationInformation` as returning a nullable end", () => {
			/*
			 * A problem reported at a bare position has no end, so the two
			 * `end*` members come back possibly absent.
			 */
			assertAccepts(
				[
					'const { updateLocationInformation } = require("./file-report.js");',
					"",
					"const loc = updateLocationInformation(",
					"	{ line: 1, column: 0 },",
					"	{ columnStart: 0, lineStart: 1 },",
					");",
					"",
					"/** @type {number} */",
					"const line = loc.line;",
					"",
					"/** @type {number | undefined} */",
					"const endLine = loc.endLine;",
					"",
					"void line;",
					"void endLine;",
				],
				"the updated location should have a nullable end",
			);
		});
	});

	describe("Linter", () => {
		it("should accept the flat config object `verify()` documents", () => {
			assertAccepts(
				[
					'const { Linter } = require("./linter.js");',
					"",
					'const linter = new Linter({ cwd: "/" });',
					"",
					'/** @type {import("../shared/types.js").LintMessage[]} */',
					"const messages = linter.verify(",
					'	"var x = 1;",',
					'	{ rules: { "no-undef": "error" } },',
					'	{ filename: "a.js" },',
					");",
					"",
					"void messages;",
				],
				"a flat config object should be accepted",
			);
		});

		it("should accept a filename in place of the options object", () => {
			assertAccepts(
				[
					'const { Linter } = require("./linter.js");',
					"",
					"const linter = new Linter();",
					"",
					'linter.verify("var x = 1;", { rules: {} }, "a.js");',
				],
				"a bare filename should be accepted",
			);
		});

		it("should reject an unknown verify option", () => {
			assertRejects(
				[
					'const { Linter } = require("./linter.js");',
					"",
					"const linter = new Linter();",
					"",
					'linter.verify("var x = 1;", { rules: {} }, { filenam: "a.js" });',
				],
				"a misspelled verify option should be rejected",
			);
		});

		it("should reject a non-flat `configType`", () => {
			/*
			 * The constructor throws on anything but `"flat"`, so this is a
			 * runtime check the type cannot express — but the option still has
			 * to be a string rather than, say, the removed `eslintrc` symbol.
			 */
			assertRejects(
				[
					'const { Linter } = require("./linter.js");',
					"",
					"new Linter({ configType: 5 });",
				],
				"a non-string configType should be rejected",
			);
		});

		it("should report fix results with the output text", () => {
			assertAccepts(
				[
					'const { Linter } = require("./linter.js");',
					"",
					"const linter = new Linter();",
					'const result = linter.verifyAndFix("var x = 1;", {',
					"	rules: {},",
					"});",
					"",
					"/** @type {string} */",
					"const output = result.output;",
					"",
					"/** @type {boolean} */",
					"const fixed = result.fixed;",
					"",
					"void output;",
					"void fixed;",
				],
				"`verifyAndFix()` should report the fixed output",
			);
		});

		it("should accept a predicate as the `fix` option, which is how `fixTypes` is applied", () => {
			/*
			 * `getFixerForFixTypes()` in `lib/eslint/eslint-helpers.js` turns
			 * the `fixTypes` option into a per-message predicate and hands it
			 * to `verifyAndFix()`, which passes it on to
			 * `SourceCodeFixer.applyFixes()` as its `shouldFix` argument.
			 */
			assertAccepts(
				[
					'const { Linter } = require("./linter.js");',
					"",
					"const linter = new Linter();",
					"",
					'linter.verifyAndFix("var x = 1;", { rules: {} }, {',
					'	filename: "a.js",',
					"	fix: message => message.ruleId !== null,",
					"});",
				],
				"a fix predicate should be accepted",
			);
		});
	});

	describe("SourceCodeTraverser", () => {
		it("should share one instance per language", () => {
			assertAccepts(
				[
					'const { SourceCodeTraverser } = require("./source-code-traverser.js");',
					'const { SourceCodeVisitor } = require("./source-code-visitor.js");',
					...DECLARE_STAND_IN,
					"",
					'const language = { nodeTypeKey: "type" };',
					"const traverser = SourceCodeTraverser.getInstance(language);",
					"",
					"traverser.traverseSync(declared(), new SourceCodeVisitor());",
				],
				"a traverser should be reachable for a language object",
			);
		});

		it("should reject a plain object in place of the visitor", () => {
			/*
			 * Traversal calls `forEachName()` and `callSync()` on the visitor,
			 * so a bare record of listeners is not enough.
			 */
			assertRejects(
				[
					'const { SourceCodeTraverser } = require("./source-code-traverser.js");',
					...DECLARE_STAND_IN,
					"",
					"const traverser = SourceCodeTraverser.getInstance({});",
					"",
					"traverser.traverseSync(declared(), {",
					"	Identifier() {},",
					"});",
				],
				"a plain visitor object should be rejected",
			);
		});
	});

	describe("interpolate", () => {
		it("should accept placeholder data of mixed value types", () => {
			assertAccepts(
				[
					'const { interpolate } = require("./interpolate.js");',
					"",
					"/** @type {string} */",
					'const message = interpolate("{{ a }} and {{ b }}", {',
					'	a: "one",',
					"	b: 2,",
					"});",
					"",
					"void message;",
				],
				"placeholder values should not have to be strings",
			);
		});

		it("should allow absent data, which returns the text unchanged", () => {
			assertAccepts(
				[
					'const { interpolate } = require("./interpolate.js");',
					"",
					'interpolate("no placeholders", void 0);',
				],
				"absent data should be accepted",
			);
		});
	});
});

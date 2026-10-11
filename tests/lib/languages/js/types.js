/**
 * @fileoverview Type-level tests for the `lib/languages/` annotations.
 *
 * `SourceCode` and the token store are what every rule is written against, so
 * these tests assert what the annotations accept and reject rather than that
 * the tags are present. Each one type-checks a probe module through the real
 * `tsconfig.json`, so it fails if a later change loosens a shape.
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
} = require("../../../_utils/type-probe");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/*
 * The probe sits inside `lib/languages/js/`, so it reaches the modules under
 * test through the same relative paths they use on each other. It never touches
 * the source tree: `typeCheckProbe()` serves it from memory.
 */
const PROBE_PATH = "lib/languages/js/__type-probe__.js";

/**
 * Type-checks a probe module as if it sat in `lib/languages/js/`.
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
 * Every probe needs values to call methods on, and building a real
 * `SourceCode` means building a whole AST. This stands in for one: it is only
 * ever type-checked, never run.
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

/*
 * The `SourceCode` and node stand-ins that most of the probes below share.
 */
const DECLARE_SOURCE_CODE = [
	'const SourceCode = require("./source-code/source-code.js");',
	'/** @typedef {import("./source-code/source-code.js").ASTNode} ASTNode */',
	...DECLARE_STAND_IN,
	"",
	"/** @type {SourceCode} */",
	"const sourceCode = declared();",
	"",
	"/** @type {ASTNode} */",
	"const node = declared();",
];

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("languages types", () => {
	describe("the JavaScript language object", () => {
		it("should satisfy the `Language` shape `default-config.js` registers it under", () => {
			assertAccepts(
				[
					'/** @type {import("../../shared/types.js").Language} */',
					'const language = require("./index.js");',
					"",
					"void language;",
				],
				"the js language object should be a `Language`",
			);
		});

		it("should allow a parse error with no location, which `FileError` forbids", () => {
			/*
			 * `@eslint/core`'s `FileError` requires `line` and `column`, but a
			 * custom parser can throw a plain `Error` carrying neither, so the
			 * language's own `ParseError` leaves both optional.
			 */
			assertAccepts(
				[
					'/** @type {import("./index.js").NotOkParseResult} */',
					"const result = {",
					"	ok: false,",
					'	errors: [{ message: "Unexpected token" }],',
					"};",
					"",
					"void result;",
				],
				"a parse error should not have to carry a location",
			);
		});

		it("should reject a language option the JS language does not accept", () => {
			assertRejects(
				[
					'/** @type {import("./index.js").JSLanguageOptions} */',
					'const languageOptions = { sourceType: "text" };',
					"",
					"void languageOptions;",
				],
				'`sourceType: "text"` is not a JavaScript source type',
			);
		});
	});

	describe("`SourceCode`", () => {
		it("should accept both constructor overloads", () => {
			assertAccepts(
				[
					'const SourceCode = require("./source-code/source-code.js");',
					'/** @typedef {import("./source-code/source-code.js").ProgramNode} ProgramNode */',
					...DECLARE_STAND_IN,
					"",
					"/** @type {ProgramNode} */",
					"const ast = declared();",
					"",
					'void new SourceCode("const a = 1;", ast);',
					'void new SourceCode({ text: "const a = 1;", ast });',
				],
				"the text and config forms should both be accepted",
			);
		});

		it("should require the config form to carry an AST", () => {
			assertRejects(
				[
					'const SourceCode = require("./source-code/source-code.js");',
					"",
					'void new SourceCode({ text: "const a = 1;" });',
				],
				"a config with no `ast` should be rejected",
			);
		});

		it("should type `scopeManager` as nullable, which the linter checks for", () => {
			assertRejects(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"void sourceCode.scopeManager.scopes;",
				],
				"reading through `scopeManager` without a guard should be rejected",
			);
		});

		it("should narrow `scopeManager` once it is checked", () => {
			assertAccepts(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"if (sourceCode.scopeManager) {",
					"	void sourceCode.scopeManager.scopes[0];",
					"}",
				],
				"a guarded read of `scopeManager` should be accepted",
			);
		});

		it("should type `getLocFromIndex()` as taking an index and returning a location", () => {
			assertAccepts(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"/** @type {number} */",
					"const line = sourceCode.getLocFromIndex(0).line;",
					"",
					"void line;",
				],
				"a numeric index should produce a `{ line, column }`",
			);
		});

		it("should reject a non-numeric index", () => {
			assertRejects(
				[
					...DECLARE_SOURCE_CODE,
					"",
					'void sourceCode.getLocFromIndex("0");',
				],
				"`getLocFromIndex()` should not accept a string",
			);
		});

		it("should type `traverse()` as returning traversal steps", () => {
			assertAccepts(
				[
					...DECLARE_SOURCE_CODE,
					"",
					'/** @type {import("@eslint/plugin-kit").TraversalStep[]} */',
					"const steps = sourceCode.traverse();",
					"",
					"void steps;",
				],
				"`traverse()` should return `TraversalStep[]`",
			);
		});

		it("should expose the ESLint-specific flags it sets on a scope variable", () => {
			/*
			 * `eslint-scope`'s own `Variable` declares none of these, so
			 * `getDeclaredVariables()` has to return the widened view or every
			 * rule that reads `eslintUsed` would be rejected.
			 */
			assertAccepts(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"for (const variable of sourceCode.getDeclaredVariables(node)) {",
					"	void variable.eslintUsed;",
					"}",
				],
				"`eslintUsed` should be readable off a declared variable",
			);
		});
	});

	describe("the token store", () => {
		it("should type a single-token lookup as nullable and a multi-token one as an array", () => {
			assertAccepts(
				[
					...DECLARE_SOURCE_CODE,
					'/** @typedef {import("./source-code/token-store/utils.js").Token} Token */',
					"",
					"/** @type {Token | null} */",
					"const one = sourceCode.getFirstToken(node);",
					"",
					"/** @type {Token[]} */",
					"const many = sourceCode.getFirstTokens(node);",
					"",
					"void one;",
					"void many;",
				],
				"the two lookup families should have different return types",
			);
		});

		it("should reject a single-token lookup used as a non-null token", () => {
			assertRejects(
				[
					...DECLARE_SOURCE_CODE,
					'/** @typedef {import("./source-code/token-store/utils.js").Token} Token */',
					"",
					"/** @type {Token} */",
					"const one = sourceCode.getFirstToken(node);",
					"",
					"void one;",
				],
				"`getFirstToken()` should be nullable",
			);
		});

		it("should accept all three option forms", () => {
			assertAccepts(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"void sourceCode.getFirstToken(node, 1);",
					"void sourceCode.getFirstToken(node, token =>",
					'	token.type === "Punctuator",',
					");",
					"void sourceCode.getFirstToken(node, { includeComments: true });",
				],
				"the skip, filter and object forms should all be accepted",
			);
		});

		it("should keep the skip and count option objects apart", () => {
			assertAccepts(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"void sourceCode.getFirstToken(node, { skip: 1 });",
					"void sourceCode.getFirstTokens(node, { count: 1 });",
				],
				"`skip` belongs to a single-token lookup and `count` to a multi-token one",
			);
		});

		it("should reject `count` on a single-token lookup", () => {
			assertRejects(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"void sourceCode.getFirstToken(node, { count: 1 });",
				],
				"`count` has no meaning for `getFirstToken()`",
			);
		});

		it("should reject a misspelled option key", () => {
			assertRejects(
				[
					...DECLARE_SOURCE_CODE,
					"",
					"void sourceCode.getFirstToken(node, { includeComment: true });",
				],
				"an unknown option key should be rejected",
			);
		});

		it("should type a cursor's `getAllTokens()` as holding no nulls", () => {
			/*
			 * `Cursor.current` is nullable, so collecting it without asserting
			 * the `moveNext()` invariant would widen the whole array.
			 */
			assertAccepts(
				[
					'const ForwardTokenCursor = require("./source-code/token-store/forward-token-cursor.js");',
					'/** @typedef {import("./source-code/token-store/utils.js").Token} Token */',
					...DECLARE_STAND_IN,
					"",
					"/** @type {ForwardTokenCursor} */",
					"const cursor = declared();",
					"",
					"/** @type {Token[]} */",
					"const tokens = cursor.getAllTokens();",
					"",
					"void tokens;",
				],
				"`getAllTokens()` should be `Token[]`",
			);
		});

		it("should require a decorative cursor to wrap a cursor", () => {
			assertRejects(
				[
					'const FilterCursor = require("./source-code/token-store/filter-cursor.js");',
					"",
					"void new FilterCursor({}, () => true);",
					"",
				],
				"a plain object is not a cursor",
			);
		});
	});

	describe("the `Traverser` visitors `SourceCode` passes", () => {
		it("should bind `this` to the traverser so a visitor can steer traversal", () => {
			/*
			 * `getNodeByRangeIndex()` calls `this.skip()` from inside `enter`.
			 * `Traverser` invokes the visitor as its own method, so the
			 * `NodeVisitor` typedef declares the `this` parameter; without it
			 * `this` would be the options object literal.
			 */
			assertAccepts(
				[
					'const Traverser = require("../../shared/traverser.js");',
					'/** @typedef {import("../../shared/traverser.js").TraversableNode} TraversableNode */',
					...DECLARE_STAND_IN,
					"",
					"/** @type {TraversableNode} */",
					"const root = declared();",
					"",
					"Traverser.traverse(root, {",
					"	enter() {",
					"		this.skip();",
					"	},",
					"	leave() {",
					"		this.break();",
					"	},",
					"});",
				],
				"a visitor method should see the traverser as `this`",
			);
		});

		it("should still accept an arrow function, which has no `this` of its own", () => {
			assertAccepts(
				[
					'const Traverser = require("../../shared/traverser.js");',
					'/** @typedef {import("../../shared/traverser.js").TraversableNode} TraversableNode */',
					...DECLARE_STAND_IN,
					"",
					"/** @type {TraversableNode} */",
					"const root = declared();",
					"",
					"Traverser.traverse(root, {",
					"	enter: visited => void visited.type,",
					"});",
				],
				"declaring `this` should not exclude arrow visitors",
			);
		});
	});
});

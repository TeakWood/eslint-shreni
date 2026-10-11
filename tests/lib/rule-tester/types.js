/**
 * @fileoverview Type-level tests for the `lib/rule-tester/` annotations.
 *
 * `RuleTester` is a first-class public API: plugin authors write their test
 * suites against these shapes, so what the annotations accept and reject is the
 * contract. Each test type-checks a probe module through the real
 * `tsconfig.json`, so it fails if a later change loosens or breaks a shape
 * rather than merely if a tag goes missing.
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
 * The probe sits inside `lib/rule-tester/`, so it reaches the modules under
 * test through the same relative paths they use on each other. It never
 * touches the source tree: `typeCheckProbe()` serves it from memory.
 */
const PROBE_PATH = "lib/rule-tester/__type-probe__.js";

/**
 * Type-checks a probe module as if it sat in `lib/rule-tester/`.
 *
 * Leading triple-slash lines are kept ahead of the directive prologue, because
 * a reference directive is only honored before the first statement.
 * @param {string[]} lines The probe's lines, joined with newlines.
 * @returns {readonly import("typescript").Diagnostic[]} The probe's diagnostics.
 */
function checkProbe(lines) {
	const firstStatement = lines.findIndex(line => !line.startsWith("///"));

	return typeCheckProbe(
		[
			...lines.slice(0, firstStatement),
			'"use strict";',
			...lines.slice(firstStatement),
		].join("\n"),
		PROBE_PATH,
	);
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
 * Every probe needs values it never evaluates. This stands in for one: the
 * probe is only ever type-checked, never run.
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

/** The lines that put a conforming rule and a tester in scope. */
const SETUP = [
	'const RuleTester = require("./rule-tester.js");',
	"",
	...DECLARE_STAND_IN,
	"",
	'/** @type {import("../shared/types.js").RuleModule} */',
	"const rule = {",
	'	meta: { type: "problem", messages: { bad: "Bad {{ thing }}." } },',
	"	create() {",
	"		return {};",
	"	},",
	"};",
	"",
	"const tester = new RuleTester();",
];

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("rule-tester types", () => {
	describe("`run()`", () => {
		it("should accept a scenario written the way the core rule tests are", () => {
			assertAccepts(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					'	valid: ["var a = 1;", { code: "var b = 2;", options: [1] }],',
					"	invalid: [",
					"		{",
					'			code: "var c = 3;",',
					'			output: "var c = 4;",',
					"			errors: [",
					"				{",
					'					messageId: "bad",',
					'					data: { thing: "code" },',
					"					line: 1,",
					"					column: 1,",
					"					suggestions: [",
					"						{",
					'							messageId: "bad",',
					'							data: { thing: "code" },',
					'							output: "var c = 5;",',
					"						},",
					"					],",
					"				},",
					"			],",
					"		},",
					"	],",
					"});",
				],
				"a conforming scenario should type-check",
			);
		});

		it("should accept a bare string as a valid case and a count as `errors`", () => {
			assertAccepts(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					'	valid: ["var a = 1;"],',
					'	invalid: [{ code: "var c = 3;", errors: 2 }],',
					"});",
				],
				"the two shorthand forms should type-check",
			);
		});

		it("should reject an invalid case with no `errors`", () => {
			assertRejects(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [],",
					'	invalid: [{ code: "var c = 3;" }],',
					"});",
				],
				"an invalid case must say how many errors it expects",
			);
		});

		it("should reject a misspelled test case property", () => {
			/*
			 * Every key that is not a tester parameter is passed through as a
			 * config object, and `ConfigObject` declares those, so a typo is a
			 * key nothing will ever read.
			 */
			assertRejects(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					'	valid: [{ code: "var a = 1;", filenames: "a.js" }],',
					"	invalid: [],",
					"});",
				],
				"`filenames` is not a test case property nor a config key",
			);
		});

		it("should accept a config key on a test case, which is how a case configures itself", () => {
			assertAccepts(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [",
					"		{",
					'			code: "var a = 1;",',
					"			languageOptions: { ecmaVersion: 2022 },",
					'			settings: { foo: "bar" },',
					"		},",
					"	],",
					"	invalid: [],",
					"});",
				],
				"a test case should still be able to carry config keys",
			);
		});

		it("should reject a rule with no `create()`", () => {
			assertRejects(
				[
					...SETUP,
					"",
					'tester.run("my-rule", { meta: {} }, { valid: [], invalid: [] });',
				],
				"a rule under test must be a rule",
			);
		});

		it("should reject a scenario missing `invalid`", () => {
			assertRejects(
				[...SETUP, "", 'tester.run("my-rule", rule, { valid: [] });'],
				"both scenario arrays are required",
			);
		});
	});

	describe("expected errors", () => {
		it("should accept a string or a RegExp in place of an error object", () => {
			assertAccepts(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [],",
					"	invalid: [",
					'		{ code: "a", errors: ["Bad code.", /Bad/u] },',
					"	],",
					"});",
				],
				"an expected error may be just its message",
			);
		});

		it("should reject a misspelled error property", () => {
			assertRejects(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [],",
					'	invalid: [{ code: "a", errors: [{ mesageId: "bad" }] }],',
					"});",
				],
				"`mesageId` is not an expected-error property",
			);
		});

		it("should require `output` on an expected suggestion", () => {
			assertRejects(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [],",
					"	invalid: [",
					"		{",
					'			code: "a",',
					'			errors: [{ messageId: "bad", suggestions: [{ desc: "x" }] }],',
					"		},",
					"	],",
					"});",
				],
				"a suggestion assertion is meaningless without its output",
			);
		});

		it("should accept a suggestion count in place of the list", () => {
			assertAccepts(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [],",
					"	invalid: [",
					'		{ code: "a", errors: [{ messageId: "bad", suggestions: 2 }] },',
					"	],",
					"});",
				],
				"`suggestions` may be a count",
			);
		});
	});

	describe("`assertionOptions`", () => {
		it("should accept the documented values", () => {
			assertAccepts(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [],",
					"	invalid: [],",
					"	assertionOptions: {",
					'		requireMessage: "messageId",',
					"		requireLocation: true,",
					'		requireData: "suggestion",',
					"	},",
					"});",
				],
				"the documented assertion options should type-check",
			);
		});

		it("should reject a value outside the documented set", () => {
			assertRejects(
				[
					...SETUP,
					"",
					'tester.run("my-rule", rule, {',
					"	valid: [],",
					"	invalid: [],",
					'	assertionOptions: { requireMessage: "msgId" },',
					"});",
				],
				'`requireMessage` takes `false`, `"message"` or `"messageId"`',
			);
		});
	});

	describe("test framework hooks", () => {
		it("should accept a framework function with the two documented parameters", () => {
			assertAccepts(
				[
					'const RuleTester = require("./rule-tester.js");',
					"",
					"RuleTester.describe = (text, method) => {",
					"	void text;",
					"	method();",
					"};",
					"RuleTester.it = (text, method) => {",
					"	void text;",
					"	method();",
					"};",
					"RuleTester.itOnly = RuleTester.it;",
					"",
					"module.exports = RuleTester.describe;",
				],
				"a custom test framework should be installable",
			);
		});

		it("should reject a non-function in place of a framework function", () => {
			assertRejects(
				[
					'const RuleTester = require("./rule-tester.js");',
					"",
					'RuleTester.describe = "nope";',
				],
				"a framework hook has to be callable",
			);
		});

		it("should hand back a callable from the getter, not the possibly-absent global", () => {
			/*
			 * The getter falls back to the default handler, so what it returns
			 * is never `undefined` even though the globals it probes are.
			 */
			assertAccepts(
				[
					'const RuleTester = require("./rule-tester.js");',
					"",
					'RuleTester.describe("suite", () => {});',
					'RuleTester.it("case", () => {});',
				],
				"the accessors should return something callable",
			);
		});
	});

	describe("`only()`", () => {
		it("should turn either form of test case into one carrying `only`", () => {
			assertAccepts(
				[
					'const RuleTester = require("./rule-tester.js");',
					"",
					'const fromString = RuleTester.only("var a = 1;");',
					'const fromObject = RuleTester.only({ code: "var b = 2;" });',
					"",
					"module.exports = {",
					"	a: fromString.only,",
					"	b: fromObject.code,",
					"};",
				],
				"`only()` should hand back a usable test case",
			);
		});
	});

	describe("the test framework globals", () => {
		/*
		 * A probe is compiled from its own root, so the `types/**` entry in
		 * `include` does not reach it; the reference pulls the ambient
		 * declarations in the way `include` does for the real sources.
		 */
		const REFERENCE_GLOBALS = [
			'/// <reference path="../../types/test-framework-globals.d.ts" />',
		];

		it("should declare them as possibly absent, which is what makes the `typeof` probes in the source load-bearing", () => {
			assertRejects(
				[...REFERENCE_GLOBALS, 'it("case", () => {});'],
				"`it` is not guaranteed to be there",
			);
		});

		it("should accept a call made behind the same guard the source uses", () => {
			assertAccepts(
				[
					...REFERENCE_GLOBALS,
					'if (typeof it === "function") {',
					'	it("case", () => {});',
					"}",
					'if (typeof describe === "function") {',
					'	describe("suite", () => {});',
					"}",
				],
				"the `typeof` guard should narrow away the absent case",
			);
		});

		it("should declare `only` on them, which is how `itOnly` finds the exclusive variant", () => {
			assertAccepts(
				[
					...REFERENCE_GLOBALS,
					'if (typeof it === "function" && typeof it.only === "function") {',
					'	it.only("case", () => {});',
					"}",
				],
				"`it.only` should be reachable behind the same guard the source uses",
			);
		});
	});

	describe("the default config accessors", () => {
		it("should accept a config object and reject a non-object", () => {
			assertAccepts(
				[
					'const RuleTester = require("./rule-tester.js");',
					"",
					'RuleTester.setDefaultConfig({ rules: { "no-undef": "error" } });',
					"RuleTester.resetDefaultConfig();",
					"",
					"module.exports = RuleTester.getDefaultConfig().rules;",
				],
				"the default config should round-trip as a config object",
			);
			assertRejects(
				[
					'const RuleTester = require("./rule-tester.js");',
					"",
					'RuleTester.setDefaultConfig("off");',
				],
				"a string is not a config object",
			);
		});
	});

	describe("the published type names", () => {
		it("should be reachable from the emitted declaration, so a plugin author can annotate against them", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					"",
					'/** @type {import("./rule-tester.js").ValidTestCase} */',
					'const valid = { code: "var a = 1;" };',
					"",
					'/** @type {import("./rule-tester.js").InvalidTestCase} */',
					'const invalid = { code: "var b = 2;", errors: 1 };',
					"",
					'/** @type {import("./rule-tester.js").TestScenarios} */',
					"const scenarios = { valid: [valid], invalid: [invalid] };",
					"",
					'/** @type {import("./rule-tester.js").AssertionOptions} */',
					"const assertionOptions = { requireLocation: true };",
					"",
					'/** @type {import("./rule-tester.js").SuggestionTestCase} */',
					'const suggestion = { messageId: "bad", output: "var b = 3;" };',
					"",
					"module.exports = {",
					"	scenarios,",
					"	assertionOptions,",
					"	suggestion,",
					"};",
				],
				"the test case types should be importable by name",
			);
		});
	});
});

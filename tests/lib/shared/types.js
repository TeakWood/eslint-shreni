/**
 * @fileoverview Tests for the shared type hub.
 *
 * `lib/shared/types.js` carries no runtime behavior, so these tests assert the
 * two things it is actually responsible for: that it stays free of runtime
 * surface, and that the type names the rest of the epic annotates against are
 * really declared and really describe the shapes they claim to.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert,
	path = require("node:path"),
	ts = require("typescript");

const {
	PROJECT_ROOT,
	formatDiagnostics,
	parseProjectConfig,
	typeCheckProbe,
} = require("../../_utils/type-probe");

const types = require("../../../lib/shared/types");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const TYPES_PATH = path.join(PROJECT_ROOT, "lib/shared/types.js");

/** The in-memory module the `@type` probes below are compiled as. */
const PROBE_PATH = "lib/shared/__type-probe__.js";

/**
 * The type names the design decision requires this module to publish.
 *
 * Every later annotation bead references these by name, so dropping or renaming
 * one breaks annotation work that is already merged.
 * @see `.shreni/design/2026-09-21-ts-declarations-from-jsdoc.md`
 */
const REQUIRED_TYPES = [
	"DeprecatedRuleInfo",
	"EditInfo",
	"LintMessage",
	"LintMessageType",
	"LintResult",
	"RuleContext",
	"RuleFixer",
	"RuleModule",
	"SuppressedLintMessage",
];

/**
 * Type-checks a probe module as if it sat beside the hub, so that it can reach
 * it through the same relative path the real sources use.
 * @param {string} code The snippet to type-check.
 * @returns {readonly import("typescript").Diagnostic[]} The snippet's diagnostics.
 */
function checkProbe(code) {
	return typeCheckProbe(code, PROBE_PATH);
}

/**
 * Wraps a snippet in the `@type` form that tsc actually checks: a named
 * binding, exported afterwards.
 * @param {string} typeName The hub type to constrain the value to.
 * @param {string} body The expression to annotate, without a trailing semicolon.
 * @returns {string} A complete probe module.
 */
function probeModule(typeName, body) {
	return [
		'"use strict";',
		`/** @type {import("./types.js").${typeName}} */`,
		`const value = ${body};`,
		"",
		"module.exports = value;",
	].join("\n");
}

/**
 * Wraps a rule body in the form the rule annotation beads will use.
 * @param {string} body The rule object literal, without a trailing semicolon.
 * @returns {string} A complete probe module.
 */
function ruleProbe(body) {
	return probeModule("RuleModule", body);
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("shared types", () => {
	describe("runtime surface", () => {
		it("should be requirable", () => {
			assert.isObject(types);
		});

		it("should export nothing at runtime", () => {
			assert.deepStrictEqual(
				Reflect.ownKeys(types),
				[],
				"the hub carries type declarations only",
			);
		});
	});

	describe("declared types", () => {
		it("should declare every type the annotation beads reference", () => {
			const { parsed } = parseProjectConfig();
			const program = ts.createProgram(parsed.fileNames, {
				...parsed.options,
				noEmit: true,
			});
			const checker = program.getTypeChecker();
			const sourceFile = program.getSourceFile(TYPES_PATH);

			assert.isDefined(
				sourceFile,
				"lib/shared/types.js should be part of the type-checked project",
			);

			const exportedTypeNames = new Set(
				checker
					.getExportsOfModule(checker.getSymbolAtLocation(sourceFile))
					.map(symbol => symbol.getName()),
			);
			const missing = REQUIRED_TYPES.filter(
				typeName => !exportedTypeNames.has(typeName),
			);

			assert.deepStrictEqual(
				missing,
				[],
				"the design decision requires these type names to be published",
			);
		});
	});

	describe("`RuleModule`", () => {
		it("should accept a rule written the way the core rules are", () => {
			const diagnostics = checkProbe(
				ruleProbe(`{
					meta: {
						type: "suggestion",
						docs: {
							description: "Enforce something",
							recommended: false,
							url: "https://eslint.org/docs/latest/rules/example",
						},
						fixable: "code",
						hasSuggestions: true,
						messages: { unexpected: "Unexpected thing." },
						schema: [],
						defaultOptions: [{ allow: [] }],
					},
					create(context) {
						return {
							Identifier(node) {
								context.report({
									node,
									messageId: "unexpected",
									fix: fixer => fixer.remove(node),
								});
							},
						};
					},
				}`),
			);

			assert.strictEqual(
				diagnostics.length,
				0,
				`a conforming rule should type-check:\n${formatDiagnostics(diagnostics)}`,
			);
		});

		it("should accept a rule with no `meta`", () => {
			const diagnostics = checkProbe(
				ruleProbe(`{
					create() {
						return {};
					},
				}`),
			);

			assert.strictEqual(
				diagnostics.length,
				0,
				`\`meta\` is optional:\n${formatDiagnostics(diagnostics)}`,
			);
		});

		it("should reject a rule with no `create()`", () => {
			const diagnostics = checkProbe(
				ruleProbe(`{
					meta: { type: "problem" },
				}`),
			);

			assert.isNotEmpty(
				diagnostics,
				"`create()` should be required, since ESLint cannot run a rule without it",
			);
		});

		it("should reject a rule type outside the documented three", () => {
			const diagnostics = checkProbe(
				ruleProbe(`{
					meta: { type: "stylistic" },
					create() {
						return {};
					},
				}`),
			);

			assert.isNotEmpty(
				diagnostics,
				"`meta.type` should be constrained to problem/suggestion/layout",
			);
		});

		it("should not be enforced by a tag on `module.exports` itself", () => {
			const diagnostics = checkProbe(
				[
					'"use strict";',
					'/** @type {import("./types.js").RuleModule} */',
					'module.exports = { meta: { type: "stylistic" } };',
				].join("\n"),
			);

			/*
			 * tsc reads a tag in this position as declaring the module's export
			 * type rather than as constraining the literal, so nothing is
			 * checked -- not the bogus `meta.type`, not the missing `create()`.
			 * This is why the annotation beads must type a named binding
			 * instead. Pinned so that a TypeScript upgrade which starts
			 * checking this form is noticed rather than silently relied on.
			 */
			assert.isEmpty(
				diagnostics,
				"if this now reports, `@type` on `module.exports` became reliable",
			);
		});
	});

	describe("`EditInfo`", () => {
		it("should require a two-element range", () => {
			const diagnostics = checkProbe(
				probeModule("EditInfo", '{ range: [0], text: "" }'),
			);

			assert.isNotEmpty(
				diagnostics,
				"a one-element range should not satisfy `[number, number]`",
			);
		});
	});

	describe("`SuppressedLintMessage`", () => {
		it("should extend `LintMessage` with suppressions", () => {
			const diagnostics = checkProbe(
				[
					probeModule(
						"SuppressedLintMessage",
						`{
							ruleId: "no-undef",
							severity: 2,
							message: "'x' is not defined.",
							line: 1,
							column: 1,
							suppressions: [
								{ kind: "directive", justification: "" },
							],
						}`,
					),
					"",
					// A suppressed message must still be usable as a plain one.
					'/** @type {import("./types.js").LintMessage} */',
					"const asMessage = value;",
					"",
					"module.exports = asMessage;",
				].join("\n"),
			);

			assert.strictEqual(
				diagnostics.length,
				0,
				`a suppressed message should still be a lint message:\n${formatDiagnostics(diagnostics)}`,
			);
		});
	});
});

/**
 * @fileoverview Tests for the shared type definition hub.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("node:assert");
const fs = require("node:fs");
const types = require("../../../lib/shared/types");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const TYPES_PATH = require.resolve("../../../lib/shared/types");

/*
 * The shapes this module exists to provide. Nothing in lib/ references them at
 * runtime, and no file under the current tsconfig `include` uses them yet, so
 * deleting one would not fail tsc — only this assertion catches it.
 */
const CORE_TYPE_NAMES = [
	"LintResult",
	"LintMessage",
	"LintMessageType",
	"SuppressedLintMessage",
	"RuleModule",
	"RuleContext",
	"RuleFixer",
	"EditInfo",
	"DeprecatedRuleInfo",
];

/**
 * Collects the names declared by `@typedef` tags in a file.
 * @param {string} filePath The file to read.
 * @returns {Set<string>} The declared type names.
 */
function declaredTypeNames(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const names = new Set();

	for (const match of source.matchAll(
		/^\s*\*\s*@typedef\s+\{.+\}\s+(?<name>\w+)\s*$/gmu,
	)) {
		names.add(match.groups.name);
	}

	return names;
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("shared types", () => {
	it("has no runtime surface", () => {
		assert.deepStrictEqual(types, {});
	});

	it("declares each core public shape", () => {
		const declared = declaredTypeNames(TYPES_PATH);

		for (const name of CORE_TYPE_NAMES) {
			assert.ok(
				declared.has(name),
				`lib/shared/types.js must declare a '${name}' typedef`,
			);
		}
	});
});

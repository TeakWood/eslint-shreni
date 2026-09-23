/**
 * @fileoverview Expose out ESLint and CLI to require.
 * @author Ian Christian Myers
 */

// @ts-check

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const { ESLint } = require("./eslint/eslint");
const { Linter } = require("./linter");
const { RuleTester } = require("./rule-tester");
const { SourceCode } = require("./languages/js/source-code");

//-----------------------------------------------------------------------------
// Functions
//-----------------------------------------------------------------------------

/**
 * Loads the correct `ESLint` constructor.
 * @returns {Promise<typeof ESLint>} The ESLint constructor.
 */
async function loadESLint() {
	return ESLint;
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

module.exports = {
	Linter,
	loadESLint,
	ESLint,
	RuleTester,
	SourceCode,
};

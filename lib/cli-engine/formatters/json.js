/**
 * @fileoverview JSON reporter
 * @author Burak Yigit Kaya aka BYK
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../../shared/types.js").LintResult} LintResult */

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Formats the results as JSON.
 * @param {Array<LintResult>} results The lint results to format.
 * @returns {string} The results serialized as JSON.
 */
module.exports = function (results) {
	return JSON.stringify(results);
};

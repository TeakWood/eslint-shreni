/**
 * @fileoverview JSON reporter, including rules metadata
 * @author Chris Meyer
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../../shared/types.js").FormatterData} FormatterData */
/** @typedef {import("../../shared/types.js").LintResult} LintResult */

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Formats the results as JSON, with the run's metadata alongside them.
 * @param {Array<LintResult>} results The lint results to format.
 * @param {FormatterData} [data] The metadata for the run.
 * @returns {string} The results and metadata serialized as JSON.
 */
module.exports = function (results, data) {
	return JSON.stringify({
		results,
		metadata: data,
	});
};

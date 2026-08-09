// @ts-check
/**
 * @fileoverview JSON reporter
 * @author Burak Yigit Kaya aka BYK
 */
"use strict";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @import { Formatter } from "../../types/core.js" */

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Formatters have no inbound `require` edge — they are loaded by name at
 * runtime (`lib/eslint/eslint.js:1262-1292`), so nothing in the codebase would
 * otherwise state their contract. Naming `Formatter` here is what makes the
 * contract checkable: the annotation is the only thing that connects this
 * module to the shape the loader calls.
 *
 * A formatter may take fewer parameters than the contract passes, which is why
 * this one declares only `results`.
 * @type {Formatter}
 */
module.exports = function (results) {
	return JSON.stringify(results);
};

// @ts-check
/**
 * @fileoverview JSON reporter, including rules metadata
 * @author Chris Meyer
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
 * Emits the results together with the whole formatter context, so `metadata`
 * is `FormatterContext` rather than just the rules metadata the name suggests.
 * @type {Formatter}
 */
module.exports = function (results, data) {
	return JSON.stringify({
		results,
		metadata: data,
	});
};

// @ts-check
/**
 * @fileoverview Main package entrypoint.
 * @author Nicholas C. Zakas
 */

"use strict";

const { name, version } = require("../package.json");

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

module.exports = {
	/*
	 * Cast rather than shorthand: with shorthand, declaration emit re-exports
	 * the `../package.json` import binding, and that specifier does not
	 * resolve from the emitted `.d.ts`. Casting forces the declaration to
	 * state `string` instead.
	 */
	meta: {
		name: /** @type {string} */ (name),
		version: /** @type {string} */ (version),
	},
	configs: {
		all: require("./configs/eslint-all"),
		recommended: require("./configs/eslint-recommended"),
	},
};

// @ts-check
/**
 * @fileoverview Handle logging for ESLint
 * @author Gyandeep Singh
 */

"use strict";

/* eslint no-console: "off" -- Logging util */

/* c8 ignore next */
module.exports = {
	/**
	 * Cover for console.info
	 * @param {...any} args The elements to log.
	 */
	info(...args) {
		console.log(...args);
	},

	/**
	 * Cover for console.warn
	 * @param {...any} args The elements to log.
	 */
	warn(...args) {
		console.warn(...args);
	},

	/**
	 * Cover for console.error
	 * @param {...any} args The elements to log.
	 */
	error(...args) {
		console.error(...args);
	},
};

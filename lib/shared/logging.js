/**
 * @fileoverview Handle logging for ESLint
 * @author Gyandeep Singh
 */

// @ts-check

"use strict";

/* eslint no-console: "off" -- Logging util */

/* c8 ignore next */
module.exports = {
	/**
	 * Cover for console.info
	 * @param {...unknown} args The elements to log.
	 * @returns {void}
	 */
	info(...args) {
		console.log(...args);
	},

	/**
	 * Cover for console.warn
	 * @param {...unknown} args The elements to log.
	 * @returns {void}
	 */
	warn(...args) {
		console.warn(...args);
	},

	/**
	 * Cover for console.error
	 * @param {...unknown} args The elements to log.
	 * @returns {void}
	 */
	error(...args) {
		console.error(...args);
	},
};

/**
 * @fileoverview A class of identifiers generator for code path segments.
 *
 * Each rule uses the identifier of code path segments to store additional
 * information of the code path.
 *
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * A generator for unique ids.
 */
class IdGenerator {
	/**
	 * @param {string} [prefix] Optional. A prefix of generated ids.
	 */
	constructor(prefix) {
		/**
		 * The prefix prepended to every generated id.
		 * @type {string}
		 */
		this.prefix = String(prefix);

		/**
		 * The counter appended to the prefix.
		 * @type {number}
		 */
		this.n = 0;
	}

	/**
	 * Generates id.
	 * @returns {string} A generated id.
	 */
	next() {
		this.n = (1 + this.n) | 0;

		if (this.n < 0) {
			this.n = 1;
		}

		return this.prefix + this.n;
	}
}

module.exports = IdGenerator;

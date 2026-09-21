/**
 * @fileoverview SourceCodeVisitor class
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//-----------------------------------------------------------------------------
// Type Definitions
//-----------------------------------------------------------------------------

/**
 * A visitor callback. Rules register these under AST selector names and the
 * traverser calls them with whatever that selector matched, so the parameter
 * list is deliberately open.
 * @typedef {(...args: Array<any>) => void} VisitorFunction
 */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/** @type {ReadonlyArray<VisitorFunction>} */
const emptyArray = Object.freeze([]);

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * A structure to hold a list of functions to call for a given name.
 * This is used to allow multiple rules to register functions for a given name
 * without having to know about each other.
 */
class SourceCodeVisitor {
	/**
	 * The functions to call for a given name.
	 * @type {Map<string, Array<VisitorFunction>>}
	 */
	#functions = new Map();

	/**
	 * Adds a function to the list of functions to call for a given name.
	 * @param {string} name The name of the function to call.
	 * @param {VisitorFunction} func The function to call.
	 * @returns {void}
	 */
	add(name, func) {
		if (this.#functions.has(name)) {
			// Sound: guarded by the `has()` check on the line above.
			/** @type {Array<VisitorFunction>} */ (
				this.#functions.get(name)
			).push(func);
		} else {
			this.#functions.set(name, [func]);
		}
	}

	/**
	 * Gets the list of functions to call for a given name.
	 * @param {string} name The name of the function to call.
	 * @returns {ReadonlyArray<VisitorFunction>} The list of functions to call.
	 */
	get(name) {
		if (this.#functions.has(name)) {
			// Sound: guarded by the `has()` check on the line above.
			return /** @type {Array<VisitorFunction>} */ (
				this.#functions.get(name)
			);
		}

		return emptyArray;
	}

	/**
	 * Iterates over all names and calls the callback with the name.
	 * @param {(name: string) => void} callback The callback to call for each name.
	 * @returns {void}
	 */
	forEachName(callback) {
		this.#functions.forEach((funcs, name) => {
			callback(name);
		});
	}

	/**
	 * Calls the functions for a given name with the given arguments.
	 * @param {string} name The name of the function to call.
	 * @param {...any} args The arguments to pass to the function.
	 * @returns {void}
	 */
	callSync(name, ...args) {
		if (this.#functions.has(name)) {
			// Sound: guarded by the `has()` check on the line above.
			/** @type {Array<VisitorFunction>} */ (
				this.#functions.get(name)
			).forEach(func => func(...args));
		}
	}
}

module.exports = { SourceCodeVisitor };

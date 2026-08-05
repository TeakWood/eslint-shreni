/**
 * @fileoverview Assertion utilities equivalent to the Node.js node:asserts module.
 * @author Josh Goldberg
 */

"use strict";

/**
 * Throws an error if the input is not truthy.
 * @param value The input that is checked for being truthy.
 * @param message Message to throw if the input is not truthy.
 * @throws When the condition is not truthy.
 */
function ok(value, message = "Assertion failed.") {
	if (!value) {
		throw new Error(message);
	}
}

module.exports = ok;

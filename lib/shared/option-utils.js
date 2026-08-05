/**
 * @fileoverview Utilities to operate on option objects.
 * @author Josh Goldberg
 */

"use strict";

/**
 * Determines whether any of input's properties are different
 * from values that already exist in original.
 * @param input New value.
 * @param original Original value.
 * @returns Whether input includes an explicit difference.
 */
function containsDifferentProperty(input, original) {
	if (input === original) {
		return false;
	}

	if (
		typeof input !== typeof original ||
		Array.isArray(input) !== Array.isArray(original)
	) {
		return true;
	}

	if (Array.isArray(input)) {
		return (
			input.length !== original.length ||
			input.some((value, i) =>
				containsDifferentProperty(value, original[i]),
			)
		);
	}

	if (typeof input === "object") {
		if (input === null || original === null) {
			return true;
		}

		const inputKeys = Object.keys(input);
		const originalKeys = Object.keys(original);

		return (
			inputKeys.length !== originalKeys.length ||
			inputKeys.some(
				inputKey =>
					!Object.hasOwn(original, inputKey) ||
					containsDifferentProperty(
						input[inputKey],
						original[inputKey],
					),
			)
		);
	}

	return true;
}

module.exports = {
	containsDifferentProperty,
};

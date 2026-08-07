// @ts-check
/**
 * @fileoverview Utilities to operate on option objects.
 * @author Josh Goldberg
 */

"use strict";

/**
 * Determines whether any of input's properties are different
 * from values that already exist in original.
 *
 * ESCAPE HATCH: `any` rather than `unknown`. Reason: this walks two arbitrary
 * rule-option values in lockstep, indexing whichever one it has just proven
 * (via `typeof`/`Array.isArray` on the *other* operand) to have the same
 * shape. TypeScript cannot carry a narrowing from one parameter to another, so
 * `unknown` would force either a rewrite of the traversal or a cast at every
 * index. Rule options are user-supplied JSON with no static shape, so there is
 * no more precise type available to assert here.
 * @param {any} input New value.
 * @param {any} original Original value.
 * @returns {boolean} Whether input includes an explicit difference.
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

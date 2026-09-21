/**
 * @fileoverview Utilities to operate on option objects.
 * @author Josh Goldberg
 */

// @ts-check

"use strict";

/**
 * Determines whether any of input's properties are different
 * from values that already exist in original.
 * @param {unknown} input New value.
 * @param {unknown} original Original value.
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

	/*
	 * The guard above established that `input` and `original` have the same
	 * `typeof` and the same array-ness, so the casts below are sound; they only
	 * exist because narrowing `input` tells tsc nothing about `original`.
	 */
	if (Array.isArray(input)) {
		const originalArray = /** @type {Array<unknown>} */ (original);

		return (
			input.length !== originalArray.length ||
			input.some((value, i) =>
				containsDifferentProperty(value, originalArray[i]),
			)
		);
	}

	if (typeof input === "object") {
		if (input === null || original === null) {
			return true;
		}

		const inputObject = /** @type {Record<string, unknown>} */ (input);
		const originalObject = /** @type {Record<string, unknown>} */ (
			original
		);
		const inputKeys = Object.keys(inputObject);
		const originalKeys = Object.keys(originalObject);

		return (
			inputKeys.length !== originalKeys.length ||
			inputKeys.some(
				inputKey =>
					!Object.hasOwn(originalObject, inputKey) ||
					containsDifferentProperty(
						inputObject[inputKey],
						originalObject[inputKey],
					),
			)
		);
	}

	return true;
}

module.exports = {
	containsDifferentProperty,
};

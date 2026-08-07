// @ts-check
/**
 * @fileoverview Serialization utils.
 * @author Bryan Mishkin
 */

"use strict";

/**
 * A value that `JSON.stringify()` can round-trip: a JSON primitive, an array,
 * or a plain object.
 *
 * Two things this deliberately does not say. First, the claim is shallow — a
 * plain object whose *properties* are not serializable still matches, which is
 * exactly why `isSerializable()` has to recurse. Second, arrays are covered by
 * the `Record<string, unknown>` member rather than a separate `unknown[]`
 * member: `isSerializable()` walks arrays and objects through the same
 * `for...in` loop, and a union that distinguished them would make that shared
 * string index illegal on the array half.
 * @typedef {null | string | boolean | number | Record<string, unknown>} SerializableValue
 */

/**
 * Check if a value is a primitive or plain object created by the Object constructor.
 * @param {unknown} val the value to check
 * @returns {val is SerializableValue} `true` if so
 * @private
 */
function isSerializablePrimitiveOrPlainObject(val) {
	return (
		val === null ||
		typeof val === "string" ||
		typeof val === "boolean" ||
		typeof val === "number" ||
		(typeof val === "object" && val.constructor === Object) ||
		Array.isArray(val)
	);
}

/**
 * Check if a value is serializable.
 * Functions or objects like RegExp cannot be serialized by JSON.stringify().
 * Inspired by: https://stackoverflow.com/questions/30579940/reliable-way-to-check-if-objects-is-serializable-in-javascript
 * @param {unknown} val The value
 * @param {Set<object>} [seenObjects] Objects already seen in this path from the root object.
 * @returns {boolean} `true` if the value is serializable
 */
function isSerializable(val, seenObjects = new Set()) {
	if (!isSerializablePrimitiveOrPlainObject(val)) {
		return false;
	}
	if (typeof val === "object" && val !== null) {
		if (seenObjects.has(val)) {
			/*
			 * Since this is a depth-first traversal, encountering
			 * the same object again means there is a circular reference.
			 * Objects with circular references are not serializable.
			 */
			return false;
		}
		for (const property in val) {
			if (Object.hasOwn(val, property)) {
				if (!isSerializablePrimitiveOrPlainObject(val[property])) {
					return false;
				}
				if (
					typeof val[property] === "object" &&
					val[property] !== null
				) {
					if (
						/*
						 * We're creating a new Set of seen objects because we want to
						 * ensure that `val` doesn't appear again in this path, but it can appear
						 * in other paths. This allows for reusing objects in the graph, as long as
						 * there are no cycles.
						 */
						!isSerializable(
							val[property],
							new Set([...seenObjects, val]),
						)
					) {
						return false;
					}
				}
			}
		}
	}
	return true;
}

module.exports = {
	isSerializable,
};

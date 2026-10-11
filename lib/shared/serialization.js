/**
 * @fileoverview Serialization utils.
 * @author Bryan Mishkin
 */

"use strict";

/**
 * Check if a value is a primitive or plain object created by the Object constructor.
 * @param {unknown} val the value to check
 * @returns {boolean} `true` if so
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
 * @param {Set<unknown>} [seenObjects] Objects already seen in this path from the root object.
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
		/*
		 * `val` has been narrowed to `object`, which cannot be indexed by an
		 * arbitrary key. The values behind those keys are genuinely unknown,
		 * which is exactly what the recursive check below establishes.
		 */
		const obj = /** @type {Record<string, unknown>} */ (val);

		for (const property in obj) {
			if (Object.hasOwn(obj, property)) {
				if (!isSerializablePrimitiveOrPlainObject(obj[property])) {
					return false;
				}
				if (
					typeof obj[property] === "object" &&
					obj[property] !== null
				) {
					if (
						/*
						 * We're creating a new Set of seen objects because we want to
						 * ensure that `val` doesn't appear again in this path, but it can appear
						 * in other paths. This allows for reusing objects in the graph, as long as
						 * there are no cycles.
						 */
						!isSerializable(
							obj[property],
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

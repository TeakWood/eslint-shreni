/**
 * @fileoverview The schema to validate language options
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//-----------------------------------------------------------------------------
// Data
//-----------------------------------------------------------------------------

/*
 * The set is tested against arbitrary configured values, so the element type
 * is widened at the literal: inferring it from the members would narrow
 * `has()` to the very values that are already known to be valid.
 */
const globalVariablesValues = new Set(
	/** @type {Array<unknown>} */ ([
		true,
		"true",
		"writable",
		"writeable",
		false,
		"false",
		"readonly",
		"readable",
		null,
		"off",
	]),
);

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Check if a value is a non-null object.
 * @param {unknown} value The value to check.
 * @returns {value is object} `true` if the value is a non-null object.
 */
function isNonNullObject(value) {
	return typeof value === "object" && value !== null;
}

/**
 * Check if a value is a non-null non-array object.
 * @param {unknown} value The value to check.
 * @returns {value is Record<string, unknown>} `true` if the value is a non-null non-array object.
 */
function isNonArrayObject(value) {
	return isNonNullObject(value) && !Array.isArray(value);
}

/**
 * Check if a value is undefined.
 * @param {unknown} value The value to check.
 * @returns {value is undefined} `true` if the value is undefined.
 */
function isUndefined(value) {
	return typeof value === "undefined";
}

//-----------------------------------------------------------------------------
// Schemas
//-----------------------------------------------------------------------------

/**
 * Validates the ecmaVersion property.
 * @param {unknown} ecmaVersion The value to check.
 * @throws {TypeError} If the value is invalid.
 * @returns {void}
 */
function validateEcmaVersion(ecmaVersion) {
	if (isUndefined(ecmaVersion)) {
		throw new TypeError(
			'Key "ecmaVersion": Expected an "ecmaVersion" property.',
		);
	}

	if (typeof ecmaVersion !== "number" && ecmaVersion !== "latest") {
		throw new TypeError(
			'Key "ecmaVersion": Expected a number or "latest".',
		);
	}
}

/**
 * Validates the sourceType property.
 * @param {unknown} sourceType The value to check.
 * @throws {TypeError} If the value is invalid.
 * @returns {void}
 */
function validateSourceType(sourceType) {
	if (
		typeof sourceType !== "string" ||
		!/^(?:script|module|commonjs)$/u.test(sourceType)
	) {
		throw new TypeError(
			'Key "sourceType": Expected "script", "module", or "commonjs".',
		);
	}
}

/**
 * Validates the globals property.
 * @param {unknown} globals The value to check.
 * @throws {TypeError} If the value is invalid.
 * @returns {void}
 */
function validateGlobals(globals) {
	if (!isNonArrayObject(globals)) {
		throw new TypeError('Key "globals": Expected an object.');
	}

	for (const key of Object.keys(globals)) {
		// avoid hairy edge case
		if (key === "__proto__") {
			continue;
		}

		if (key !== key.trim()) {
			throw new TypeError(
				`Key "globals": Global "${key}" has leading or trailing whitespace.`,
			);
		}

		if (!globalVariablesValues.has(globals[key])) {
			throw new TypeError(
				`Key "globals": Key "${key}": Expected "readonly", "writable", or "off".`,
			);
		}
	}
}

/**
 * Validates the parser property.
 * @param {unknown} parser The value to check.
 * @throws {TypeError} If the value is invalid.
 * @returns {void}
 */
function validateParser(parser) {
	if (
		!parser ||
		typeof parser !== "object" ||
		(typeof (/** @type {Record<string, unknown>} */ (parser).parse) !==
			"function" &&
			typeof (
				/** @type {Record<string, unknown>} */ (parser).parseForESLint
			) !== "function")
	) {
		throw new TypeError(
			'Key "parser": Expected object with parse() or parseForESLint() method.',
		);
	}
}

/**
 * Validates the language options.
 * @param {unknown} languageOptions The language options to validate.
 * @throws {TypeError} If the language options are invalid.
 * @returns {void}
 */
function validateLanguageOptions(languageOptions) {
	if (!isNonArrayObject(languageOptions)) {
		throw new TypeError("Expected an object.");
	}

	const {
		ecmaVersion,
		sourceType,
		globals,
		parser,
		parserOptions,
		...otherOptions
	} = languageOptions;

	if ("ecmaVersion" in languageOptions) {
		validateEcmaVersion(ecmaVersion);
	}

	if ("sourceType" in languageOptions) {
		validateSourceType(sourceType);
	}

	if ("globals" in languageOptions) {
		validateGlobals(globals);
	}

	if ("parser" in languageOptions) {
		validateParser(parser);
	}

	if ("parserOptions" in languageOptions) {
		if (!isNonArrayObject(parserOptions)) {
			throw new TypeError('Key "parserOptions": Expected an object.');
		}
	}

	const otherOptionKeys = Object.keys(otherOptions);

	if (otherOptionKeys.length > 0) {
		throw new TypeError(`Unexpected key "${otherOptionKeys[0]}" found.`);
	}
}

module.exports = { validateLanguageOptions };

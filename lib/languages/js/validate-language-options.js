// @ts-check
/**
 * @fileoverview The schema to validate language options
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Data
//-----------------------------------------------------------------------------

/*
 * Typed as `Set<unknown>` because `validateGlobals()` tests values that came
 * straight from a user config against it; a narrower element type would force
 * a cast at the only call site.
 */
/** @type {Set<unknown>} */
const globalVariablesValues = new Set([
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
]);

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Check if a value is a non-null object.
 * @param {unknown} value The value to check.
 * @returns {value is Record<string, unknown>} `true` if the value is a non-null object.
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
 * @returns {boolean} `true` if the value is undefined.
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
 * @returns {void}
 * @throws If the value is invalid.
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
 * @returns {void}
 * @throws If the value is invalid.
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
 * @returns {void}
 * @throws If the value is invalid.
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
 * @returns {void}
 * @throws If the value is invalid.
 */
function validateParser(parser) {
	/*
	 * The value comes straight from a user config, so it arrives as `unknown`.
	 * This view names just the two methods the check looks for; narrowing by
	 * `typeof parser !== "object"` alone leaves `object`, which has neither.
	 */
	const candidate =
		/** @type {{ parse?: unknown, parseForESLint?: unknown }} */ (parser);

	if (
		!parser ||
		typeof parser !== "object" ||
		(typeof candidate.parse !== "function" &&
			typeof candidate.parseForESLint !== "function")
	) {
		throw new TypeError(
			'Key "parser": Expected object with parse() or parseForESLint() method.',
		);
	}
}

/**
 * Validates the language options.
 * @param {unknown} languageOptions The language options to validate.
 * @returns {void}
 * @throws If the language options are invalid.
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

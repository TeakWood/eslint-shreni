/**
 * @fileoverview Flat config schema
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const { normalizeSeverityToNumber } = require("../shared/severity");

//-----------------------------------------------------------------------------
// Type Definitions
//-----------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").Severity} Severity */
/** @typedef {import("@eslint/config-array").ObjectDefinition} ObjectDefinition */
/** @typedef {import("@eslint/config-array").PropertyDefinition} PropertyDefinition */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const ruleSeverities = new Map(
	/** @type {Array<[string | number, Severity]>} */ ([
		[0, 0],
		["off", 0],
		[1, 1],
		["warn", 1],
		[2, 2],
		["error", 2],
	]),
);

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
 * @returns {value is undefined} `true` if the value is undefined.
 */
function isUndefined(value) {
	return typeof value === "undefined";
}

/**
 * Deeply merges two non-array objects.
 * @param {Record<string, unknown>} first The base object.
 * @param {Record<string, unknown>} second The overrides object.
 * @param {Map<Record<string, unknown>, Map<Record<string, unknown>, Record<string, unknown>>>} [mergeMap] Maps the combination of first and second arguments to a merged result.
 * @returns {Record<string, unknown>} An object with properties from both first and second.
 */
function deepMerge(first, second, mergeMap = new Map()) {
	let secondMergeMap = mergeMap.get(first);

	if (secondMergeMap) {
		const result = secondMergeMap.get(second);

		if (result) {
			// If this combination of first and second arguments has been already visited, return the previously created result.
			return result;
		}
	} else {
		secondMergeMap = new Map();
		mergeMap.set(first, secondMergeMap);
	}

	/*
	 * First create a result object where properties from the second object
	 * overwrite properties from the first. This sets up a baseline to use
	 * later rather than needing to inspect and change every property
	 * individually.
	 */
	const result = {
		...first,
		...second,
	};

	delete result.__proto__; // eslint-disable-line no-proto -- don't merge own property "__proto__"

	// Store the pending result for this combination of first and second arguments.
	secondMergeMap.set(second, result);

	for (const key of Object.keys(second)) {
		// avoid hairy edge case
		if (
			key === "__proto__" ||
			!Object.prototype.propertyIsEnumerable.call(first, key)
		) {
			continue;
		}

		const firstValue = first[key];
		const secondValue = second[key];

		if (isNonArrayObject(firstValue) && isNonArrayObject(secondValue)) {
			result[key] = deepMerge(firstValue, secondValue, mergeMap);
		} else if (isUndefined(secondValue)) {
			result[key] = firstValue;
		}
	}

	return result;
}

/**
 * Normalizes the rule options config for a given rule by ensuring that
 * it is an array and that the first item is 0, 1, or 2.
 * @param {unknown} ruleOptions The rule options config.
 * @returns {Array<unknown>} An array of rule options.
 */
function normalizeRuleOptions(ruleOptions) {
	const finalOptions = Array.isArray(ruleOptions)
		? ruleOptions.slice(0)
		: [ruleOptions];

	finalOptions[0] = ruleSeverities.get(
		/** @type {string | number} */ (finalOptions[0]),
	);
	return structuredClone(finalOptions);
}

/**
 * Determines if an object has any methods.
 * @param {Record<string, unknown>} object The object to check.
 * @returns {boolean} `true` if the object has any methods.
 */
function hasMethod(object) {
	for (const key of Object.keys(object)) {
		if (typeof object[key] === "function") {
			return true;
		}
	}

	return false;
}

//-----------------------------------------------------------------------------
// Assertions
//-----------------------------------------------------------------------------

/**
 * The error type when a rule's options are configured with an invalid type.
 */
class InvalidRuleOptionsError extends Error {
	/**
	 * @param {string} ruleId Rule name being configured.
	 * @param {unknown} value The invalid value.
	 */
	constructor(ruleId, value) {
		super(
			`Key "${ruleId}": Expected severity of "off", 0, "warn", 1, "error", or 2.`,
		);
		this.messageTemplate = "invalid-rule-options";
		this.messageData = { ruleId, value };
	}
}

/**
 * Validates that a value is a valid rule options entry.
 * @param {string} ruleId Rule name being configured.
 * @param {unknown} value The value to check.
 * @throws {InvalidRuleOptionsError} If the value isn't a valid rule options.
 */
function assertIsRuleOptions(ruleId, value) {
	if (
		typeof value !== "string" &&
		typeof value !== "number" &&
		!Array.isArray(value)
	) {
		throw new InvalidRuleOptionsError(ruleId, value);
	}
}

/**
 * The error type when a rule's severity is invalid.
 */
class InvalidRuleSeverityError extends Error {
	/**
	 * @param {string} ruleId Rule name being configured.
	 * @param {unknown} value The invalid value.
	 */
	constructor(ruleId, value) {
		super(
			`Key "${ruleId}": Expected severity of "off", 0, "warn", 1, "error", or 2.`,
		);
		this.messageTemplate = "invalid-rule-severity";
		this.messageData = { ruleId, value };
	}
}

/**
 * Validates that a value is valid rule severity.
 * @param {string} ruleId Rule name being configured.
 * @param {unknown} value The value to check.
 * @throws {InvalidRuleSeverityError} If the value isn't a valid rule severity.
 */
function assertIsRuleSeverity(ruleId, value) {
	const severity = ruleSeverities.get(/** @type {string | number} */ (value));

	if (typeof severity === "undefined") {
		throw new InvalidRuleSeverityError(ruleId, value);
	}
}

/**
 * Validates that a given string matches the "pluginName/memberPlaceholder" pattern.
 * @param {unknown} value The string to check.
 * @param {string} memberPlaceholder The placeholder for the member portion of the expected format in the error message.
 * @throws {TypeError} If the string doesn't match the expected pattern.
 */
function assertIsPluginMemberName(value, memberPlaceholder) {
	if (!/[\w\-@$]+(?:\/[\w\-$]+)+$/iu.test(/** @type {string} */ (value))) {
		throw new TypeError(
			`Expected string in the form "pluginName/${memberPlaceholder}" but found "${value}".`,
		);
	}
}

/**
 * Validates that a value is an object.
 * @param {unknown} value The value to check.
 * @throws {TypeError} If the value isn't an object.
 */
function assertIsObject(value) {
	if (!isNonNullObject(value)) {
		throw new TypeError("Expected an object.");
	}
}

/**
 * The error type when there's an eslintrc-style options in a flat config.
 */
class IncompatibleKeyError extends Error {
	/**
	 * @param {string} key The invalid key.
	 */
	constructor(key) {
		super(
			"This appears to be in eslintrc format rather than flat config format.",
		);
		this.messageTemplate = "eslintrc-incompat";
		this.messageData = { key };
	}
}

/**
 * The error type when there's an eslintrc-style plugins array found.
 */
class IncompatiblePluginsError extends Error {
	/**
	 * Creates a new instance.
	 * @param {Array<unknown>} plugins The plugins array.
	 */
	constructor(plugins) {
		super(
			"This appears to be in eslintrc format (array of strings) rather than flat config format (object).",
		);
		this.messageTemplate = "eslintrc-plugins";
		this.messageData = { plugins };
	}
}

//-----------------------------------------------------------------------------
// Low-Level Schemas
//-----------------------------------------------------------------------------

/** @type {PropertyDefinition} */
const booleanSchema = {
	merge: "replace",
	validate: "boolean",
};

/** @type {Set<unknown>} */
const ALLOWED_SEVERITIES = new Set(["error", "warn", "off", 2, 1, 0]);

/** @type {PropertyDefinition} */
const disableDirectiveSeveritySchema = {
	/**
	 * Merges two `reportUnusedDisableDirectives` values.
	 * @param {unknown} first The value from the first config.
	 * @param {unknown} second The value from the second config.
	 * @returns {Severity | "warn" | "off"} The merged value.
	 */
	merge(first, second) {
		const value = second === void 0 ? first : second;

		if (typeof value === "boolean") {
			return value ? "warn" : "off";
		}

		return normalizeSeverityToNumber(
			/** @type {string | number} */ (value),
		);
	},

	/**
	 * Validates a `reportUnusedDisableDirectives` value.
	 * @param {unknown} value The value to validate.
	 * @throws {TypeError} If the value isn't a valid severity or boolean.
	 */
	validate(value) {
		if (!(ALLOWED_SEVERITIES.has(value) || typeof value === "boolean")) {
			throw new TypeError(
				'Expected one of: "error", "warn", "off", 0, 1, 2, or a boolean.',
			);
		}
	},
};

/** @type {PropertyDefinition} */
const unusedInlineConfigsSeveritySchema = {
	/**
	 * Merges two `reportUnusedInlineConfigs` values.
	 * @param {unknown} first The value from the first config.
	 * @param {unknown} second The value from the second config.
	 * @returns {Severity} The merged value.
	 */
	merge(first, second) {
		const value = second === void 0 ? first : second;

		return normalizeSeverityToNumber(
			/** @type {string | number} */ (value),
		);
	},

	/**
	 * Validates a `reportUnusedInlineConfigs` value.
	 * @param {unknown} value The value to validate.
	 * @throws {TypeError} If the value isn't a valid severity.
	 */
	validate(value) {
		if (!ALLOWED_SEVERITIES.has(value)) {
			throw new TypeError(
				'Expected one of: "error", "warn", "off", 0, 1, or 2.',
			);
		}
	},
};

/** @type {PropertyDefinition} */
const deepObjectAssignSchema = {
	/**
	 * Deeply merges two objects.
	 * @param {Record<string, unknown>} [first] The value from the first config.
	 * @param {Record<string, unknown>} [second] The value from the second config.
	 * @returns {Record<string, unknown>} The merged value.
	 */
	merge(first = {}, second = {}) {
		return deepMerge(first, second);
	},
	validate: "object",
};

//-----------------------------------------------------------------------------
// High-Level Schemas
//-----------------------------------------------------------------------------

/**
 * The `languageOptions` schema. Unlike the other schemas in this file, its
 * `merge()` function is also called directly by the `Config` class, so the
 * type is written out in full rather than widened to `PropertyDefinition`.
 * @type {{
 *     merge: (first?: Record<string, unknown>, second?: Record<string, unknown>) => Record<string, unknown>,
 *     validate: "object"
 * }}
 */
const languageOptionsSchema = {
	/**
	 * Deeply merges two `languageOptions` objects.
	 * @param {Record<string, unknown>} [first] The value from the first config.
	 * @param {Record<string, unknown>} [second] The value from the second config.
	 * @returns {Record<string, unknown>} The merged value.
	 */
	merge(first = {}, second = {}) {
		const result = deepMerge(first, second);

		for (const [key, value] of Object.entries(result)) {
			/*
			 * Special case: Because the `parser` property is an object, it should
			 * not be deep merged. Instead, it should be replaced if it exists in
			 * the second object. To make this more generic, we just check for
			 * objects with methods and replace them if they exist in the second
			 * object.
			 */
			if (isNonArrayObject(value)) {
				if (hasMethod(value)) {
					result[key] = second[key] ?? first[key];
					continue;
				}

				// for other objects, make sure we aren't reusing the same object
				result[key] = {
					.../** @type {Record<string, unknown>} */ (result[key]),
				};
				continue;
			}
		}

		return result;
	},
	validate: "object",
};

/** @type {PropertyDefinition} */
const languageSchema = {
	merge: "replace",

	/**
	 * Validates a `language` value.
	 * @param {unknown} value The value to validate.
	 * @throws {TypeError} If the value isn't a plugin member name.
	 */
	validate(value) {
		assertIsPluginMemberName(value, "languageName");
	},
};

/** @type {PropertyDefinition} */
const pluginsSchema = {
	/**
	 * Merges two `plugins` objects.
	 * @param {Record<string, unknown>} [first] The value from the first config.
	 * @param {Record<string, unknown>} [second] The value from the second config.
	 * @returns {Record<string, unknown>} The merged value.
	 * @throws {TypeError} If a plugin is redefined.
	 */
	merge(first = {}, second = {}) {
		const keys = new Set([...Object.keys(first), ...Object.keys(second)]);

		/** @type {Record<string, unknown>} */
		const result = {};

		// manually validate that plugins are not redefined
		for (const key of keys) {
			// avoid hairy edge case
			if (key === "__proto__") {
				continue;
			}

			if (key in first && key in second && first[key] !== second[key]) {
				throw new TypeError(`Cannot redefine plugin "${key}".`);
			}

			result[key] = second[key] || first[key];
		}

		return result;
	},

	/**
	 * Validates a `plugins` value.
	 * @param {unknown} value The value to validate.
	 * @throws {TypeError} If the value isn't an object of objects.
	 */
	validate(value) {
		// first check the value to be sure it's an object
		if (value === null || typeof value !== "object") {
			throw new TypeError("Expected an object.");
		}

		// make sure it's not an array, which would mean eslintrc-style is used
		if (Array.isArray(value)) {
			throw new IncompatiblePluginsError(value);
		}

		/*
		 * The two checks above establish that `value` is a non-null, non-array
		 * object, so reading string keys off of it is sound.
		 */
		const plugins = /** @type {Record<string, unknown>} */ (value);

		// second check the keys to make sure they are objects
		for (const key of Object.keys(plugins)) {
			// avoid hairy edge case
			if (key === "__proto__") {
				continue;
			}

			if (plugins[key] === null || typeof plugins[key] !== "object") {
				throw new TypeError(`Key "${key}": Expected an object.`);
			}
		}
	},
};

/** @type {PropertyDefinition} */
const processorSchema = {
	merge: "replace",

	/**
	 * Validates a `processor` value.
	 * @param {unknown} value The value to validate.
	 * @throws {TypeError} If the value isn't a processor name or object.
	 */
	validate(value) {
		if (typeof value === "string") {
			assertIsPluginMemberName(value, "processorName");
		} else if (value && typeof value === "object") {
			/*
			 * The branch condition establishes that `value` is a non-null
			 * object, so reading the two method names off of it is sound.
			 */
			const processor = /** @type {Record<string, unknown>} */ (value);

			if (
				typeof processor.preprocess !== "function" ||
				typeof processor.postprocess !== "function"
			) {
				throw new TypeError(
					"Object must have a preprocess() and a postprocess() method.",
				);
			}
		} else {
			throw new TypeError("Expected an object or a string.");
		}
	},
};

/** @type {PropertyDefinition} */
const rulesSchema = {
	/**
	 * Merges two `rules` objects.
	 * @param {Record<string, unknown>} [first] The value from the first config.
	 * @param {Record<string, unknown>} [second] The value from the second config.
	 * @returns {Record<string, unknown>} The merged value.
	 * @throws {Error} If a rule's options cannot be normalized.
	 */
	merge(first = {}, second = {}) {
		/** @type {Record<string, unknown>} */
		const result = {
			...first,
			...second,
		};

		for (const ruleId of Object.keys(result)) {
			try {
				// avoid hairy edge case
				if (ruleId === "__proto__") {
					/* eslint-disable-next-line no-proto -- Though deprecated, may still be present */
					delete result.__proto__;
					continue;
				}

				result[ruleId] = normalizeRuleOptions(result[ruleId]);

				/*
				 * If either rule config is missing, then the correct
				 * config is already present and we just need to normalize
				 * the severity.
				 */
				if (!(ruleId in first) || !(ruleId in second)) {
					continue;
				}

				const firstRuleOptions = normalizeRuleOptions(first[ruleId]);
				const secondRuleOptions = normalizeRuleOptions(second[ruleId]);

				/*
				 * If the second rule config only has a severity (length of 1),
				 * then use that severity and keep the rest of the options from
				 * the first rule config.
				 */
				if (secondRuleOptions.length === 1) {
					result[ruleId] = [
						secondRuleOptions[0],
						...firstRuleOptions.slice(1),
					];
					continue;
				}

				/*
				 * In any other situation, then the second rule config takes
				 * precedence. That means the value at `result[ruleId]` is
				 * already correct and no further work is necessary.
				 */
			} catch (ex) {
				throw new Error(
					`Key "${ruleId}": ${/** @type {Error} */ (ex).message}`,
					{
						cause: ex,
					},
				);
			}
		}

		return result;
	},

	/**
	 * Validates a `rules` value.
	 * @param {unknown} value The value to validate.
	 * @throws {TypeError} If the value isn't an object of valid rule options.
	 */
	validate(value) {
		assertIsObject(value);

		/*
		 * `assertIsObject()` above throws for anything that isn't a non-null
		 * object, so reading rule IDs off of it here is sound.
		 */
		const rules = /** @type {Record<string, unknown>} */ (value);

		/*
		 * We are not checking the rule schema here because there is no
		 * guarantee that the rule definition is present at this point. Instead
		 * we wait and check the rule schema during the finalization step
		 * of calculating a config.
		 */
		for (const ruleId of Object.keys(rules)) {
			// avoid hairy edge case
			if (ruleId === "__proto__") {
				continue;
			}

			const ruleOptions = rules[ruleId];

			assertIsRuleOptions(ruleId, ruleOptions);

			if (Array.isArray(ruleOptions)) {
				assertIsRuleSeverity(ruleId, ruleOptions[0]);
			} else {
				assertIsRuleSeverity(ruleId, ruleOptions);
			}
		}
	},
};

/**
 * Creates a schema that always throws an error. Useful for warning
 * about eslintrc-style keys.
 * @param {string} key The eslintrc key to create a schema for.
 * @returns {PropertyDefinition} The schema.
 */
function createEslintrcErrorSchema(key) {
	return {
		merge: "replace",

		/**
		 * Always rejects the value.
		 * @throws {IncompatibleKeyError} Always.
		 */
		validate() {
			throw new IncompatibleKeyError(key);
		},
	};
}

const eslintrcKeys = [
	"env",
	"extends",
	"globals",
	"ignorePatterns",
	"noInlineConfig",
	"overrides",
	"parser",
	"parserOptions",
	"reportUnusedDisableDirectives",
	"root",
];

//-----------------------------------------------------------------------------
// Full schema
//-----------------------------------------------------------------------------

/** @type {ObjectDefinition} */
const flatConfigSchema = {
	// eslintrc-style keys that should always error
	...Object.fromEntries(
		eslintrcKeys.map(key => [key, createEslintrcErrorSchema(key)]),
	),

	// flat config keys
	settings: deepObjectAssignSchema,
	linterOptions: {
		schema: {
			noInlineConfig: booleanSchema,
			reportUnusedDisableDirectives: disableDirectiveSeveritySchema,
			reportUnusedInlineConfigs: unusedInlineConfigsSeveritySchema,
		},
	},
	language: languageSchema,
	languageOptions: languageOptionsSchema,
	processor: processorSchema,
	plugins: pluginsSchema,
	rules: rulesSchema,
};

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

module.exports = {
	flatConfigSchema,
	hasMethod,
	assertIsRuleSeverity,
};

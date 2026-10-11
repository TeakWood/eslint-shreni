// @ts-check
/**
 * @fileoverview Flat config schema
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const { normalizeSeverityToNumber } = require("../shared/severity");

//-----------------------------------------------------------------------------
// Type Definitions
//-----------------------------------------------------------------------------

/** @typedef {import("@eslint/config-array").ObjectDefinition} ObjectDefinition */
/** @typedef {import("@eslint/config-array").PropertyDefinition} PropertyDefinition */
/** @typedef {import("../shared/types.js").RuleConf} RuleConf */

/**
 * An object whose keys are not known ahead of time. The merge and validate
 * strategies below walk user-written config values, so almost everything they
 * touch is of this shape rather than of a declared one.
 * @typedef {Record<string, any>} OpenObject
 */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/*
 * Keyed by `unknown` rather than by `SeverityConf` because every lookup is a
 * membership test over an unvalidated user value; a narrower key type would
 * force a cast at each call site. The entries need the matching cast of their
 * own: the mixed key types widen the literal to `(string | number)[][]`, which
 * picks no `Map` constructor overload (TS2769).
 */
const ruleSeverities = new Map(
	/** @type {[unknown, 0 | 1 | 2][]} */ ([
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
 * @returns {boolean} `true` if the value is a non-null object.
 */
function isNonNullObject(value) {
	return typeof value === "object" && value !== null;
}

/**
 * Check if a value is a non-null non-array object.
 * @param {unknown} value The value to check.
 * @returns {boolean} `true` if the value is a non-null non-array object.
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

/**
 * Deeply merges two non-array objects.
 * @param {OpenObject} first The base object.
 * @param {OpenObject} second The overrides object.
 * @param {Map<OpenObject, Map<OpenObject, OpenObject>>} [mergeMap] Maps the combination of first and second arguments to a merged result.
 * @returns {OpenObject} An object with properties from both first and second.
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
 * @param {RuleConf} ruleOptions The rule options config.
 * @returns {any[]} An array of rule options.
 */
function normalizeRuleOptions(ruleOptions) {
	const finalOptions = Array.isArray(ruleOptions)
		? ruleOptions.slice(0)
		: [ruleOptions];

	finalOptions[0] = ruleSeverities.get(finalOptions[0]);
	return structuredClone(finalOptions);
}

/**
 * Determines if an object has any methods.
 * @param {OpenObject} object The object to check.
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
 * @throws If the value isn't a valid rule options.
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
 * @throws If the value isn't a valid rule severity.
 */
function assertIsRuleSeverity(ruleId, value) {
	const severity = ruleSeverities.get(value);

	if (typeof severity === "undefined") {
		throw new InvalidRuleSeverityError(ruleId, value);
	}
}

/**
 * Validates that a given string matches the "pluginName/memberPlaceholder" pattern.
 * @param {string} value The string to check.
 * @param {string} memberPlaceholder The placeholder for the member portion of the expected format in the error message.
 * @throws If the string doesn't match the expected pattern.
 */
function assertIsPluginMemberName(value, memberPlaceholder) {
	if (!/[\w\-@$]+(?:\/[\w\-$]+)+$/iu.test(value)) {
		throw new TypeError(
			`Expected string in the form "pluginName/${memberPlaceholder}" but found "${value}".`,
		);
	}
}

/**
 * Validates that a value is an object.
 * @param {unknown} value The value to check.
 * @throws If the value isn't an object.
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
	 * @param {unknown[]} plugins The plugins array.
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

/**
 * A `boolean` config key, replaced rather than merged.
 * @satisfies {PropertyDefinition}
 */
const booleanSchema = {
	merge: "replace",
	validate: "boolean",
};

const ALLOWED_SEVERITIES = new Set(["error", "warn", "off", 2, 1, 0]);

/**
 * `linterOptions.reportUnusedDisableDirectives`, which additionally accepts a
 * boolean for backwards compatibility.
 * @satisfies {PropertyDefinition}
 */
const disableDirectiveSeveritySchema = {
	merge(first, second) {
		const value = second === void 0 ? first : second;

		if (typeof value === "boolean") {
			return value ? "warn" : "off";
		}

		return normalizeSeverityToNumber(value);
	},
	validate(value) {
		if (!(ALLOWED_SEVERITIES.has(value) || typeof value === "boolean")) {
			throw new TypeError(
				'Expected one of: "error", "warn", "off", 0, 1, 2, or a boolean.',
			);
		}
	},
};

/**
 * `linterOptions.reportUnusedInlineConfigs`.
 * @satisfies {PropertyDefinition}
 */
const unusedInlineConfigsSeveritySchema = {
	merge(first, second) {
		const value = second === void 0 ? first : second;

		return normalizeSeverityToNumber(value);
	},
	validate(value) {
		if (!ALLOWED_SEVERITIES.has(value)) {
			throw new TypeError(
				'Expected one of: "error", "warn", "off", 0, 1, or 2.',
			);
		}
	},
};

/**
 * A config key whose object value is deeply merged, such as `settings`.
 * @satisfies {PropertyDefinition}
 */
const deepObjectAssignSchema = {
	merge(first = {}, second = {}) {
		return deepMerge(first, second);
	},
	validate: "object",
};

//-----------------------------------------------------------------------------
// High-Level Schemas
//-----------------------------------------------------------------------------

/**
 * `languageOptions`, deeply merged except for members that carry methods.
 * @satisfies {PropertyDefinition}
 */
const languageOptionsSchema = {
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
				result[key] = { ...result[key] };
				continue;
			}
		}

		return result;
	},
	validate: "object",
};

/**
 * `language`, which must name a language in a loaded plugin.
 * @satisfies {PropertyDefinition}
 */
const languageSchema = {
	merge: "replace",
	validate(value) {
		assertIsPluginMemberName(value, "languageName");
	},
};

/**
 * `plugins`, merged key by key so that redefining a namespace is an error.
 * @satisfies {PropertyDefinition}
 */
const pluginsSchema = {
	merge(first = {}, second = {}) {
		const keys = new Set([...Object.keys(first), ...Object.keys(second)]);

		/** @type {OpenObject} */
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
	validate(value) {
		// first check the value to be sure it's an object
		if (value === null || typeof value !== "object") {
			throw new TypeError("Expected an object.");
		}

		// make sure it's not an array, which would mean eslintrc-style is used
		if (Array.isArray(value)) {
			throw new IncompatiblePluginsError(value);
		}

		// second check the keys to make sure they are objects
		for (const key of Object.keys(value)) {
			// avoid hairy edge case
			if (key === "__proto__") {
				continue;
			}

			if (value[key] === null || typeof value[key] !== "object") {
				throw new TypeError(`Key "${key}": Expected an object.`);
			}
		}
	},
};

/**
 * `processor`, either a `"pluginName/processorName"` string or an inline object.
 * @satisfies {PropertyDefinition}
 */
const processorSchema = {
	merge: "replace",
	validate(value) {
		if (typeof value === "string") {
			assertIsPluginMemberName(value, "processorName");
		} else if (value && typeof value === "object") {
			if (
				typeof value.preprocess !== "function" ||
				typeof value.postprocess !== "function"
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

/**
 * `rules`, merged rule by rule so that a severity-only override keeps the
 * options from the earlier config.
 * @satisfies {PropertyDefinition}
 */
const rulesSchema = {
	merge(first = {}, second = {}) {
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
				/*
				 * Narrowed into a second local rather than by casting `ex`
				 * itself, so that `cause` still receives the original binding.
				 */
				const cause = /** @type {Error} */ (ex);

				throw new Error(`Key "${ruleId}": ${cause.message}`, {
					cause: ex,
				});
			}
		}

		return result;
	},

	validate(value) {
		assertIsObject(value);

		/*
		 * We are not checking the rule schema here because there is no
		 * guarantee that the rule definition is present at this point. Instead
		 * we wait and check the rule schema during the finalization step
		 * of calculating a config.
		 */
		for (const ruleId of Object.keys(value)) {
			// avoid hairy edge case
			if (ruleId === "__proto__") {
				continue;
			}

			const ruleOptions = value[ruleId];

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

/**
 * The schema `@eslint/config-array` uses to merge and validate every key of
 * every config object.
 * @satisfies {ObjectDefinition}
 */
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

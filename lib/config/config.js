/**
 * @fileoverview The `Config` class
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const { deepMergeArrays } = require("../shared/deep-merge-arrays");
const { flatConfigSchema, hasMethod } = require("./flat-config-schema");
const { ObjectSchema } = require("@eslint/config-array");
const ajvImport = require("../shared/ajv");
const ajv = ajvImport();
const ruleReplacements = require("../../conf/replacements.json");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").Severity} Severity */
/** @typedef {import("../shared/types.js").RuleModule} RuleModule */

/**
 * The parts of a plugin object that this module reads.
 * @typedef {Object} Plugin
 * @property {Object} [meta] The plugin's metadata, including its `namespace`.
 * @property {Record<string, RuleModule>} [rules] The rules the plugin defines.
 * @property {Record<string, Object>} [languages] The languages the plugin defines.
 * @property {Record<string, Object>} [processors] The processors the plugin defines.
 */

/**
 * A compiled Ajv validator for a rule's options. Ajv narrows `params` per
 * keyword, but the error formatting below reads across keywords, so the error
 * list is widened here.
 * @typedef {((options: Array<unknown>) => unknown) & { errors?: Array<any>|null }} RuleOptionsValidator
 */

/**
 * A `Config` instance viewed together with the keys that the constructor copies
 * onto it from the raw config object via `Object.assign()`. Those keys cannot be
 * declared as class fields, because that would add them to every instance's own
 * properties, which `toJSON()` spreads.
 * @typedef {Config & { rules?: Record<string, any> }} ConfigWithCopiedKeys
 */

//-----------------------------------------------------------------------------
// Private Members
//------------------------------------------------------------------------------

// JSON schema that disallows passing any options
const noOptionsSchema = Object.freeze({
	type: "array",
	minItems: 0,
	maxItems: 0,
});

const severities = new Map(
	/** @type {Array<[string | number, Severity]>} */ ([
		[0, 0],
		[1, 1],
		[2, 2],
		["off", 0],
		["warn", 1],
		["error", 2],
	]),
);

/**
 * A collection of compiled validators for rules that have already
 * been validated.
 * @type {WeakMap<RuleModule, RuleOptionsValidator>}
 */
const validators = new WeakMap();

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Throws a helpful error when a rule cannot be found.
 * @param {Object} ruleId The rule identifier.
 * @param {string} ruleId.pluginName The ID of the rule to find.
 * @param {string} ruleId.ruleName The ID of the rule to find.
 * @param {Config} config The config to search in.
 * @returns {never} Never returns; the call always throws.
 * @throws {TypeError} For missing plugin or rule.
 */
function throwRuleNotFoundError({ pluginName, ruleName }, config) {
	const ruleId = pluginName === "@" ? ruleName : `${pluginName}/${ruleName}`;

	const errorMessageHeader = `Key "rules": Key "${ruleId}"`;

	let errorMessage = `${errorMessageHeader}: Could not find plugin "${pluginName}" in configuration.`;

	const missingPluginErrorMessage = errorMessage;

	// if the plugin exists then we need to check if the rule exists
	if (config.plugins && config.plugins[pluginName]) {
		const replacementRuleName =
			/** @type {Record<string, Array<string>>} */ (
				ruleReplacements.rules
			)[ruleName];

		if (pluginName === "@" && replacementRuleName) {
			errorMessage = `${errorMessageHeader}: Rule "${ruleName}" was removed and replaced by "${replacementRuleName}".`;
		} else {
			errorMessage = `${errorMessageHeader}: Could not find "${ruleName}" in plugin "${pluginName}".`;

			// otherwise, let's see if we can find the rule name elsewhere
			for (const [otherPluginName, otherPlugin] of Object.entries(
				config.plugins,
			)) {
				if (otherPlugin.rules && otherPlugin.rules[ruleName]) {
					errorMessage += ` Did you mean "${otherPluginName}/${ruleName}"?`;
					break;
				}
			}
		}

		// falls through to throw error
	}

	const error =
		/** @type {TypeError & { messageTemplate?: string, messageData?: Object }} */ (
			new TypeError(errorMessage)
		);

	if (errorMessage === missingPluginErrorMessage) {
		error.messageTemplate = "config-plugin-missing";
		error.messageData = { pluginName, ruleId };
	}

	throw error;
}

/**
 * The error type when a rule has an invalid `meta.schema`.
 */
class InvalidRuleOptionsSchemaError extends Error {
	/**
	 * Creates a new instance.
	 * @param {string} ruleId Id of the rule that has an invalid `meta.schema`.
	 * @param {Error} processingError Error caught while processing the `meta.schema`.
	 */
	constructor(ruleId, processingError) {
		super(
			`Error while processing options validation schema of rule '${ruleId}': ${processingError.message}`,
			{ cause: processingError },
		);
		this.code = "ESLINT_INVALID_RULE_OPTIONS_SCHEMA";
	}
}

/**
 * Parses a ruleId into its plugin and rule parts.
 * @param {string} ruleId The rule ID to parse.
 * @returns {{ pluginName: string, ruleName: string }} The plugin and rule
 *      parts of the ruleId;
 */
function parseRuleId(ruleId) {
	let pluginName, ruleName;

	// distinguish between core rules and plugin rules
	if (ruleId.includes("/")) {
		// mimic scoped npm packages
		if (ruleId.startsWith("@")) {
			pluginName = ruleId.slice(0, ruleId.lastIndexOf("/"));
		} else {
			pluginName = ruleId.slice(0, ruleId.indexOf("/"));
		}

		ruleName = ruleId.slice(pluginName.length + 1);
	} else {
		pluginName = "@";
		ruleName = ruleId;
	}

	return {
		pluginName,
		ruleName,
	};
}

/**
 * Retrieves a rule instance from a given config based on the ruleId.
 * @param {string} ruleId The rule ID to look for.
 * @param {Config} config The config to search.
 * @returns {RuleModule|undefined} The rule if found
 *      or undefined if not.
 */
function getRuleFromConfig(ruleId, config) {
	const { pluginName, ruleName } = parseRuleId(ruleId);

	return config.plugins?.[pluginName]?.rules?.[ruleName];
}

/**
 * Gets a complete options schema for a rule.
 * @param {RuleModule} rule A rule object
 * @throws {TypeError} If `meta.schema` is specified but is not an array, object or `false`.
 * @returns {Object|null} JSON Schema for the rule's options. `null` if `meta.schema` is `false`.
 */
function getRuleOptionsSchema(rule) {
	if (!rule.meta) {
		return { ...noOptionsSchema }; // default if `meta.schema` is not specified
	}

	const schema = rule.meta.schema;

	if (typeof schema === "undefined") {
		return { ...noOptionsSchema }; // default if `meta.schema` is not specified
	}

	// `schema:false` is an allowed explicit opt-out of options validation for the rule
	if (schema === false) {
		return null;
	}

	if (typeof schema !== "object" || schema === null) {
		throw new TypeError("Rule's `meta.schema` must be an array or object");
	}

	// ESLint-specific array form needs to be converted into a valid JSON Schema definition
	if (Array.isArray(schema)) {
		if (schema.length) {
			return {
				type: "array",
				items: schema,
				minItems: 0,
				maxItems: schema.length,
			};
		}

		// `schema:[]` is an explicit way to specify that the rule does not accept any options
		return { ...noOptionsSchema };
	}

	// `schema:<object>` is assumed to be a valid JSON Schema definition
	return schema;
}

/**
 * Splits a plugin identifier in the form a/b/c into two parts: a/b and c.
 * @param {string} identifier The identifier to parse.
 * @returns {{ objectName: string, pluginName: string }} The parts of the plugin
 *      name.
 */
function splitPluginIdentifier(identifier) {
	const parts = identifier.split("/");

	return {
		// `String#split()` always yields at least one element, so this is never `undefined`
		objectName: /** @type {string} */ (parts.pop()),
		pluginName: parts.join("/"),
	};
}

/**
 * Normalizes a language name by replacing the built-in `@/` plugin prefix with `js/`.
 * @param {string} languageName The language name to normalize.
 * @returns {string} The normalized language name.
 */
function normalizeLanguageName(languageName) {
	return languageName.startsWith("@/")
		? `js/${languageName.slice(2)}`
		: languageName;
}

/**
 * Checks if a rule's `meta.languages` supports the given language.
 * @param {Array<unknown>|undefined} ruleLangs The rule's `meta.languages` array.
 * @param {string} configLanguageName The normalized language name from the config (e.g., "js/js").
 * @param {Array<string>} validPluginNames The valid plugin name aliases for the config's plugin
 *   (normalized plugin name plus its `meta.namespace` if defined).
 * @returns {boolean} `true` if the rule supports the language, `false` otherwise.
 */
function doesRuleSupportLanguage(
	ruleLangs,
	configLanguageName,
	validPluginNames,
) {
	// If no languages specified, works with all languages (backward compatible)
	if (!ruleLangs) {
		return true;
	}

	const { objectName: configLangPart } =
		splitPluginIdentifier(configLanguageName);

	for (const langEntry of ruleLangs) {
		// Skip non-string entries
		if (typeof langEntry !== "string") {
			continue;
		}

		// "*" matches any language
		if (langEntry === "*") {
			return true;
		}

		// Direct match
		if (langEntry === configLanguageName) {
			return true;
		}

		const { pluginName: rulePluginPart, objectName: ruleLangPart } =
			splitPluginIdentifier(langEntry);

		// "plugin/*" wildcard - matches any language from that plugin (by name or namespace)
		if (ruleLangPart === "*") {
			if (validPluginNames.includes(rulePluginPart)) {
				return true;
			}
		} else {
			// Match by plugin name or namespace, with exact language part
			if (
				validPluginNames.includes(rulePluginPart) &&
				ruleLangPart === configLangPart
			) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Returns the name of an object in the config by reading its `meta` key.
 * @param {Record<string, any>} object The object to check.
 * @returns {string|null} The name of the object if found or `null` if there
 *      is no name.
 */
function getObjectId(object) {
	// first check old-style name
	let name = object.name;

	if (!name) {
		if (!object.meta) {
			return null;
		}

		name = object.meta.name;

		if (!name) {
			return null;
		}
	}

	// now check for old-style version
	let version = object.version;

	if (!version) {
		version = object.meta && object.meta.version;
	}

	// if there's a version then append that
	if (version) {
		return `${name}@${version}`;
	}

	return name;
}

/**
 * Asserts that a value is not a function.
 * @param {unknown} value The value to check.
 * @param {string} key The key of the value in the object.
 * @param {string} objectKey The key of the object being checked.
 * @throws {TypeError} If the value is a function.
 */
function assertNotFunction(value, key, objectKey) {
	if (typeof value === "function") {
		const error =
			/** @type {TypeError & { messageTemplate?: string, messageData?: Object }} */ (
				new TypeError(
					`Cannot serialize key "${key}" in "${objectKey}": Function values are not supported.`,
				)
			);

		error.messageTemplate = "config-serialize-function";
		error.messageData = { key, objectKey };

		throw error;
	}
}

/**
 * Converts a languageOptions object to a JSON representation.
 * @param {Record<string, any>} languageOptions The options to create a JSON
 *     representation of.
 * @param {string} [objectKey] The key of the object being converted.
 * @returns {Record<string, any>} The JSON representation of the languageOptions.
 * @throws {TypeError} If a function is found in the languageOptions.
 */
function languageOptionsToJSON(languageOptions, objectKey = "languageOptions") {
	if (typeof languageOptions.toJSON === "function") {
		const result = languageOptions.toJSON();

		assertNotFunction(result, "toJSON", objectKey);

		return result;
	}

	/** @type {Record<string, any>} */
	const result = {};

	for (const [key, value] of Object.entries(languageOptions)) {
		if (value) {
			if (typeof value === "object") {
				const name = getObjectId(value);

				if (typeof value.toJSON === "function") {
					result[key] = value.toJSON();
					assertNotFunction(result[key], key, objectKey);
				} else if (name && hasMethod(value)) {
					result[key] = name;
				} else {
					result[key] = languageOptionsToJSON(value, key);
				}
				continue;
			}

			assertNotFunction(value, key, objectKey);
		}

		result[key] = value;
	}

	return result;
}

/**
 * Gets or creates a validator for a rule.
 * @param {RuleModule} rule The rule to get a validator for.
 * @param {string} ruleId The ID of the rule (for error reporting).
 * @returns {RuleOptionsValidator|undefined} A validation function or `undefined` if no validation is needed.
 * @throws {InvalidRuleOptionsSchemaError} If a rule's `meta.schema` is invalid.
 */
function getOrCreateValidator(rule, ruleId) {
	if (!validators.has(rule)) {
		try {
			const schema = getRuleOptionsSchema(rule);

			if (schema) {
				validators.set(rule, ajv.compile(schema));
			}
		} catch (err) {
			throw new InvalidRuleOptionsSchemaError(
				ruleId,
				/** @type {Error} */ (err),
			);
		}
	}

	return validators.get(rule);
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Represents a normalized configuration object.
 */
class Config {
	/**
	 * The name to use for the language when serializing to JSON.
	 */
	#languageName;

	/**
	 * The name to use for the processor when serializing to JSON.
	 */
	#processorName;

	/**
	 * Creates a new instance.
	 * @param {Record<string, any>} config The configuration object. Config objects
	 *      carry plugin-defined keys whose shapes this class cannot know, so the
	 *      values are left open here and narrowed at each use.
	 * @throws {TypeError} If the config is invalid.
	 */
	constructor(config) {
		const { plugins, language, languageOptions, processor, ...otherKeys } =
			config;

		// Validate config object
		const schema = new ObjectSchema(flatConfigSchema);

		schema.validate(config);

		// first, copy all the other keys over
		Object.assign(this, otherKeys);

		// ensure that a language is specified
		if (!language) {
			throw new TypeError("Key 'language' is required.");
		}

		// copy the rest over
		this.plugins = plugins;
		this.language = language;

		// Check language value
		const {
			pluginName: languagePluginName,
			objectName: localLanguageName,
		} = splitPluginIdentifier(language);

		this.#languageName = language;

		if (
			!plugins ||
			!plugins[languagePluginName] ||
			!plugins[languagePluginName].languages ||
			!plugins[languagePluginName].languages[localLanguageName]
		) {
			throw new TypeError(
				`Key "language": Could not find "${localLanguageName}" in plugin "${languagePluginName}".`,
			);
		}

		this.language =
			plugins[languagePluginName].languages[localLanguageName];

		if (this.language.defaultLanguageOptions ?? languageOptions) {
			/*
			 * `flatConfigSchema` is typed as a generic `ObjectDefinition`, in
			 * which `merge` may also be the name of a built-in strategy. The
			 * `languageOptions` entry always defines a merge function.
			 */
			const mergeLanguageOptions =
				/** @type {(first: any, second: any) => any} */ (
					flatConfigSchema.languageOptions.merge
				);

			this.languageOptions = mergeLanguageOptions(
				this.language.defaultLanguageOptions,
				languageOptions,
			);
		} else {
			this.languageOptions = {};
		}

		// Validate language options
		try {
			this.language.validateLanguageOptions(this.languageOptions);
		} catch (error) {
			throw new TypeError(
				`Key "languageOptions": ${/** @type {Error} */ (error).message}`,
				{
					cause: error,
				},
			);
		}

		// Normalize language options if necessary
		if (this.language.normalizeLanguageOptions) {
			this.languageOptions = this.language.normalizeLanguageOptions(
				this.languageOptions,
			);
		}

		// Check processor value
		if (processor) {
			this.processor = processor;

			if (typeof processor === "string") {
				const { pluginName, objectName: localProcessorName } =
					splitPluginIdentifier(processor);

				this.#processorName = processor;

				if (
					!plugins ||
					!plugins[pluginName] ||
					!plugins[pluginName].processors ||
					!plugins[pluginName].processors[localProcessorName]
				) {
					throw new TypeError(
						`Key "processor": Could not find "${localProcessorName}" in plugin "${pluginName}".`,
					);
				}

				this.processor =
					plugins[pluginName].processors[localProcessorName];
			} else if (typeof processor === "object") {
				this.#processorName = getObjectId(processor);
				this.processor = processor;
			} else {
				throw new TypeError(
					"Key 'processor' must be a string or an object.",
				);
			}
		}

		// Process the rules
		const { rules } = /** @type {ConfigWithCopiedKeys} */ (this);

		if (rules) {
			this.#normalizeRulesConfig();
			this.validateRulesConfig(rules);
		}
	}

	/**
	 * Converts the configuration to a JSON representation.
	 * @returns {Record<string, any>} The JSON representation of the configuration.
	 * @throws {Error} If the configuration cannot be serialized.
	 */
	toJSON() {
		if (this.processor && !this.#processorName) {
			throw new Error(
				"Could not serialize processor object (missing 'meta' object).",
			);
		}

		if (!this.#languageName) {
			throw new Error(
				"Could not serialize language object (missing 'meta' object).",
			);
		}

		return {
			...this,
			plugins: Object.entries(this.plugins).map(([namespace, plugin]) => {
				const pluginId = getObjectId(plugin);

				if (!pluginId) {
					return namespace;
				}

				return `${namespace}:${pluginId}`;
			}),
			language: this.#languageName,
			languageOptions: languageOptionsToJSON(this.languageOptions),
			processor: this.#processorName,
		};
	}

	/**
	 * Gets a rule configuration by its ID.
	 * @param {string} ruleId The ID of the rule to get.
	 * @returns {RuleModule|undefined} The rule definition from the plugin, or `undefined` if the rule is not found.
	 */
	getRuleDefinition(ruleId) {
		return getRuleFromConfig(ruleId, this);
	}

	/**
	 * Normalizes the rules configuration. Ensures that each rule config is
	 * an array and that the severity is a number. Applies meta.defaultOptions.
	 * This function modifies `this.rules`.
	 */
	#normalizeRulesConfig() {
		// only called from the constructor after `rules` is known to be present
		const rules = /** @type {Record<string, any>} */ (
			/** @type {ConfigWithCopiedKeys} */ (this).rules
		);

		for (const [ruleId, originalConfig] of Object.entries(rules)) {
			// ensure rule config is an array
			let ruleConfig = Array.isArray(originalConfig)
				? originalConfig
				: [originalConfig];

			// normalize severity
			ruleConfig[0] = severities.get(ruleConfig[0]);

			const rule = getRuleFromConfig(ruleId, this);

			// apply meta.defaultOptions
			const slicedOptions = ruleConfig.slice(1);
			const mergedOptions = deepMergeArrays(
				rule?.meta?.defaultOptions,
				slicedOptions,
			);

			if (mergedOptions.length) {
				ruleConfig = [ruleConfig[0], ...mergedOptions];
			}

			rules[ruleId] = ruleConfig;
		}
	}

	/**
	 * Validates all of the rule configurations in the given rules config
	 * against the plugins in this instance. This is used primarily to
	 * validate inline configuration rules while inting.
	 * @param {Record<string, Array<unknown>>} rulesConfig The rules config to validate.
	 *      Every entry is already an array by the time this runs.
	 * @throws {Error} If a rule's configuration does not match its schema.
	 * @throws {TypeError} If the rulesConfig is not provided or is invalid.
	 * @throws {InvalidRuleOptionsSchemaError} If a rule's `meta.schema` is invalid.
	 * @throws {TypeError} If a rule is not found in the plugins.
	 * @throws {TypeError} If a rule does not support the current language.
	 */
	validateRulesConfig(rulesConfig) {
		if (!rulesConfig) {
			throw new TypeError("Config is required for validation.");
		}

		// Normalize "@/" prefix to "js/" for matching and user-facing messages
		const normalizedLanguageName = normalizeLanguageName(
			this.#languageName,
		);

		// Compute valid plugin name aliases for the config's language plugin once
		const { pluginName: configPluginName } = splitPluginIdentifier(
			normalizedLanguageName,
		);
		const configPlugin =
			this.plugins[configPluginName] ??
			(configPluginName === "js" ? this.plugins["@"] : void 0);
		const validPluginNames = configPlugin?.meta?.namespace
			? [configPluginName, configPlugin.meta.namespace]
			: [configPluginName];
		const unsupportedLanguageRules = [];

		for (const [ruleId, ruleOptions] of Object.entries(rulesConfig)) {
			// check for edge case
			if (ruleId === "__proto__") {
				continue;
			}

			/*
			 * If a rule is disabled, we don't do any validation. This allows
			 * users to safely set any value to 0 or "off" without worrying
			 * that it will cause a validation error.
			 *
			 * Note: ruleOptions is always an array at this point because
			 * this validation occurs after FlatConfigArray has merged and
			 * normalized values.
			 */
			if (ruleOptions[0] === 0) {
				continue;
			}

			const rule = getRuleFromConfig(ruleId, this);

			if (!rule) {
				throwRuleNotFoundError(parseRuleId(ruleId), this);
			}

			// Validate meta.languages structure if present (only for enabled rules)
			if (rule.meta?.languages !== void 0) {
				if (!Array.isArray(rule.meta.languages)) {
					throw new TypeError(
						`Key "rules": Key "${ruleId}": Key "meta": Key "languages": Expected an array.`,
					);
				}

				for (const lang of rule.meta.languages) {
					if (typeof lang !== "string") {
						throw new TypeError(
							`Key "rules": Key "${ruleId}": Key "meta": Key "languages": Expected each element to be a string.`,
						);
					}
				}
			}

			// Check if the rule supports the current language
			if (
				!doesRuleSupportLanguage(
					rule.meta?.languages,
					normalizedLanguageName,
					validPluginNames,
				)
			) {
				unsupportedLanguageRules.push(ruleId);
			}

			const validateRule = getOrCreateValidator(rule, ruleId);

			if (validateRule) {
				validateRule(ruleOptions.slice(1));

				if (validateRule.errors) {
					throw new Error(
						`Key "rules": Key "${ruleId}":\n${validateRule.errors
							.map(error => {
								if (
									error.keyword === "additionalProperties" &&
									error.schema === false &&
									typeof error.parentSchema?.properties ===
										"object" &&
									typeof error.params?.additionalProperty ===
										"string"
								) {
									const expectedProperties = Object.keys(
										error.parentSchema.properties,
									).map(property => `"${property}"`);

									return `\tValue ${JSON.stringify(error.data)} ${error.message}.\n\t\tUnexpected property "${error.params.additionalProperty}". Expected properties: ${expectedProperties.join(", ")}.\n`;
								}

								return `\tValue ${JSON.stringify(error.data)} ${error.message}.\n`;
							})
							.join("")}`,
					);
				}
			}
		}

		if (unsupportedLanguageRules.length > 0) {
			const error =
				/** @type {TypeError & { messageTemplate?: string, messageData?: Object }} */ (
					new TypeError(
						`Key "rules": The following rules do not support the language "${normalizedLanguageName}":\n${unsupportedLanguageRules.map(ruleId => `\t- "${ruleId}"`).join("\n")}`,
					)
				);

			error.messageTemplate = "rule-unsupported-language";
			error.messageData = {
				ruleIds: unsupportedLanguageRules,
				language: normalizedLanguageName,
			};
			throw error;
		}
	}

	/**
	 * Gets a complete options schema for a rule.
	 * @param {RuleModule} ruleDefinition A rule definition object.
	 * @throws {TypeError} If `meta.schema` is specified but is not an array, object or `false`.
	 * @returns {Object|null} JSON Schema for the rule's options. `null` if `meta.schema` is `false`.
	 */
	static getRuleOptionsSchema(ruleDefinition) {
		return getRuleOptionsSchema(ruleDefinition);
	}

	/**
	 * Normalizes the severity value of a rule's configuration to a number
	 * @param {unknown} ruleConfig A rule's configuration value, generally
	 * received from the user. A valid config value is either 0, 1, 2, the string "off" (treated the same as 0),
	 * the string "warn" (treated the same as 1), the string "error" (treated the same as 2), or an array
	 * whose first element is one of the above values. Strings are matched case-insensitively.
	 * @returns {Severity} The numeric severity value if the config value was valid, otherwise 0.
	 */
	static getRuleNumericSeverity(ruleConfig) {
		const severityValue = Array.isArray(ruleConfig)
			? ruleConfig[0]
			: ruleConfig;

		if (severities.has(/** @type {string | number} */ (severityValue))) {
			// the `has()` check above guarantees a hit
			return /** @type {Severity} */ (
				severities.get(/** @type {string | number} */ (severityValue))
			);
		}

		if (typeof severityValue === "string") {
			return severities.get(severityValue.toLowerCase()) ?? 0;
		}

		return 0;
	}
}

module.exports = { Config };

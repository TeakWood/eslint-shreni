// @ts-check
/**
 * @fileoverview Flat Config Array
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const { ConfigArray, ConfigArraySymbol } = require("@eslint/config-array");
const { flatConfigSchema } = require("./flat-config-schema");
const { defaultConfig } = require("./default-config");
const { Config } = require("./config");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").ConfigObject} ConfigObject */

/**
 * The error `@eslint/config-array` throws when a config object fails the
 * schema. `index` is the position of the offending object in the array.
 * @typedef {Error & { index: number }} ConfigError
 */

/**
 * The options `FlatConfigArray`'s constructor accepts.
 * @typedef {Object} FlatConfigArrayOptions
 * @property {string} [basePath] The directory that relative `files` and `ignores` patterns resolve against.
 * @property {boolean} [shouldIgnore] `false` to honor only the `ignores` of `baseConfig`. Defaults to `true`.
 * @property {ConfigObject | readonly ConfigObject[]} [baseConfig] The config objects to prepend. Defaults to {@link defaultConfig}.
 */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Fields that are considered metadata and not part of the config object.
 */
const META_FIELDS = new Set(["name", "basePath"]);

/**
 * Wraps a config error with details about where the error occurred.
 * @param {ConfigError} error The original error.
 * @param {number} originalLength The original length of the config array.
 * @param {number} baseLength The length of the base config.
 * @returns {TypeError} The new error with details.
 */
function wrapConfigErrorWithDetails(error, originalLength, baseLength) {
	let location = "user-defined";
	let configIndex = error.index;

	/*
	 * A config array is set up in this order:
	 * 1. Base config
	 * 2. Original configs
	 * 3. User-defined configs
	 * 4. CLI-defined configs
	 *
	 * So we need to adjust the index to account for the base config.
	 *
	 * - If the index is less than the base length, it's in the base config
	 *   (as specified by `baseConfig` argument to `FlatConfigArray` constructor).
	 * - If the index is greater than the base length but less than the original
	 *   length + base length, it's in the original config. The original config
	 *   is passed to the `FlatConfigArray` constructor as the first argument.
	 * - Otherwise, it's in the user-defined config, which is loaded from the
	 *   config file and merged with any command-line options.
	 */
	if (error.index < baseLength) {
		location = "base";
	} else if (error.index < originalLength + baseLength) {
		location = "original";
		configIndex = error.index - baseLength;
	} else {
		configIndex = error.index - originalLength - baseLength;
	}

	return new TypeError(
		`${error.message.slice(0, -1)} at ${location} index ${configIndex}.`,
		{ cause: error },
	);
}

const originalBaseConfig = Symbol("originalBaseConfig");
const originalLength = Symbol("originalLength");
const baseLength = Symbol("baseLength");

/**
 * Views an instance as its symbol-keyed slots.
 *
 * The three slots above are stored on the instance under symbols so that they
 * stay off the serialized config array. JSDoc has no syntax for declaring a
 * symbol-keyed property, and `FlatConfigArray` inherits an array's numeric-only
 * index signature, so every read and write of a slot goes through this view
 * (TS7015 otherwise).
 * @typedef {Record<symbol, any>} Slots
 */

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Represents an array containing configuration information for ESLint.
 */
class FlatConfigArray extends ConfigArray {
	/**
	 * Creates a new instance.
	 * @param {Iterable<any> | Function | Object} configs An array of configuration information.
	 * @param {FlatConfigArrayOptions} [options] The options
	 *      to use for the config array instance.
	 */
	constructor(
		configs,
		{ basePath, shouldIgnore = true, baseConfig = defaultConfig } = {},
	) {
		super(configs, {
			basePath,
			schema: flatConfigSchema,
		});

		const slots = /** @type {Slots} */ (/** @type {unknown} */ (this));

		/**
		 * The original length of the array before any modifications.
		 */
		slots[originalLength] = this.length;

		if (/** @type {any} */ (baseConfig)[Symbol.iterator]) {
			this.unshift(
				.../** @type {readonly ConfigObject[]} */ (baseConfig),
			);
		} else {
			this.unshift(baseConfig);
		}

		/**
		 * The length of the array after applying the base config.
		 */
		slots[baseLength] = this.length - slots[originalLength];

		/**
		 * The base config used to build the config array.
		 */
		slots[originalBaseConfig] = baseConfig;
		Object.defineProperty(this, originalBaseConfig, { writable: false });

		/**
		 * Determines if `ignores` fields should be honored.
		 * If true, then all `ignores` fields are honored.
		 * if false, then only `ignores` fields in the baseConfig are honored.
		 */
		this.shouldIgnore = shouldIgnore;
		Object.defineProperty(this, "shouldIgnore", { writable: false });
	}

	/**
	 * Normalizes the array by calling the superclass method and catching/rethrowing
	 * any ConfigError exceptions with additional details.
	 * @param {any} [context] The context to use to normalize the array.
	 * @returns A promise that resolves when the array is normalized.
	 */
	normalize(context) {
		const slots = /** @type {Slots} */ (/** @type {unknown} */ (this));

		return super.normalize(context).catch(error => {
			if (error.name === "ConfigError") {
				throw wrapConfigErrorWithDetails(
					error,
					slots[originalLength],
					slots[baseLength],
				);
			}

			throw error;
		});
	}

	/**
	 * Normalizes the array by calling the superclass method and catching/rethrowing
	 * any ConfigError exceptions with additional details.
	 * @param {any} [context] The context to use to normalize the array.
	 * @returns The current instance.
	 * @throws If the config is invalid.
	 */
	normalizeSync(context) {
		const slots = /** @type {Slots} */ (/** @type {unknown} */ (this));

		try {
			return super.normalizeSync(context);
		} catch (error) {
			/*
			 * Narrowed into a second local rather than by casting the catch
			 * binding, so that the rethrow below passes the original on.
			 */
			const configError = /** @type {ConfigError} */ (error);

			if (configError.name === "ConfigError") {
				throw wrapConfigErrorWithDetails(
					configError,
					slots[originalLength],
					slots[baseLength],
				);
			}

			throw error;
		}
	}

	/* eslint-disable class-methods-use-this -- Desired as instance method */
	/**
	 * Replaces a config with another config to allow us to put strings
	 * in the config array that will be replaced by objects before
	 * normalization.
	 * @param {ConfigObject} config The config to preprocess.
	 * @returns {ConfigObject} The preprocessed config.
	 */
	[ConfigArraySymbol.preprocessConfig](config) {
		/*
		 * If a config object has `ignores` and no other non-meta fields, then it's an object
		 * for global ignores. If `shouldIgnore` is false, that object shouldn't apply,
		 * so we'll remove its `ignores`.
		 */
		const slots = /** @type {Slots} */ (/** @type {unknown} */ (this));

		if (
			!this.shouldIgnore &&
			!slots[originalBaseConfig].includes(config) &&
			config.ignores &&
			Object.keys(config).filter(key => !META_FIELDS.has(key)).length ===
				1
		) {
			/* eslint-disable-next-line no-unused-vars -- need to strip off other keys */
			const { ignores, ...otherKeys } = config;

			return otherKeys;
		}

		return config;
	}

	/**
	 * Finalizes the config by replacing plugin references with their objects
	 * and validating rule option schemas.
	 * @param {ConfigObject} config The config to finalize.
	 * @returns {Config} The finalized config.
	 * @throws If the config is invalid.
	 */
	[ConfigArraySymbol.finalizeConfig](config) {
		return new Config(config);
	}
	/* eslint-enable class-methods-use-this -- Desired as instance method */
}

exports.FlatConfigArray = FlatConfigArray;

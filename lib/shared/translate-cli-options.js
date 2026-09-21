/**
 * @fileoverview Translates CLI options into ESLint constructor options.
 * @author Nicholas C. Zakas
 * @author Francesco Trotta
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { normalizeSeverityToString } = require("./severity");
const { getShorthandName, normalizePackageName } = require("./naming");

/*
 * `@humanwhocodes/module-importer` publishes no type declarations, so tsc
 * cannot infer a type for it. `ModuleImporter` is described by the
 * `ModuleImporterLike` typedef below and used through that type instead.
 */
// @ts-ignore -- no type declarations are published for this package
const { ModuleImporter } = require("@humanwhocodes/module-importer");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./types.js").LintMessage} LintMessage */

/**
 * The subset of `ModuleImporter` that this module relies on.
 * @typedef {Object} ModuleImporterLike
 * @property {(specifier: string) => Promise<Record<string, unknown>>} import Imports the module with the given specifier.
 */

/**
 * A config object synthesized from the CLI options.
 * @typedef {Object} OverrideConfigEntry
 * @property {Array<string>} [files] The glob patterns the entry applies to.
 * @property {Record<string, unknown>} [languageOptions] The language options to apply.
 * @property {Record<string, unknown>} [linterOptions] The linter options to apply.
 * @property {Record<string, unknown>} [plugins] The plugins to make available, keyed by short name.
 * @property {Record<string, unknown>} [rules] The rules to configure.
 */

/**
 * The parsed CLI options that are translated into ESLint constructor options.
 * @typedef {Object} CLIOptions
 * @property {boolean} [cache] Whether to use the lint result cache.
 * @property {string} [cacheFile] The deprecated path to the cache file.
 * @property {string} [cacheLocation] The path to the cache file or directory.
 * @property {"metadata" | "content"} [cacheStrategy] The strategy used to detect changed files.
 * @property {number | "auto" | "off"} [concurrency] The number of threads to lint with.
 * @property {string | boolean} [config] The path to the config file, or `false` when unset.
 * @property {boolean} [configLookup] Whether to search for a config file relative to each linted file.
 * @property {boolean} [errorOnUnmatchedPattern] Whether an unmatched file pattern is an error.
 * @property {Array<string>} [ext] The additional file extensions to lint.
 * @property {boolean} [fix] Whether to write fixes to disk.
 * @property {boolean} [fixDryRun] Whether to compute fixes without writing them.
 * @property {Array<string>} [fixType] The kinds of fixes to apply.
 * @property {Array<string>} [flag] The feature flags to enable.
 * @property {Array<string>} [global] The globals to define, each optionally suffixed with `:true`.
 * @property {boolean} [ignore] Whether to respect ignore files and patterns.
 * @property {Array<string>} [ignorePattern] The additional patterns to ignore.
 * @property {boolean} [inlineConfig] Whether inline configuration comments are honored.
 * @property {number} [maxWarnings] The warning count above which the run fails, or `-1` for no limit.
 * @property {string} [parser] The module name of the parser to use.
 * @property {Record<string, unknown>} [parserOptions] The options to pass to the parser.
 * @property {boolean} [passOnNoPatterns] Whether to exit successfully when no patterns are given.
 * @property {Array<string>} [plugin] The names of the plugins to load.
 * @property {boolean} [quiet] Whether to report errors only.
 * @property {boolean} [reportUnusedDisableDirectives] Whether unused disable directives are errors.
 * @property {string | number} [reportUnusedDisableDirectivesSeverity] The severity for unused disable directives.
 * @property {string | number} [reportUnusedInlineConfigs] The severity for unused inline configs.
 * @property {Record<string, unknown>} [rule] The rules to configure.
 * @property {boolean} [stats] Whether to collect timing statistics.
 * @property {boolean} [warnIgnored] Whether explicitly passed ignored files produce a warning.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Loads plugins with the specified names.
 * @param {ModuleImporterLike} importer An object with an `import` method called once for each plugin.
 * @param {Array<string>} pluginNames The names of the plugins to be loaded, with or without the "eslint-plugin-" prefix.
 * @returns {Promise<Record<string, unknown>>} A mapping of plugin short names to implementations.
 */
async function loadPlugins(importer, pluginNames) {
	/** @type {Record<string, unknown>} */
	const plugins = {};

	await Promise.all(
		pluginNames.map(async pluginName => {
			const longName = normalizePackageName(pluginName, "eslint-plugin");
			const module = await importer.import(longName);

			if (!("default" in module)) {
				throw new Error(
					`"${longName}" cannot be used with the \`--plugin\` option because its default module does not provide a \`default\` export`,
				);
			}

			const shortName = getShorthandName(pluginName, "eslint-plugin");

			plugins[shortName] = module.default;
		}),
	);

	return plugins;
}

/**
 * Predicate function for whether or not to apply fixes in quiet mode.
 * If a message is a warning, do not apply a fix.
 * @param {LintMessage} message The lint result.
 * @returns {boolean} `true` if the lint message is an error (and thus should be
 * autofixed), `false` otherwise.
 */
function quietFixPredicate(message) {
	return message.severity === 2;
}

/**
 * Predicate function for whether or not to run a rule in quiet mode.
 * If a rule is set to warning, do not run it.
 * @param {{ ruleId: string, severity: number }} rule The rule id and severity.
 * @returns {boolean} `true` if the lint rule should run, `false` otherwise.
 */
function quietRuleFilter(rule) {
	return rule.severity === 2;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Translates the CLI options into the options expected by the ESLint constructor.
 * @param {CLIOptions} cliOptions The CLI options to translate.
 * @returns {Promise<Object>} The options object for the ESLint constructor.
 */
async function translateOptions({
	cache,
	cacheFile,
	cacheLocation,
	cacheStrategy,
	concurrency,
	config,
	configLookup,
	errorOnUnmatchedPattern,
	ext,
	fix,
	fixDryRun,
	fixType,
	flag,
	global,
	ignore,
	ignorePattern,
	inlineConfig,
	parser,
	parserOptions,
	plugin,
	quiet,
	reportUnusedDisableDirectives,
	reportUnusedDisableDirectivesSeverity,
	reportUnusedInlineConfigs,
	rule,
	stats,
	warnIgnored,
	passOnNoPatterns,
	maxWarnings,
}) {
	const importer = /** @type {ModuleImporterLike} */ (new ModuleImporter());

	/** @type {string | boolean | undefined} */
	let overrideConfigFile =
		typeof config === "string" ? config : !configLookup;

	if (overrideConfigFile === false) {
		overrideConfigFile = void 0;
	}

	/** @type {Record<string, unknown>} */
	const languageOptions = {};

	if (global) {
		languageOptions.globals = global.reduce((obj, name) => {
			if (name.endsWith(":true")) {
				obj[name.slice(0, -5)] = "writable";
			} else {
				obj[name] = "readonly";
			}
			return obj;
		}, /** @type {Record<string, string>} */ ({}));
	}

	if (parserOptions) {
		languageOptions.parserOptions = parserOptions;
	}

	if (parser) {
		languageOptions.parser = await importer.import(parser);
	}

	/** @type {Array<OverrideConfigEntry>} */
	const overrideConfig = [
		{
			...(Object.keys(languageOptions).length > 0
				? { languageOptions }
				: {}),
			rules: rule ? rule : {},
		},
	];

	if (
		reportUnusedDisableDirectives ||
		reportUnusedDisableDirectivesSeverity !== void 0
	) {
		overrideConfig[0].linterOptions = {
			reportUnusedDisableDirectives: reportUnusedDisableDirectives
				? "error"
				: normalizeSeverityToString(
						/*
						 * The enclosing `if` guarantees the severity is defined
						 * whenever `reportUnusedDisableDirectives` is falsy.
						 */
						/** @type {string | number} */ (
							reportUnusedDisableDirectivesSeverity
						),
					),
		};
	}

	if (reportUnusedInlineConfigs !== void 0) {
		overrideConfig[0].linterOptions = {
			...overrideConfig[0].linterOptions,
			reportUnusedInlineConfigs: normalizeSeverityToString(
				reportUnusedInlineConfigs,
			),
		};
	}

	if (plugin) {
		overrideConfig[0].plugins = await loadPlugins(importer, plugin);
	}

	if (ext) {
		overrideConfig.push({
			files: ext.map(
				extension =>
					`**/*${extension.startsWith(".") ? "" : "."}${extension}`,
			),
		});
	}

	/*
	 * For performance reasons rules not marked as 'error' are filtered out in quiet mode. As maxWarnings
	 * requires rules set to 'warn' to be run, we only filter out 'warn' rules if maxWarnings is not specified.
	 */
	const ruleFilter =
		quiet && maxWarnings === -1 ? quietRuleFilter : () => true;

	const options = {
		allowInlineConfig: inlineConfig,
		cache,
		cacheLocation: cacheLocation || cacheFile,
		cacheStrategy,
		concurrency,
		errorOnUnmatchedPattern,
		fix: (fix || fixDryRun) && (quiet ? quietFixPredicate : true),
		fixTypes: fixType,
		flags: flag,
		ignore,
		ignorePatterns: ignorePattern,
		overrideConfig,
		overrideConfigFile,
		passOnNoPatterns,
		ruleFilter,
		stats,
		warnIgnored,
	};

	return options;
}

module.exports = translateOptions;

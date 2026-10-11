// @ts-check
/**
 * @fileoverview Translates CLI options into ESLint constructor options.
 * @author Nicholas C. Zakas
 * @author Francesco Trotta
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { normalizeSeverityToString } = require("./severity");
const { getShorthandName, normalizePackageName } = require("./naming");
const { ModuleImporter } = require("@humanwhocodes/module-importer");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./types.js").LintMessage} LintMessage */
/** @typedef {import("./types.js").RuleConf} RuleConf */
/** @typedef {import("./types.js").SeverityConf} SeverityConf */

/**
 * The options as parsed from the command line by `lib/options.js`. Every
 * property is optional from the type system's point of view because optionator
 * only populates the flags that were actually passed, together with those that
 * declare a default.
 * @typedef {Object} CLIOptions
 * @property {boolean} [cache] Only check changed files.
 * @property {string} [cacheFile] The path to the cache file. Deprecated in favour of `cacheLocation`.
 * @property {string} [cacheLocation] The path to the cache file or directory.
 * @property {string} [cacheStrategy] How the cache detects changed files: `"metadata"` or `"content"`.
 * @property {number | string} [concurrency] The number of linting threads, `"auto"`, or `"off"`.
 * @property {string | boolean} [config] The path to a config file, or `false` when `--no-config` was passed.
 * @property {boolean} [configLookup] Whether to look up a config file relative to each linted file.
 * @property {boolean} [errorOnUnmatchedPattern] Whether an unmatched file pattern is an error.
 * @property {string[]} [ext] The additional file extensions to lint.
 * @property {boolean} [fix] Whether to write fixes to disk.
 * @property {boolean} [fixDryRun] Whether to compute fixes without writing them to disk.
 * @property {string[]} [fixType] The kinds of fix to apply.
 * @property {string[]} [flag] The feature flags to enable.
 * @property {string[]} [global] The global variables to define, each optionally suffixed with `":true"` to make it writable.
 * @property {boolean} [ignore] Whether to respect ignore patterns.
 * @property {string[]} [ignorePattern] The additional patterns of files to ignore.
 * @property {boolean} [inlineConfig] Whether to respect inline configuration comments.
 * @property {string} [parser] The name of, or path to, the parser to use.
 * @property {Record<string, unknown>} [parserOptions] The parser options to use.
 * @property {string[]} [plugin] The plugins to load, with or without the `"eslint-plugin-"` prefix.
 * @property {boolean} [quiet] Whether to report errors only.
 * @property {boolean} [reportUnusedDisableDirectives] Whether to report unused disable directives as errors.
 * @property {SeverityConf} [reportUnusedDisableDirectivesSeverity] The severity at which to report unused disable directives.
 * @property {SeverityConf} [reportUnusedInlineConfigs] The severity at which to report unused inline configs.
 * @property {Record<string, RuleConf>} [rule] The rules to run, on top of the config's.
 * @property {boolean} [stats] Whether to collect performance statistics.
 * @property {boolean} [warnIgnored] Whether to warn about explicitly passed but ignored files.
 * @property {boolean} [passOnNoPatterns] Whether to exit successfully when no file patterns are passed.
 * @property {number} [maxWarnings] The number of warnings that triggers a nonzero exit code, or `-1` for no limit.
 */

/**
 * A config object synthesized from the CLI flags and applied on top of the
 * user's config. The properties are all optional because each is only added
 * when the corresponding flag was passed.
 * @typedef {Object} CLIOverrideConfig
 * @property {string[]} [files] The file patterns this entry applies to.
 * @property {Record<string, unknown>} [languageOptions] Language options from `--global`, `--parser-options` and `--parser`.
 * @property {Record<string, RuleConf>} [rules] Rules from `--rule`.
 * @property {Record<string, unknown>} [linterOptions] Linter options from the `--report-unused-*` flags.
 * @property {Record<string, unknown>} [plugins] Plugins loaded from `--plugin`.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Loads plugins with the specified names.
 * @param {import("@humanwhocodes/module-importer").ModuleImporter} importer An object with an `import` method called once for each plugin.
 * @param {string[]} pluginNames The names of the plugins to be loaded, with or without the "eslint-plugin-" prefix.
 * @throws If a plugin module has no `default` export.
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
 * @returns {Promise<Record<string, unknown>>} The options object for the ESLint constructor.
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
	const importer = new ModuleImporter();

	/** @type {string | boolean | undefined} */
	let overrideConfigFile =
		typeof config === "string" ? config : !configLookup;
	if (overrideConfigFile === false) {
		overrideConfigFile = void 0;
	}

	/** @type {Record<string, unknown>} */
	const languageOptions = {};

	if (global) {
		languageOptions.globals = global.reduce(
			(/** @type {Record<string, string>} */ obj, name) => {
				if (name.endsWith(":true")) {
					obj[name.slice(0, -5)] = "writable";
				} else {
					obj[name] = "readonly";
				}
				return obj;
			},
			{},
		);
	}

	if (parserOptions) {
		languageOptions.parserOptions = parserOptions;
	}

	if (parser) {
		languageOptions.parser = await importer.import(parser);
	}

	/** @type {CLIOverrideConfig[]} */
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
		/*
		 * Reaching the `else` branch below means `reportUnusedDisableDirectives`
		 * is falsy, so the `||` above can only have been satisfied by the
		 * severity being passed. No narrowing can carry that from the guard
		 * into the ternary, so it is asserted here instead.
		 */
		const directivesSeverity = /** @type {SeverityConf} */ (
			reportUnusedDisableDirectivesSeverity
		);

		overrideConfig[0].linterOptions = {
			reportUnusedDisableDirectives: reportUnusedDisableDirectives
				? "error"
				: normalizeSeverityToString(directivesSeverity),
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

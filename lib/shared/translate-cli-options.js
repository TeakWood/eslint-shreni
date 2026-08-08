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

/**
 * @import { LintMessage, ParserOptions, Parser, Plugin, RulesRecord, Severity, SeverityLevel, GlobalsRecord, LanguageOptions, ConfigObject } from "../types/core.js"
 */

/**
 * The CLI options this module reads, as `optionator` hands them over.
 *
 * Grounding: every member below is one of the option definitions in
 * `lib/options.js`, and the types follow the `type:` and `default:` recorded
 * there — an option with no default is absent when it was not passed, which is
 * why so many are optional. Only the options destructured below are declared;
 * `optionator` produces others (`--stdin`, `--format`, …) that the CLI consumes
 * itself and never forwards here.
 * @typedef {Object} TranslatableCLIOptions
 * @property {boolean} cache Whether to use a lint result cache.
 * @property {string} cacheFile Legacy cache path, superseded by `cacheLocation`.
 * @property {string} [cacheLocation] Where to write the cache.
 * @property {string} cacheStrategy How the cache detects changed files.
 * @property {number|string} concurrency Worker count, `"auto"` or `"off"`.
 * @property {string} [config] Path to a config file, if `--config` was passed.
 * @property {boolean} configLookup Whether to search for a config file.
 * @property {boolean} errorOnUnmatchedPattern Whether an unmatched pattern is an error.
 * @property {string[]} [ext] Additional file extensions to lint.
 * @property {boolean} fix Whether to write fixes to disk.
 * @property {boolean} fixDryRun Whether to compute fixes without writing them.
 * @property {string[]} [fixType] Which kinds of fix to apply.
 * @property {string[]} [flag] Feature flags to enable.
 * @property {string[]} [global] Globals to define, each optionally suffixed `:true`.
 * @property {boolean} ignore Whether to respect ignore files and patterns.
 * @property {string[]} [ignorePattern] Extra patterns to ignore.
 * @property {boolean} inlineConfig Whether inline config comments are honoured.
 * @property {string} [parser] The parser to load.
 * @property {ParserOptions} [parserOptions] Options for the parser.
 * @property {string[]} [plugin] Plugins to load, with or without the name prefix.
 * @property {boolean} quiet Whether to report errors only.
 * @property {boolean} [reportUnusedDisableDirectives] Whether unused disable directives are errors.
 * @property {Severity} [reportUnusedDisableDirectivesSeverity] Severity for unused disable directives.
 * @property {Severity} [reportUnusedInlineConfigs] Severity for inline configs that change nothing.
 * @property {RulesRecord} [rule] Rules to add on top of the config.
 * @property {boolean} stats Whether to collect timing statistics.
 * @property {boolean} warnIgnored Whether to warn when an explicitly passed file is ignored.
 * @property {boolean} passOnNoPatterns Whether zero matched files is a success.
 * @property {number} maxWarnings Warning budget, or `-1` for unlimited.
 */

/**
 * Decides whether a rule runs, given its ID and configured severity.
 *
 * Grounding: called as `ruleFilter({ ruleId, severity })` at
 * `lib/linter/linter.js:478` and `lib/linter/apply-disable-directives.js:534`.
 * @typedef {(rule: { ruleId: string, severity: SeverityLevel }) => boolean} RuleFilter
 */

/**
 * The subset of the `ESLint` constructor's options that this module produces.
 *
 * Declared here rather than in `lib/types/core.js` on purpose: the full
 * constructor surface belongs with `lib/eslint/`, which is annotated in a later
 * phase. Move this there — do not duplicate it — when that lands.
 *
 * Grounding: `processOptions` in `lib/eslint/eslint-helpers.js:750-960`, which
 * is what receives this object.
 * @typedef {Object} ESLintTranslatedOptions
 * @property {boolean} allowInlineConfig Whether inline config comments are honoured.
 * @property {boolean} cache Whether to use a lint result cache.
 * @property {string} cacheLocation Where to write the cache.
 * @property {string} cacheStrategy How the cache detects changed files.
 * @property {number|string} concurrency Worker count, `"auto"` or `"off"`.
 * @property {boolean} errorOnUnmatchedPattern Whether an unmatched pattern is an error.
 * @property {boolean|((message: LintMessage) => boolean)} fix Whether, or which messages, to fix.
 * @property {string[]|undefined} fixTypes Which kinds of fix to apply.
 * @property {string[]|undefined} flags Feature flags to enable.
 * @property {boolean} ignore Whether to respect ignore files and patterns.
 * @property {string[]|undefined} ignorePatterns Extra patterns to ignore.
 * @property {ConfigObject[]} overrideConfig Config objects appended after the config file.
 * @property {string|boolean|undefined} overrideConfigFile A config path, `true` to skip lookup, or `undefined`.
 * @property {boolean} passOnNoPatterns Whether zero matched files is a success.
 * @property {RuleFilter} ruleFilter Decides which rules run.
 * @property {boolean} stats Whether to collect timing statistics.
 * @property {boolean} warnIgnored Whether to warn when an explicitly passed file is ignored.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Loads plugins with the specified names.
 * @param {ModuleImporter} importer An object with an `import` method called once for each plugin.
 * @param {string[]} pluginNames The names of the plugins to be loaded, with or without the "eslint-plugin-" prefix.
 * @returns {Promise<Record<string, Plugin>>} A mapping of plugin short names to implementations.
 */
async function loadPlugins(importer, pluginNames) {
	/** @type {Record<string, Plugin>} */
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

			/*
			 * A plugin's default export is whatever the package chose to
			 * export, so the importer hands it over as `unknown`. The guard
			 * above establishes only that the export exists; `Config` is what
			 * validates its shape, at the point the config is built.
			 */
			plugins[shortName] = /** @type {Plugin} */ (module.default);
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
 * @param {{ ruleId: string, severity: SeverityLevel }} rule The rule id and severity.
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
 * @param {TranslatableCLIOptions} cliOptions The CLI options to translate.
 * @returns {Promise<ESLintTranslatedOptions>} The options object for the ESLint constructor.
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

	/** @type {LanguageOptions} */
	const languageOptions = {};

	if (global) {
		languageOptions.globals = global.reduce((obj, name) => {
			if (name.endsWith(":true")) {
				obj[name.slice(0, -5)] = "writable";
			} else {
				obj[name] = "readonly";
			}
			return obj;
		}, /** @type {GlobalsRecord} */ ({}));
	}

	if (parserOptions) {
		languageOptions.parserOptions = parserOptions;
	}

	if (parser) {
		/*
		 * The importer returns a module namespace, so the parser's shape is
		 * only established when the language validates it
		 * (`lib/languages/js/validate-language-options.js`).
		 */
		languageOptions.parser = /** @type {Parser} */ (
			await importer.import(parser)
		);
	}

	/** @type {ConfigObject[]} */
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
				: /*
					 * The enclosing guard is an `||`, so reaching this branch
					 * means the boolean form was falsy and the severity form
					 * was therefore the one that was passed.
					 */
					normalizeSeverityToString(
						/** @type {Severity} */ (
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

// @ts-check
/**
 * @fileoverview Main Linter Class
 * @author Gyandeep Singh
 * @author aladdin-add
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const path = require("node:path"),
	eslintScope = require("eslint-scope"),
	evk = require("eslint-visitor-keys"),
	pkg = require("../../package.json"),
	Traverser = require("../shared/traverser"),
	{ SourceCode } = require("../languages/js/source-code"),
	applyDisableDirectives = require("./apply-disable-directives"),
	{ ConfigCommentParser } = require("@eslint/plugin-kit"),
	SourceCodeFixer = require("./source-code-fixer"),
	{ SourceCodeVisitor } = require("./source-code-visitor"),
	timing = require("./timing");
const { FlatConfigArray } = require("../config/flat-config-array");
const { startTime, endTime } = require("../shared/stats");
const { assertIsRuleSeverity } = require("../config/flat-config-schema");
const {
	normalizeSeverityToString,
	normalizeSeverityToNumber,
} = require("../shared/severity");
const { deepMergeArrays } = require("../shared/deep-merge-arrays");
const {
	activeFlags,
	inactiveFlags,
	getInactivityReasonMessage,
} = require("../shared/flags");
const debug = require("debug")("eslint:linter");
const MAX_AUTOFIX_PASSES = 10;
const DEFAULT_ECMA_VERSION = 5;
const commentParser = new ConfigCommentParser();
const { VFile } = require("./vfile");
const { ParserService } = require("../services/parser-service");
const { FileContext } = require("./file-context");
const { ProcessorService } = require("../services/processor-service");
const { containsDifferentProperty } = require("../shared/option-utils");
const { Config } = require("../config/config");
const { WarningService } = require("../services/warning-service");
const { SourceCodeTraverser } = require("./source-code-traverser");
const { FileReport, updateLocationInformation } = require("./file-report");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").ConfigObject} ConfigObject */
/** @typedef {import("../shared/types.js").LinterOptionsConfig} LinterOptionsConfig */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../shared/types.js").Processor} Processor */
/** @typedef {import("../shared/types.js").ReportedSeverity} ReportedSeverity */
/** @typedef {import("../shared/types.js").RuleConf} RuleConf */
/** @typedef {import("../shared/types.js").RuleListener} RuleListener */
/** @typedef {import("../shared/types.js").RuleModule} RuleModule */
/** @typedef {import("../shared/types.js").RulesConfig} RulesConfig */
/** @typedef {import("../shared/types.js").SeverityConf} SeverityConf */
/** @typedef {import("../shared/types.js").Stats} Stats */
/** @typedef {import("../shared/types.js").SuppressedLintMessage} SuppressedLintMessage */
/** @typedef {import("../shared/types.js").Times} Times */
/** @typedef {import("../config/config.js").ConfigWithCopiedKeys} ResolvedConfig */
/** @typedef {import("./esquery.js").ASTNode} ASTNode */
/** @typedef {import("./file-report.js").LocationLanguage} LocationLanguage */
/** @typedef {import("./file-report.js").Position} Position */
/** @typedef {import("./file-report.js").SourceRange} SourceRange */
/** @typedef {import("./source-code-traverser.js").TraversableLanguage} TraversableLanguage */
/** @typedef {import("./apply-disable-directives.js").Directive} Directive */
/** @typedef {import("@eslint/core").DirectiveType} DirectiveType */
/** @typedef {import("./file-report.js").LintingProblemDescriptor} LintingProblemDescriptor */

/**
 * A directive comment as a language's `getDisableDirectives()` reports it,
 * before `createDisableDirectives()` splits it into one `Directive` per rule.
 * @typedef {Object} DirectiveComment
 * @property {DirectiveType} type The kind of directive.
 * @property {string} value The text following the directive keyword.
 * @property {string} [justification] The justification written after `--`.
 * @property {ASTNode} node The comment node or token.
 */

/**
 * A language object as the linter reads it: what `lib/config/` registers, plus
 * how the language counts positions and what traversal needs. Each half is
 * declared by the module that consumes it, so this is their intersection
 * rather than a third copy.
 *
 * The position and traversal members are part of the language contract
 * `@eslint/core` defines, but `lib/shared/types.js`'s `Language` deliberately
 * declares only what `lib/config/` reads — settling the authoritative public
 * shape of a language is a design task of its own. Until then `config.language`
 * is widened to this once, where it enters the linter.
 * @typedef {import("../shared/types.js").Language & LocationLanguage & TraversableLanguage} LinterLanguage
 */

/**
 * The per-instance state the `Linter` keeps outside the instance itself, so
 * that none of it is observable on a `Linter` object.
 * @typedef {Object} InternalSlots
 * @property {string | undefined} cwd The current working directory. `undefined` only in a
 * browser build, where `process` is absent and `normalizeCwd()` has nothing to fall back to.
 * @property {string[]} flags The feature flags enabled for this instance.
 * @property {any} lastConfigArray The config array from the most recent `verify()`.
 * @property {any} lastSourceCode The source code object from the most recent parse, reused across fix passes.
 * @property {SuppressedLintMessage[]} lastSuppressedMessages The suppressed messages from the most recent `verify()`.
 * @property {import("../services/warning-service.js").WarningService} warningService The service that emits process warnings.
 * @property {MutableTimes} [times] The timings collected when the `stats` option is enabled.
 * @property {number} fixPasses The number of fix passes made so far.
 */

/**
 * One pass's timings as `storeTime()` accumulates them, keyed by phase: the
 * `"rules"` entry is a second level keyed by rule ID while `"parse"` and
 * `"fix"` are leaves, and each key is created empty and then added to. Left
 * open because a half-built pass does not match `TimePass`, which `getTimes()`
 * only promises once linting has finished.
 * @typedef {Record<string, any>} MutableTimePass
 */

/**
 * The timings as `storeTime()` accumulates them, one entry per fix pass.
 * @typedef {Object} MutableTimes
 * @property {MutableTimePass[]} passes The timings of each pass so far.
 */

/**
 * Which phase of a pass a timing belongs to.
 * @typedef {Object} TimeOptions
 * @property {"parse" | "rules" | "fix"} type The phase that was measured.
 * @property {string} [key] The rule ID, for a `"rules"` measurement.
 */

/**
 * The options `linter.verify()` accepts, after normalization.
 * @typedef {Object} VerifyOptions
 * @property {string} [filename] The filename to associate with the source code.
 * @property {boolean} [allowInlineConfig] `false` to ignore inline configuration comments.
 * @property {string | null} [warnInlineConfig] The config name to name in a warning about an ignored inline config.
 * @property {SeverityConf | boolean} [reportUnusedDisableDirectives] How to report an unused `eslint-disable` directive.
 * @property {SeverityConf} [reportUnusedInlineConfigs] How to report an unused inline config comment.
 * @property {boolean} [disableFixes] `true` to omit `fix` from reported problems.
 * @property {boolean} [stats] `true` to collect timing statistics.
 * @property {(descriptor: { ruleId: string, severity: number }) => boolean} [ruleFilter] A predicate selecting which rules to run.
 * @property {string} [physicalFilename] The path to the file on disk, when it differs from `filename`.
 * @property {Processor["preprocess"]} [preprocess] Splits the file into lintable blocks.
 * @property {Processor["postprocess"]} [postprocess] Maps each block's messages back onto the file.
 * @property {(blockFilename: string, blockText: string | Uint8Array) => boolean} [filterCodeBlock] Selects which blocks to lint.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Wraps the value in an Array if it isn't already one.
 * @param {any} value Value to be wrapped.
 * @returns {any[]} The value as an array.
 */
function asArray(value) {
	return Array.isArray(value) ? value : [value];
}

/**
 * Pushes a problem to inlineConfigProblems if ruleOptions are redundant.
 * @param {ResolvedConfig} config Provided config.
 * @param {SourceRange} loc A line/column location
 * @param {FileReport} report Report that may be added to.
 * @param {string} ruleId The rule ID.
 * @param {any[]} ruleOptions The rule options, merged with the config's.
 * @param {any[]} ruleOptionsInline The rule options from the comment.
 * @param {SeverityConf} severity The severity to report.
 * @returns {void}
 */
function addProblemIfSameSeverityAndOptions(
	config,
	loc,
	report,
	ruleId,
	ruleOptions,
	ruleOptionsInline,
	severity,
) {
	const existingConfigRaw = config.rules?.[ruleId];
	const existingConfig = existingConfigRaw
		? asArray(existingConfigRaw)
		: ["off"];
	const existingSeverity = normalizeSeverityToString(existingConfig[0]);
	const inlineSeverity = normalizeSeverityToString(ruleOptions[0]);
	const sameSeverity = existingSeverity === inlineSeverity;

	if (!sameSeverity) {
		return;
	}

	const alreadyConfigured = existingConfigRaw
		? `is already configured to '${existingSeverity}'`
		: "is not enabled so can't be turned off";
	let message;

	if (
		(existingConfig.length === 1 && ruleOptions.length === 1) ||
		existingSeverity === "off"
	) {
		message = `Unused inline config ('${ruleId}' ${alreadyConfigured}).`;
	} else if (
		!containsDifferentProperty(
			ruleOptions.slice(1),
			existingConfig.slice(1),
		)
	) {
		message =
			ruleOptionsInline.length === 1
				? `Unused inline config ('${ruleId}' ${alreadyConfigured}).`
				: `Unused inline config ('${ruleId}' ${alreadyConfigured} with the same options).`;
	}

	if (message) {
		const numericSeverity = normalizeSeverityToNumber(severity);
		const descriptor = {
			message,
			loc,
		};

		if (numericSeverity === 1) {
			report.addWarning(descriptor);
		} else if (numericSeverity === 2) {
			report.addError(descriptor);
		}
	}
}

/**
 * Creates a collection of disable directives from a comment
 * @param {object} options to create disable directives
 * @param {DirectiveType} options.type The type of directive comment
 * @param {string} options.value The value after the directive in the comment. An empty value means the
 * comment specified no specific rules, so it applies to all rules (e.g. `eslint-disable`)
 * @param {string} [options.justification] The justification of the directive
 * @param {ASTNode} options.node The Comment node/token.
 * @param {(ruleId: string) => RuleModule | undefined} ruleMapper A map from rule IDs to defined rules
 * @param {LocationLanguage} language The language to use to adjust the location information.
 * @param {any} sourceCode The SourceCode object to get comments from.
 * @param {FileReport} report The report to add problems to.
 * @returns {Directive[]} Directives from the comment
 */
function createDisableDirectives(
	{ type, value, justification, node },
	ruleMapper,
	language,
	sourceCode,
	report,
) {
	const ruleIds = Object.keys(commentParser.parseListConfig(value));
	/** @type {(string | null)[]} */
	const directiveRules = ruleIds.length ? ruleIds : [null];

	/** @type {Directive[]} */
	const directives = []; // valid disable directives
	const parentDirective = { node, value, ruleIds };

	for (const ruleId of directiveRules) {
		const loc = sourceCode.getLoc(node);

		// push to directives, if the rule is defined(including null, e.g. /*eslint enable*/)
		if (ruleId === null || !!ruleMapper(ruleId)) {
			if (type === "disable-next-line") {
				const { line, column } = updateLocationInformation(
					loc.end,
					language,
				);

				directives.push({
					parentDirective,
					type,
					line,
					column,
					ruleId,
					justification,
				});
			} else {
				const { line, column } = updateLocationInformation(
					loc.start,
					language,
				);

				directives.push({
					parentDirective,
					type,
					line,
					column,
					ruleId,
					justification,
				});
			}
		} else {
			report.addError({ ruleId, loc });
		}
	}

	return directives;
}

/**
 * Parses comments in file to extract disable directives.
 * @param {any} sourceCode The SourceCode object to get comments from.
 * @param {(ruleId: string) => RuleModule | undefined} ruleMapper A map from rule IDs to defined rules
 * @param {LocationLanguage} language The language to use to adjust the location information
 * @param {FileReport} report The report to add problems to.
 * @returns {Directive[]}
 * A collection of the directive comments that were found, along with any problems that occurred when parsing
 */
function getDirectiveCommentsForFlatConfig(
	sourceCode,
	ruleMapper,
	language,
	report,
) {
	/** @type {Directive[]} */
	const disableDirectives = [];

	if (sourceCode.getDisableDirectives) {
		const { directives: directivesSources, problems: directivesProblems } =
			sourceCode.getDisableDirectives();

		if (Array.isArray(directivesProblems)) {
			directivesProblems.forEach(problem => report.addError(problem));
		}

		directivesSources.forEach(
			(/** @type {DirectiveComment} */ directive) => {
				const directives = createDisableDirectives(
					directive,
					ruleMapper,
					language,
					sourceCode,
					report,
				);

				disableDirectives.push(...directives);
			},
		);
	}

	return disableDirectives;
}

/**
 * Convert "/path/to/<text>" to "<text>".
 * `CLIEngine#executeOnText()` method gives "/path/to/<text>" if the filename
 * was omitted because `configArray.extractConfig()` requires an absolute path.
 * But the linter should pass `<text>` to `RuleContext#filename` in that
 * case.
 * Also, code blocks can have their virtual filename. If the parent filename was
 * `<text>`, the virtual filename is `<text>/0_foo.js` or something like (i.e.,
 * it's not an absolute path).
 * @param {string} filename The filename to normalize.
 * @returns {string} The normalized filename.
 */
function normalizeFilename(filename) {
	const parts = filename.split(path.sep);
	const index = parts.lastIndexOf("<text>");

	return index === -1 ? filename : parts.slice(index).join(path.sep);
}

/**
 * Normalizes the possible options for `linter.verify` and `linter.verifyAndFix` to a
 * consistent shape.
 * @param {VerifyOptions} providedOptions Options
 * @param {ResolvedConfig} config Config.
 * @returns {VerifyOptions & { filename: string, reportUnusedDisableDirectives: "off" | "warn" | "error", reportUnusedInlineConfigs: "off" | "warn" | "error" }} Normalized options
 */
function normalizeVerifyOptions(providedOptions, config) {
	/*
	 * A config may carry the linter options at its top level rather than under
	 * `linterOptions`, so the fallback is the config itself.
	 */
	const linterOptions = /** @type {LinterOptionsConfig} */ (
		config.linterOptions || config
	);
	const disableInlineConfig = linterOptions.noInlineConfig === true;
	const ignoreInlineConfig = providedOptions.allowInlineConfig === false;

	/*
	 * `FlatConfigArray` attaches this to the resolved config so that a warning
	 * can name the config object that set `noInlineConfig`. It is internal, so
	 * `ConfigObject` does not declare it.
	 */
	const { configNameOfNoInlineConfig: noInlineConfigName } =
		/** @type {{ configNameOfNoInlineConfig?: string }} */ (config);
	const configNameOfNoInlineConfig = noInlineConfigName
		? ` (${noInlineConfigName})`
		: "";

	let reportUnusedDisableDirectives =
		providedOptions.reportUnusedDisableDirectives;

	if (typeof reportUnusedDisableDirectives === "boolean") {
		reportUnusedDisableDirectives = reportUnusedDisableDirectives
			? "error"
			: "off";
	}
	if (typeof reportUnusedDisableDirectives !== "string") {
		if (typeof linterOptions.reportUnusedDisableDirectives === "boolean") {
			reportUnusedDisableDirectives =
				linterOptions.reportUnusedDisableDirectives ? "warn" : "off";
		} else {
			reportUnusedDisableDirectives =
				linterOptions.reportUnusedDisableDirectives === void 0
					? "off"
					: normalizeSeverityToString(
							linterOptions.reportUnusedDisableDirectives,
						);
		}
	}

	const reportUnusedInlineConfigs =
		linterOptions.reportUnusedInlineConfigs === void 0
			? "off"
			: normalizeSeverityToString(
					linterOptions.reportUnusedInlineConfigs,
				);

	let ruleFilter = providedOptions.ruleFilter;

	if (typeof ruleFilter !== "function") {
		ruleFilter = () => true;
	}

	return {
		filename: normalizeFilename(providedOptions.filename || "<input>"),
		allowInlineConfig: !ignoreInlineConfig,
		warnInlineConfig:
			disableInlineConfig && !ignoreInlineConfig
				? `your config${configNameOfNoInlineConfig}`
				: null,
		reportUnusedDisableDirectives,
		reportUnusedInlineConfigs,
		disableFixes: Boolean(providedOptions.disableFixes),
		stats: providedOptions.stats,
		ruleFilter,
	};
}

/**
 * Store time measurements in map
 * @param {number} time Time measurement
 * @param {TimeOptions} timeOpts Options relating which time was measured
 * @param {InternalSlots} slots Linter internal slots map
 * @returns {void}
 */
function storeTime(time, timeOpts, slots) {
	const { type, key } = timeOpts;

	if (!slots.times) {
		slots.times = { passes: [{}] };
	}

	const passIndex = slots.fixPasses;

	if (passIndex > slots.times.passes.length - 1) {
		slots.times.passes.push({});
	}

	if (key) {
		slots.times.passes[passIndex][type] ??= {};
		slots.times.passes[passIndex][type][key] ??= { total: 0 };
		slots.times.passes[passIndex][type][key].total += time;
	} else {
		slots.times.passes[passIndex][type] ??= { total: 0 };
		slots.times.passes[passIndex][type].total += time;
	}
}

/**
 * Get the options for a rule (not including severity), if any
 * @param {RuleConf} ruleConfig rule configuration
 * @param {any[]} [defaultOptions] rule.meta.defaultOptions
 * @returns {any[]} of rule options, empty Array if none
 */
function getRuleOptions(ruleConfig, defaultOptions) {
	if (Array.isArray(ruleConfig)) {
		return deepMergeArrays(defaultOptions, ruleConfig.slice(1));
	}
	return defaultOptions ?? [];
}

/**
 * Analyze scope of the given AST.
 * @param {any} ast The `Program` node to analyze.
 * @param {Record<string, any>} languageOptions The language options.
 * @param {Record<string, readonly string[]>} [visitorKeys] The visitor keys.
 * @returns {import("eslint-scope").ScopeManager} The analysis result.
 */
function analyzeScope(ast, languageOptions, visitorKeys) {
	const parserOptions = languageOptions.parserOptions;
	const ecmaFeatures = parserOptions.ecmaFeatures || {};
	const ecmaVersion = languageOptions.ecmaVersion || DEFAULT_ECMA_VERSION;

	return eslintScope.analyze(ast, {
		ignoreEval: true,
		nodejsScope: ecmaFeatures.globalReturn,
		impliedStrict: ecmaFeatures.impliedStrict,
		ecmaVersion: typeof ecmaVersion === "number" ? ecmaVersion : 6,
		sourceType: languageOptions.sourceType || "script",
		childVisitorKeys: visitorKeys || evk.KEYS,
		/*
		 * `eslint-scope` declares `fallback` as returning a mutable
		 * `string[]`, which `Traverser.getKeys()` does not satisfy. The
		 * analyzer only iterates the result.
		 */
		fallback: /** @type {(node: any) => string[]} */ (Traverser.getKeys),
		jsx: ecmaFeatures.jsx,
	});
}

/**
 * Runs a rule, and gets its listeners
 * @param {RuleModule} rule A rule object
 * @param {any} ruleContext The context that should be passed to the rule
 * @throws {TypeError} If `rule` is not an object with a `create` method
 * @throws {Error} Any error during the rule's `create`
 * @returns {RuleListener} A map of selector listeners provided by the rule
 */
function createRuleListeners(rule, ruleContext) {
	if (
		!rule ||
		typeof rule !== "object" ||
		typeof rule.create !== "function"
	) {
		throw new TypeError(
			`Error while loading rule '${ruleContext.id}': Rule must be an object with a \`create\` method`,
		);
	}

	try {
		return rule.create(ruleContext);
	} catch (ex) {
		/*
		 * A rule's `create()` can throw anything. Prefixing the message is
		 * best-effort; the original binding is the one rethrown.
		 */
		const loadError = /** @type {{ message?: string }} */ (ex);

		loadError.message = `Error while loading rule '${ruleContext.id}': ${loadError.message}`;
		throw ex;
	}
}

/**
 * Runs the given rules on the given SourceCode object
 * @param {any} sourceCode A SourceCode object for the given text
 * @param {Record<string, RuleConf>} configuredRules The rules configuration
 * @param {(ruleId: string) => RuleModule | undefined} ruleMapper A mapper function from rule names to rules
 * @param {LinterLanguage} language The language object used for parsing.
 * @param {Record<string, any>} languageOptions The options for parsing the code.
 * @param {Record<string, any>} settings The settings that were enabled in the config
 * @param {string} filename The reported filename of the code
 * @param {boolean} applyDefaultOptions If true, apply rules' meta.defaultOptions in computing their config options.
 * @param {string} cwd cwd of the cli
 * @param {string | undefined} physicalFilename The full path of the file on disk without any code block information
 * @param {((descriptor: { ruleId: string, severity: number }) => boolean) | undefined} ruleFilter A predicate function to filter which rules should be executed.
 * @param {boolean | undefined} stats If true, stats are collected appended to the result
 * @param {InternalSlots} slots InternalSlotsMap of linter
 * @param {FileReport} report The report to add problems to
 * @returns {FileReport} report The report with added problems
 * @throws {Error} If traversal into a node fails.
 */
function runRules(
	sourceCode,
	configuredRules,
	ruleMapper,
	language,
	languageOptions,
	settings,
	filename,
	applyDefaultOptions,
	cwd,
	physicalFilename,
	ruleFilter,
	stats,
	slots,
	report,
) {
	const visitor = new SourceCodeVisitor();

	/*
	 * Create a frozen object with the ruleContext properties and methods that are shared by all rules.
	 * All rule contexts will inherit from this object. This avoids the performance penalty of copying all the
	 * properties once for each rule.
	 */
	const fileContext = new FileContext({
		cwd,
		filename,
		physicalFilename: physicalFilename || filename,
		sourceCode,
		languageOptions,
		settings,
	});

	const steps = sourceCode.traverse();

	Object.keys(configuredRules).forEach(ruleId => {
		const severity = Config.getRuleNumericSeverity(configuredRules[ruleId]);

		// not load disabled rules
		if (severity === 0) {
			return;
		}

		if (ruleFilter && !ruleFilter({ ruleId, severity })) {
			return;
		}

		const rule = ruleMapper(ruleId);

		if (!rule) {
			report.addError({ ruleId });
			return;
		}

		const ruleContext = fileContext.extend({
			id: ruleId,
			options: getRuleOptions(
				configuredRules[ruleId],
				applyDefaultOptions ? rule.meta?.defaultOptions : void 0,
			),
			/**
			 * Reports a problem found by this rule.
			 * @param {...any} args The report descriptor, in any of the
			 * supported argument forms.
			 * @returns {void}
			 * @throws {Error} If the rule reports a fix or a suggestion
			 * without declaring it in `meta`.
			 */
			report(...args) {
				const problem = report.addRuleMessage(
					ruleId,
					severity,
					...args,
				);

				if (problem.fix && !(rule.meta && rule.meta.fixable)) {
					throw new Error(
						'Fixable rules must set the `meta.fixable` property to "code" or "whitespace".',
					);
				}

				if (
					problem.suggestions &&
					!(rule.meta && rule.meta.hasSuggestions === true)
				) {
					/*
					 * `meta.docs.suggestion` is the property name this was
					 * renamed from, read only to produce a migration error, so
					 * it is deliberately absent from `RuleMetaDocs`.
					 */
					const legacyDocs =
						/** @type {{ suggestion?: unknown } | undefined} */ (
							rule.meta?.docs
						);

					if (
						rule.meta &&
						legacyDocs &&
						typeof legacyDocs.suggestion !== "undefined"
					) {
						// Encourage migration from the former property name.
						throw new Error(
							"Rules with suggestions must set the `meta.hasSuggestions` property to `true`. `meta.docs.suggestion` is ignored by ESLint.",
						);
					}
					throw new Error(
						"Rules with suggestions must set the `meta.hasSuggestions` property to `true`.",
					);
				}
			},
		});

		const ruleListenersReturn =
			timing.enabled || stats
				? timing.time(
						ruleId,
						createRuleListeners,
						stats,
					)(rule, ruleContext)
				: createRuleListeners(rule, ruleContext);

		const ruleListeners = stats
			? ruleListenersReturn.result
			: ruleListenersReturn;

		if (stats) {
			storeTime(
				ruleListenersReturn.tdiff,
				{ type: "rules", key: ruleId },
				slots,
			);
		}

		/**
		 * Include `ruleId` in error logs
		 * @param {(...args: any[]) => any} ruleListener A rule method that listens for a node.
		 * @returns {(...args: any[]) => any} ruleListener wrapped in error handler
		 */
		function addRuleErrorHandler(ruleListener) {
			return function ruleErrorHandler(...listenerArgs) {
				try {
					const ruleListenerReturn = ruleListener(...listenerArgs);

					const ruleListenerResult = stats
						? ruleListenerReturn.result
						: ruleListenerReturn;

					if (stats) {
						storeTime(
							ruleListenerReturn.tdiff,
							{ type: "rules", key: ruleId },
							slots,
						);
					}

					return ruleListenerResult;
				} catch (e) {
					/*
					 * A rule listener can throw anything. Tagging it with the
					 * rule ID is what lets `verify()` name the rule in the
					 * message; the original binding is the one rethrown.
					 */
					/** @type {{ ruleId?: string }} */ (e).ruleId = ruleId;
					throw e;
				}
			};
		}

		if (typeof ruleListeners === "undefined" || ruleListeners === null) {
			throw new Error(
				`The create() function for rule '${ruleId}' did not return an object.`,
			);
		}

		// add all the selectors from the rule as listeners
		Object.keys(ruleListeners).forEach(selector => {
			const ruleListener =
				timing.enabled || stats
					? timing.time(ruleId, ruleListeners[selector], stats)
					: ruleListeners[selector];

			visitor.add(selector, addRuleErrorHandler(ruleListener));
		});
	});

	const traverser = SourceCodeTraverser.getInstance(language);

	traverser.traverseSync(sourceCode, visitor, { steps });

	return report;
}

/**
 * Ensure the source code to be a string.
 * @param {string | { hasBOM?: boolean, text: string }} textOrSourceCode The text or source code object.
 * @returns {string} The source code text.
 */
function ensureText(textOrSourceCode) {
	if (typeof textOrSourceCode === "object") {
		const { hasBOM, text } = textOrSourceCode;
		const bom = hasBOM ? "\uFEFF" : "";

		return bom + text;
	}

	return String(textOrSourceCode);
}

/**
 * Normalize the value of the cwd
 * @param {string} [cwd] raw value of the cwd, path to a directory that should be considered as the current working directory, can be undefined.
 * @returns {string | undefined} normalized cwd
 */
function normalizeCwd(cwd) {
	if (cwd) {
		return cwd;
	}
	if (typeof process === "object") {
		return process.cwd();
	}

	// It's more explicit to assign the undefined
	// eslint-disable-next-line no-undefined -- Consistently returning a value
	return undefined;
}

/**
 * The map to store private data.
 * @type {WeakMap<Linter, InternalSlots>}
 */
const internalSlotsMap = new WeakMap();

/**
 * Reads a linter instance's private state.
 * @param {Linter} linter The instance to read the state of.
 * @returns {InternalSlots} The instance's private state.
 */
function getInternalSlots(linter) {
	/*
	 * The constructor populates the map for every instance, so the lookup
	 * cannot miss — which `WeakMap#get`'s type cannot express.
	 */
	return /** @type {InternalSlots} */ (internalSlotsMap.get(linter));
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Object that is responsible for verifying JavaScript text
 * @name Linter
 */
class Linter {
	/**
	 * Initialize the Linter.
	 * @param {object} [config] the config object
	 * @param {string} [config.cwd] path to a directory that should be considered as the current working directory, can be undefined.
	 * @param {string[]} [config.flags] the feature flags to enable.
	 * @param {string} [config.configType="flat"] the type of config used. Retrained for backwards compatibility, will be removed in future.
	 * @param {WarningService} [config.warningService] The warning service to use.
	 * @throws {TypeError} If `configType` is anything but `"flat"`.
	 * @throws {Error} If a flag is unknown, or inactive with no replacement.
	 */
	constructor({
		cwd,
		configType = "flat",
		flags = [],
		warningService = new WarningService(),
	} = {}) {
		/** @type {string[]} */
		const processedFlags = [];

		if (configType !== "flat") {
			throw new TypeError(
				`The 'configType' option value must be 'flat'. The value '${configType}' is not supported.`,
			);
		}

		flags.forEach(flag => {
			if (inactiveFlags.has(flag)) {
				// Guarded by `has()`, which `Map#get`'s type cannot express.
				const inactiveFlagData =
					/** @type {NonNullable<ReturnType<typeof inactiveFlags.get>>} */ (
						inactiveFlags.get(flag)
					);
				const inactivityReason =
					getInactivityReasonMessage(inactiveFlagData);
				const message = `The flag '${flag}' is inactive: ${inactivityReason}`;

				if (typeof inactiveFlagData.replacedBy === "undefined") {
					throw new Error(message);
				}

				// if there's a replacement, enable it instead of original
				if (typeof inactiveFlagData.replacedBy === "string") {
					processedFlags.push(inactiveFlagData.replacedBy);
				}

				warningService.emitInactiveFlagWarning(flag, message);

				return;
			}

			if (!activeFlags.has(flag)) {
				throw new Error(`Unknown flag '${flag}'.`);
			}

			processedFlags.push(flag);
		});

		internalSlotsMap.set(this, {
			cwd: normalizeCwd(cwd),
			flags: processedFlags,
			/*
			 * `storeTime()` indexes `times.passes` by this, so it has to be a
			 * number from the start. `verifyAndFix()` resets it per run, but
			 * `verify({ stats: true })` on a fresh instance never went through
			 * there and used to index the array with `undefined`.
			 */
			fixPasses: 0,
			lastConfigArray: null,
			lastSourceCode: null,
			lastSuppressedMessages: [],
			warningService,
		});

		this.version = pkg.version;
	}

	/**
	 * Getter for package version.
	 * @static
	 * @returns {string} The version from package.json.
	 */
	static get version() {
		return pkg.version;
	}

	/**
	 * Indicates if the given feature flag is enabled for this instance.
	 * @param {string} flag The feature flag to check.
	 * @returns {boolean} `true` if the feature flag is enabled, `false` if not.
	 */
	hasFlag(flag) {
		return getInternalSlots(this).flags.includes(flag);
	}

	/**
	 * Verifies the text against the rules specified by the second argument.
	 * @param {string | any} textOrSourceCode The text to parse or a SourceCode object.
	 * @param {ConfigObject | ConfigObject[] | any} config The ESLint config object or array to use.
	 * @param {string | VerifyOptions} [filenameOrOptions] The optional filename of the file being checked.
	 *      If this is not set, the filename will default to '<input>' in the rule context. If
	 *      an object, then it has "filename", "allowInlineConfig", and some properties.
	 * @returns {LintMessage[]} The results as an array of messages or an empty array if no messages.
	 */
	verify(textOrSourceCode, config, filenameOrOptions) {
		debug("Verify");

		const { cwd } = getInternalSlots(this);

		const options =
			typeof filenameOrOptions === "string"
				? { filename: filenameOrOptions }
				: filenameOrOptions || {};

		const configToUse = config ?? {};

		/*
		 * Because of how Webpack packages up the files, we can't
		 * compare directly to `FlatConfigArray` using `instanceof`
		 * because it's not the same `FlatConfigArray` as in the tests.
		 * So, we work around it by assuming an array is, in fact, a
		 * `FlatConfigArray` if it has a `getConfig()` method.
		 */
		let configArray = configToUse;

		if (
			!Array.isArray(configToUse) ||
			typeof (
				/** @type {{ getConfig?: unknown }} */ (configToUse).getConfig
			) !== "function"
		) {
			configArray = new FlatConfigArray(configToUse, {
				basePath: cwd,
			});
			configArray.normalizeSync();
		}

		return this._distinguishSuppressedMessages(
			this._verifyWithFlatConfigArray(
				textOrSourceCode,
				configArray,
				options,
				true,
			),
		);
	}

	/**
	 * Verify with a processor.
	 * @param {string | any} textOrSourceCode The source code.
	 * @param {any} config The config array.
	 * @param {VerifyOptions} options The options.
	 * @param {any} [configForRecursive] The `ConfigArray` object to apply multiple processors recursively.
	 * @returns {LintMessage[]} The found problems.
	 */
	_verifyWithFlatConfigArrayAndProcessor(
		textOrSourceCode,
		config,
		options,
		configForRecursive,
	) {
		const slots = getInternalSlots(this);
		const filename = options.filename || "<input>";
		const filenameToExpose = normalizeFilename(filename);
		const physicalFilename = options.physicalFilename || filenameToExpose;
		const text = ensureText(textOrSourceCode);
		const file = new VFile(filenameToExpose, text, {
			physicalPath: physicalFilename,
		});

		const preprocess = options.preprocess || (rawText => [rawText]);
		const postprocess =
			options.postprocess || (messagesList => messagesList.flat());

		const processorService = new ProcessorService();
		const preprocessResult = processorService.preprocessSync(file, {
			processor: {
				preprocess,
				postprocess,
			},
		});

		if (!preprocessResult.ok) {
			return /** @type {LintMessage[]} */ (preprocessResult.errors);
		}

		const filterCodeBlock =
			options.filterCodeBlock ||
			(blockFilename => blockFilename.endsWith(".js"));
		const originalExtname = path.extname(filename);
		const { files } = preprocessResult;

		const messageLists = files.map(
			(/** @type {string | VFile} */ block) => {
				/*
				 * A processor may hand back a bare string instead of a block, the
				 * legacy form the branch below keeps working. Reading `path` off
				 * one gave `undefined`, so the log line is unchanged.
				 */
				debug(
					"A code block was found: %o",
					(typeof block === "string" ? "" : block.path) ||
						"(unnamed)",
				);

				// Keep the legacy behavior.
				if (typeof block === "string") {
					return this._verifyWithFlatConfigArrayAndWithoutProcessors(
						block,
						config,
						options,
					);
				}

				// Skip this block if filtered.
				if (!filterCodeBlock(block.path, block.body)) {
					debug("This code block was skipped.");
					return [];
				}

				// Resolve configuration again if the file content or extension was changed.
				if (
					configForRecursive &&
					(text !== block.rawBody ||
						path.extname(block.path) !== originalExtname)
				) {
					debug(
						"Resolving configuration again because the file content or extension was changed.",
					);
					return this._verifyWithFlatConfigArray(
						block.rawBody,
						configForRecursive,
						{
							...options,
							filename: block.path,
							physicalFilename: block.physicalPath,
						},
					);
				}

				slots.lastSourceCode = null;

				// Does lint.
				return this.#flatVerifyWithoutProcessors(block, config, {
					...options,
					filename: block.path,
					physicalFilename: block.physicalPath,
				});
			},
		);

		return processorService.postprocessSync(file, messageLists, {
			processor: {
				preprocess,
				postprocess,
			},
		});
	}

	/**
	 * Verify using flat config and without any processors.
	 * @param {VFile} file The file to lint.
	 * @param {ResolvedConfig} providedConfig An ESLintConfig instance to configure everything.
	 * @param {VerifyOptions} providedOptions The optional filename of the file being checked.
	 * @throws {Error} If during rule execution.
	 * @returns {LintMessage[]} The results as an array of messages or an empty array if no messages.
	 */
	#flatVerifyWithoutProcessors(file, providedConfig, providedOptions) {
		const slots = getInternalSlots(this);
		const config = providedConfig || {};
		const { settings = {}, languageOptions } = config;
		const options = normalizeVerifyOptions(providedOptions, config);

		if (!slots.lastSourceCode) {
			let t;

			if (options.stats) {
				t = startTime();
			}

			const parserService = new ParserService();
			const parseResult = parserService.parseSync(file, config);

			if (options.stats) {
				// `startTime()` ran under the same guard just above.
				const started = /** @type {[number, number]} */ (t);
				const time = endTime(started);

				storeTime(time, { type: "parse" }, slots);
			}

			if (!parseResult.ok) {
				return /** @type {LintMessage[]} */ (parseResult.errors);
			}

			slots.lastSourceCode = parseResult.sourceCode;
		} else {
			/*
			 * If the given source code object as the first argument does not have scopeManager, analyze the scope.
			 * This is for backward compatibility (SourceCode is frozen so it cannot rebind).
			 *
			 * We check explicitly for `null` to ensure that this is a JS-flavored language.
			 * For non-JS languages we don't want to do this.
			 *
			 * TODO: Remove this check when we stop exporting the `SourceCode` object.
			 */
			if (slots.lastSourceCode.scopeManager === null) {
				slots.lastSourceCode = new SourceCode({
					text: slots.lastSourceCode.text,
					ast: slots.lastSourceCode.ast,
					hasBOM: slots.lastSourceCode.hasBOM,
					parserServices: slots.lastSourceCode.parserServices,
					visitorKeys: slots.lastSourceCode.visitorKeys,
					scopeManager: analyzeScope(
						slots.lastSourceCode.ast,
						languageOptions,
					),
				});
			}
		}

		const sourceCode = slots.lastSourceCode;

		/*
		 * Widened once, here, where the resolved config enters the linter. See
		 * `LinterLanguage` for why the hub's `Language` stops short of the
		 * position and traversal members.
		 */
		const language = /** @type {LinterLanguage} */ (config.language);
		const report = new FileReport({
			ruleMapper: ruleId => config.getRuleDefinition(ruleId),
			language,
			sourceCode,
			disableFixes: options.disableFixes,
		});

		/*
		 * Make adjustments based on the language options. For JavaScript,
		 * this is primarily about adding variables into the global scope
		 * to account for ecmaVersion and configured globals.
		 */
		sourceCode.applyLanguageOptions?.(languageOptions);

		/** @type {{ rules: Record<string, any[]> }} */
		const mergedInlineConfig = {
			rules: {},
		};

		/*
		 * Inline config can be either enabled or disabled. If disabled, it's possible
		 * to detect the inline config and emit a warning (though this is not required).
		 * So we first check to see if inline config is allowed at all, and if so, we
		 * need to check if it's a warning or not.
		 */
		if (options.allowInlineConfig) {
			// if inline config should warn then add the warnings
			if (options.warnInlineConfig) {
				if (sourceCode.getInlineConfigNodes) {
					sourceCode
						.getInlineConfigNodes()
						.forEach((/** @type {ASTNode} */ node) => {
							const loc = sourceCode.getLoc(node);
							const range = sourceCode.getRange(node);

							report.addWarning({
								message: `'${sourceCode.text.slice(range[0], range[1])}' has no effect because you have 'noInlineConfig' setting in ${options.warnInlineConfig}.`,
								loc,
							});
						});
				}
			} else {
				const inlineConfigResult = sourceCode.applyInlineConfig?.();

				if (inlineConfigResult) {
					inlineConfigResult.problems.forEach(
						(/** @type {LintingProblemDescriptor} */ problem) => {
							report.addFatal(problem);
						},
					);

					for (const {
						config: inlineConfig,
						loc,
					} of inlineConfigResult.configs) {
						Object.keys(inlineConfig.rules).forEach(ruleId => {
							const rule = config.getRuleDefinition(ruleId);
							const ruleValue = inlineConfig.rules[ruleId];

							if (!rule) {
								report.addError({
									ruleId,
									loc,
								});
								return;
							}

							if (
								Object.hasOwn(mergedInlineConfig.rules, ruleId)
							) {
								report.addError({
									message: `Rule "${ruleId}" is already configured by another configuration comment in the preceding code. This configuration is ignored.`,
									loc,
								});
								return;
							}

							try {
								const ruleOptionsInline = asArray(ruleValue);
								let ruleOptions = ruleOptionsInline;

								assertIsRuleSeverity(ruleId, ruleOptions[0]);

								/*
								 * If the rule was already configured, inline rule configuration that
								 * only has severity should retain options from the config and just override the severity.
								 *
								 * Example:
								 *
								 *   {
								 *       rules: {
								 *           curly: ["error", "multi"]
								 *       }
								 *   }
								 *
								 *   /* eslint curly: ["warn"] * /
								 *
								 *   Results in:
								 *
								 *   curly: ["warn", "multi"]
								 */

								let shouldValidateOptions = true;

								if (
									/*
									 * If inline config for the rule has only severity
									 */
									ruleOptions.length === 1 &&
									/*
									 * And the rule was already configured
									 */
									config.rules &&
									Object.hasOwn(config.rules, ruleId)
								) {
									/*
									 * Then use severity from the inline config and options from the provided config
									 */
									/*
									 * A `RuleConf` may be a bare severity
									 * rather than an array, and `hasOwn()`
									 * above does not narrow which.
									 */
									const existingRuleConf = asArray(
										config.rules[ruleId],
									);

									ruleOptions = [
										ruleOptions[0], // severity from the inline config
										...existingRuleConf.slice(1), // options from the provided config
									];

									// if the rule was enabled, the options have already been validated
									if (existingRuleConf[0] > 0) {
										shouldValidateOptions = false;
									}
								} else {
									/**
									 * Since we know the user provided options, apply defaults on top of them
									 */
									const slicedOptions = ruleOptions.slice(1);
									const mergedOptions = deepMergeArrays(
										rule.meta?.defaultOptions,
										slicedOptions,
									);

									if (mergedOptions.length) {
										ruleOptions = [
											ruleOptions[0],
											...mergedOptions,
										];
									}
								}

								if (
									options.reportUnusedInlineConfigs !== "off"
								) {
									addProblemIfSameSeverityAndOptions(
										config,
										loc,
										report,
										ruleId,
										ruleOptions,
										ruleOptionsInline,
										options.reportUnusedInlineConfigs,
									);
								}

								if (shouldValidateOptions) {
									config.validateRulesConfig(
										/** @type {RulesConfig} */ ({
											[ruleId]: ruleOptions,
										}),
									);
								}

								mergedInlineConfig.rules[ruleId] = ruleOptions;
							} catch (err) {
								/*
								 * Config validation rejects an invalid inline
								 * config by throwing, and ESLint's convention
								 * tags those errors with a template name and
								 * data. The original binding stays the one
								 * rethrown below.
								 */
								const configError =
									/** @type {{ code?: string, message: string, messageTemplate?: string, messageData?: Record<string, any> }} */ (
										err
									);

								/*
								 * If the rule has invalid `meta.schema`, throw the error because
								 * this is not an invalid inline configuration but an invalid rule.
								 */
								if (
									configError.code ===
									"ESLINT_INVALID_RULE_OPTIONS_SCHEMA"
								) {
									throw err;
								}

								/*
								 * If the rule does not support the current language, report a
								 * specific, actionable error message.
								 */
								if (
									configError.messageTemplate ===
									"rule-unsupported-language"
								) {
									report.addError({
										ruleId,
										/*
										 * `messageData` is set together with
										 * the template that selected this
										 * branch, so it is asserted rather
										 * than read optionally — which would
										 * render "undefined" where the
										 * original threw.
										 */
										message: `Inline configuration for rule "${ruleId}" is invalid:\n\tRule does not support the language "${/** @type {Record<string, any>} */ (configError.messageData).language}". Use a config block with "files" to apply the rule only to supported files, or disable it.\n`,
										loc,
									});
									return;
								}

								let baseMessage = configError.message
									.slice(
										configError.message.startsWith(
											'Key "rules":',
										)
											? configError.message.indexOf(
													":",
													12,
												) + 1
											: configError.message.indexOf(":") +
													1,
									)
									.trim();

								if (configError.messageTemplate) {
									baseMessage += ` You passed "${ruleValue}".`;
								}

								report.addError({
									ruleId,
									message: `Inline configuration for rule "${ruleId}" is invalid:\n\t${baseMessage}\n`,
									loc,
								});
							}
						});
					}
				}
			}
		}

		const commentDirectives =
			options.allowInlineConfig && !options.warnInlineConfig
				? getDirectiveCommentsForFlatConfig(
						sourceCode,
						ruleId => config.getRuleDefinition(ruleId),
						language,
						report,
					)
				: [];

		const configuredRules = Object.assign(
			{},
			config.rules,
			mergedInlineConfig.rules,
		);

		sourceCode.finalize?.();

		try {
			runRules(
				sourceCode,
				configuredRules,
				ruleId => config.getRuleDefinition(ruleId),
				language,
				languageOptions,
				settings,
				/** @type {string} */ (options.filename),
				false,
				/*
				 * `undefined` only in a browser build, where `normalizeCwd()`
				 * has no `process` to fall back to.
				 */
				/** @type {string} */ (slots.cwd),
				providedOptions.physicalFilename,
				options.ruleFilter,
				options.stats,
				slots,
				report,
			);
		} catch (err) {
			/*
			 * A rule can throw anything. `currentNode` and `ruleId` are the
			 * tags `source-code-traverser.js` and `addRuleErrorHandler()`
			 * attach on the way out, so that the message can name where the
			 * failure happened. The original binding is the one rethrown.
			 */
			const traversalError =
				/** @type {{ message: string, currentNode?: ASTNode, ruleId?: string }} */ (
					err
				);

			traversalError.message += `\nOccurred while linting ${options.filename}`;
			debug("An error occurred while traversing");
			debug("Filename:", options.filename);
			if (traversalError.currentNode) {
				const { line } = sourceCode.getLoc(
					traversalError.currentNode,
				).start;

				debug("Line:", line);
				traversalError.message += `:${line}`;
			}
			debug("Parser Options:", languageOptions.parserOptions);
			debug("Settings:", settings);

			if (traversalError.ruleId) {
				traversalError.message += `\nRule: "${traversalError.ruleId}"`;
			}

			throw err;
		}

		return applyDisableDirectives({
			language,
			sourceCode,
			directives: commentDirectives,
			disableFixes: options.disableFixes,
			problems: report.messages.sort(
				/*
				 * A message need not carry a position, and subtracting an
				 * absent one gives `NaN`, which `sort()` treats as "equal" and
				 * `||` falls through. The defaults state that rather than
				 * change the ordering.
				 */
				(problemA, problemB) =>
					(problemA.line ?? NaN) - (problemB.line ?? NaN) ||
					(problemA.column ?? NaN) - (problemB.column ?? NaN),
			),
			reportUnusedDisableDirectives:
				options.reportUnusedDisableDirectives,
			ruleFilter: options.ruleFilter,
			configuredRules,
		});
	}

	/**
	 * Same as linter.verify, except without support for processors.
	 * @param {string | any} textOrSourceCode The text to parse or a SourceCode object.
	 * @param {any} providedConfig An ESLintConfig instance to configure everything.
	 * @param {VerifyOptions} providedOptions The optional filename of the file being checked.
	 * @throws {Error} If during rule execution.
	 * @returns {LintMessage[]} The results as an array of messages or an empty array if no messages.
	 */
	_verifyWithFlatConfigArrayAndWithoutProcessors(
		textOrSourceCode,
		providedConfig,
		providedOptions,
	) {
		const slots = getInternalSlots(this);
		const filename = normalizeFilename(
			providedOptions.filename || "<input>",
		);
		let text;

		// evaluate arguments
		if (typeof textOrSourceCode === "string") {
			slots.lastSourceCode = null;
			text = textOrSourceCode;
		} else {
			slots.lastSourceCode = textOrSourceCode;
			text = textOrSourceCode.text;
		}

		const file = new VFile(filename, text, {
			physicalPath: providedOptions.physicalFilename,
		});

		return this.#flatVerifyWithoutProcessors(
			file,
			providedConfig,
			providedOptions,
		);
	}

	/**
	 * Verify a given code with a flat config.
	 * @param {string | any} textOrSourceCode The source code.
	 * @param {any} configArray The config array.
	 * @param {VerifyOptions} options The options.
	 * @param {boolean} [firstCall] Indicates if this is the first call in `verify()`
	 *   to determine processor behavior.
	 * @returns {LintMessage[]} The found problems.
	 */
	_verifyWithFlatConfigArray(
		textOrSourceCode,
		configArray,
		options,
		firstCall = false,
	) {
		debug("With flat config: %s", options.filename);

		// we need a filename to match configs against
		const filename = options.filename || "__placeholder__.js";

		// Store the config array in order to get plugin envs and rules later.
		getInternalSlots(this).lastConfigArray = configArray;
		const config = configArray.getConfig(filename);

		if (!config) {
			return [
				{
					ruleId: null,
					severity: 1,
					message: `No matching configuration found for ${filename}.`,
					line: 0,
					column: 0,
				},
			];
		}

		// Verify.
		if (config.processor) {
			debug("Apply the processor: %o", config.processor);
			const { preprocess, postprocess, supportsAutofix } =
				config.processor;
			const disableFixes = options.disableFixes || !supportsAutofix;

			return this._verifyWithFlatConfigArrayAndProcessor(
				textOrSourceCode,
				config,
				{ ...options, filename, disableFixes, postprocess, preprocess },
				configArray,
			);
		}

		// check for options-based processing
		if (firstCall && (options.preprocess || options.postprocess)) {
			return this._verifyWithFlatConfigArrayAndProcessor(
				textOrSourceCode,
				config,
				options,
			);
		}

		return this._verifyWithFlatConfigArrayAndWithoutProcessors(
			textOrSourceCode,
			config,
			options,
		);
	}

	/**
	 * Given a list of reported problems, distinguish problems between normal messages and suppressed messages.
	 * The normal messages will be returned and the suppressed messages will be stored as lastSuppressedMessages.
	 * @param {(LintMessage | SuppressedLintMessage)[]} problems A list of reported problems.
	 * @returns {LintMessage[]} A list of LintMessage.
	 */
	_distinguishSuppressedMessages(problems) {
		/** @type {LintMessage[]} */
		const messages = [];

		/** @type {SuppressedLintMessage[]} */
		const suppressedMessages = [];
		const slots = getInternalSlots(this);

		for (const problem of problems) {
			if ("suppressions" in problem && problem.suppressions) {
				suppressedMessages.push(problem);
			} else {
				messages.push(problem);
			}
		}

		slots.lastSuppressedMessages = suppressedMessages;

		return messages;
	}

	/**
	 * Gets the SourceCode object representing the parsed source.
	 * @returns {any} The SourceCode object. Which source code class this is
	 * depends on the language the file was linted with.
	 */
	getSourceCode() {
		return getInternalSlots(this).lastSourceCode;
	}

	/**
	 * Gets the times spent on (parsing, fixing, linting) a file.
	 * @returns {Times} The times.
	 */
	getTimes() {
		/*
		 * Every pass is complete once linting has finished, which is the only
		 * point this is meant to be read at — see `MutableTimePass`.
		 */
		return /** @type {Times} */ (
			getInternalSlots(this).times ?? { passes: [] }
		);
	}

	/**
	 * Gets the number of autofix passes that were made in the last run.
	 * @returns {number} The number of autofix passes.
	 */
	getFixPassCount() {
		return getInternalSlots(this).fixPasses ?? 0;
	}

	/**
	 * Gets the list of SuppressedLintMessage produced in the last running.
	 * @returns {SuppressedLintMessage[]} The list of SuppressedLintMessage
	 */
	getSuppressedMessages() {
		return getInternalSlots(this).lastSuppressedMessages;
	}

	/**
	 * Performs multiple autofix passes over the text until as many fixes as possible
	 * have been applied.
	 * @param {string} text The source text to apply fixes to.
	 * @param {ConfigObject | ConfigObject[] | any} config The ESLint config object or array to use.
	 * @param {string | (VerifyOptions & { fix?: boolean })} [filenameOrOptions] The filename or ESLint options object to use.
	 * @returns {{ fixed: boolean, messages: LintMessage[], output: string }} The result of the fix operation as returned from the
	 *      SourceCodeFixer.
	 */
	verifyAndFix(text, config, filenameOrOptions) {
		let messages,
			fixedResult,
			fixed = false,
			passNumber = 0,
			currentText = text,
			/*
			 * Each holds the text from an earlier pass, so each is absent
			 * until the loop has run that many times. The circular-fix check
			 * below is guarded by `passNumber > 1`, which control flow
			 * analysis cannot carry.
			 */
			/** @type {string | undefined} */
			secondPreviousText,
			/** @type {string | undefined} */
			previousText;
		const options =
			typeof filenameOrOptions === "string"
				? { filename: filenameOrOptions }
				: filenameOrOptions || {};
		const debugTextDescription =
			options.filename || `${text.slice(0, 10)}...`;
		const shouldFix =
			typeof options.fix !== "undefined" ? options.fix : true;
		const stats = options?.stats;

		const slots = getInternalSlots(this);

		// Remove lint times from the last run.
		if (stats) {
			delete slots.times;
			slots.fixPasses = 0;
		}

		/**
		 * This loop continues until one of the following is true:
		 *
		 * 1. No more fixes have been applied.
		 * 2. Ten passes have been made.
		 *
		 * That means anytime a fix is successfully applied, there will be another pass.
		 * Essentially, guaranteeing a minimum of two passes.
		 */
		do {
			passNumber++;
			let tTotal;

			if (stats) {
				tTotal = startTime();
			}

			debug(
				`Linting code for ${debugTextDescription} (pass ${passNumber})`,
			);
			messages = this.verify(currentText, config, options);

			debug(
				`Generating fixed text for ${debugTextDescription} (pass ${passNumber})`,
			);
			let t;

			if (stats) {
				t = startTime();
			}

			fixedResult = SourceCodeFixer.applyFixes(
				currentText,
				messages,
				shouldFix,
			);

			if (stats) {
				if (fixedResult.fixed) {
					// `startTime()` ran under the same guard just above.
					const started = /** @type {[number, number]} */ (t);
					const time = endTime(started);

					storeTime(time, { type: "fix" }, slots);
					slots.fixPasses++;
				} else {
					storeTime(0, { type: "fix" }, slots);
				}
			}

			/*
			 * stop if there are any syntax errors.
			 * 'fixedResult.output' is a empty string.
			 */
			if (messages.length === 1 && messages[0].fatal) {
				break;
			}

			// keep track if any fixes were ever applied - important for return value
			fixed = fixed || fixedResult.fixed;

			// update to use the fixed output instead of the original text
			secondPreviousText = previousText;
			previousText = currentText;
			currentText = fixedResult.output;

			if (stats) {
				/*
				 * `startTime()` ran at the top of this pass, and `storeTime()`
				 * has created `times` by now — both under this same guard.
				 */
				const started = /** @type {[number, number]} */ (tTotal);
				const times = /** @type {MutableTimes} */ (slots.times);

				tTotal = endTime(started);

				const passIndex = times.passes.length - 1;

				times.passes[passIndex].total = tTotal;
			}

			// Stop if we've made a circular fix
			if (
				passNumber > 1 &&
				currentText.length === secondPreviousText?.length &&
				currentText === secondPreviousText
			) {
				debug(
					`Circular fixes detected after pass ${passNumber}. Exiting fix loop.`,
				);
				slots.warningService.emitCircularFixesWarning(
					options.filename ?? "text",
				);
				break;
			}
		} while (fixedResult.fixed && passNumber < MAX_AUTOFIX_PASSES);

		/*
		 * If the last result had fixes, we need to lint again to be sure we have
		 * the most up-to-date information.
		 */
		if (fixedResult.fixed) {
			let tTotal;

			if (stats) {
				tTotal = startTime();
			}

			fixedResult.messages = this.verify(currentText, config, options);

			if (stats) {
				storeTime(0, { type: "fix" }, slots);

				/*
				 * `startTime()` ran under the same guard just above, and
				 * `storeTime()` has just ensured there is a pass to record on.
				 */
				const started = /** @type {[number, number]} */ (tTotal);
				const times = /** @type {MutableTimes} */ (slots.times);
				const lastPass = /** @type {MutableTimePass} */ (
					times.passes.at(-1)
				);

				lastPass.total = endTime(started);
			}
		}

		// ensure the last result properly reflects if fixes were done
		fixedResult.fixed = fixed;
		fixedResult.output = currentText;

		return fixedResult;
	}
}

module.exports = {
	Linter,
};

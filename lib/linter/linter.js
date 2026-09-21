/**
 * @fileoverview Main Linter Class
 * @author Gyandeep Singh
 * @author aladdin-add
 */

// @ts-check

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

/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../shared/types.js").NodeOrToken} NodeOrToken */
/** @typedef {import("../shared/types.js").Position} Position */
/** @typedef {import("../shared/types.js").Range} Range */
/** @typedef {import("../shared/types.js").RuleContext} RuleContext */
/** @typedef {import("../shared/types.js").RuleModule} RuleModule */
/** @typedef {import("../shared/types.js").Severity} Severity */
/** @typedef {import("../shared/types.js").SeverityName} SeverityName */
/** @typedef {import("../shared/types.js").SourceLocation} SourceLocation */
/** @typedef {import("../shared/types.js").SuppressedLintMessage} SuppressedLintMessage */
/** @typedef {import("./apply-disable-directives.js").UnprocessedDirective} UnprocessedDirective */
/** @typedef {import("./file-report.js").RuleMapper} RuleMapper */

/**
 * The loose node shape the linter hands around, shared with the rules layer.
 * @typedef {import("../rules/utils/ast-utils.js").ASTNode} ASTNode
 */

/**
 * A `Language` object. Languages come from plugins and the linter only reaches
 * into them through optional members, so the shape stays open.
 * @typedef {Record<string, any>} LinterLanguage
 */

/**
 * The resolved `languageOptions` for a file, owned by whichever language parsed it.
 * @typedef {Record<string, any>} LinterLanguageOptions
 */

/**
 * A source code object. Every language supplies its own, so only the members
 * the `Language` API guarantees are pinned; the linter probes for the optional
 * ones it wants (`applyInlineConfig`, `finalize`, ...) before calling them.
 * @typedef {{
 *   text: string,
 *   getLoc: (nodeOrToken: NodeOrToken) => SourceLocation,
 *   getRange: (nodeOrToken: NodeOrToken) => Range,
 *   traverse: () => Iterable<any>
 * } & Record<string, any>} LinterSourceCode
 */

/**
 * The resolved configuration for one file. `Config` copies the user's config
 * onto itself with `Object.assign()`, so the keys read below are not declared
 * on the class and are restated here.
 * @typedef {InstanceType<typeof Config> & {
 *   rules?: Record<string, any>,
 *   settings?: Record<string, unknown>,
 *   languageOptions?: LinterLanguageOptions,
 *   language?: LinterLanguage,
 *   linterOptions?: Record<string, any>,
 *   processor?: Record<string, any>,
 *   configNameOfNoInlineConfig?: string,
 *   getConfig?: (filename: string) => LinterConfig | undefined
 * }} LinterConfig
 */

/**
 * The options accepted by `verify()` and the internal `_verifyWith*` methods.
 * @typedef {Record<string, any>} VerifyOptions
 */

/**
 * The options after {@linkcode normalizeVerifyOptions} has filled in defaults.
 * @typedef {Object} NormalizedVerifyOptions
 * @property {string} filename The reported filename.
 * @property {boolean} allowInlineConfig Whether inline config comments apply.
 * @property {string | null} warnInlineConfig The config name to name in the warning, when inline config is disabled.
 * @property {import("./apply-disable-directives.js").ReportUnusedDisableDirectivesOption} reportUnusedDisableDirectives How unused directives should be reported.
 * @property {SeverityName} reportUnusedInlineConfigs How redundant inline configs should be reported.
 * @property {boolean} disableFixes Whether `fix` properties should be omitted.
 * @property {boolean} [stats] Whether timing information should be collected.
 * @property {(rule: { ruleId: string, severity: number }) => boolean} ruleFilter Selects which rules run.
 */

/**
 * One timing bucket, either a total on its own or a map of keyed totals.
 * @typedef {{ total: number } & Record<string, any>} TimingEntry
 */

/**
 * The per-`Linter`-instance state, kept off the instance so it stays private.
 * @typedef {Object} LinterInternalSlots
 * @property {string | undefined} cwd The current working directory.
 * @property {Array<string>} flags The feature flags enabled for this instance.
 * @property {any} lastConfigArray The config array used by the last run.
 * @property {LinterSourceCode | null} lastSourceCode The source code from the last run.
 * @property {Array<SuppressedLintMessage>} lastSuppressedMessages The suppressed messages from the last run.
 * @property {WarningService} warningService The service warnings are emitted through.
 * @property {{ passes: Array<Record<string, any>> }} [times] The timings collected when `stats` is on.
 * @property {number} [fixPasses] The number of autofix passes made.
 */

/**
 * Which measurement {@linkcode storeTime} is recording.
 * @typedef {Object} TimeOptions
 * @property {string} type The phase being measured, such as `"parse"` or `"rules"`.
 * @property {string} [key] The rule ID, when the phase is measured per rule.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Wraps the value in an Array if it isn't already one.
 * @param {any} value Value to be wrapped.
 * @returns {Array<any>} The value as an array.
 */
function asArray(value) {
	return Array.isArray(value) ? value : [value];
}

/**
 * Pushes a problem to inlineConfigProblems if ruleOptions are redundant.
 * @param {LinterConfig} config Provided config.
 * @param {SourceLocation} loc A line/column location
 * @param {FileReport} report Report that may be added to.
 * @param {string} ruleId The rule ID.
 * @param {Array<any>} ruleOptions The rule options, merged with the config's.
 * @param {Array<any>} ruleOptionsInline The rule options from the comment.
 * @param {SeverityName} severity The severity to report.
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
 * @param {Object} options to create disable directives
 * @param {import("./apply-disable-directives.js").DirectiveType} options.type The type of directive comment
 * @param {string} options.value The value after the directive in the comment
 * comment specified no specific rules, so it applies to all rules (e.g. `eslint-disable`)
 * @param {string} [options.justification] The justification of the directive
 * @param {import("../shared/types.js").Comment} options.node The Comment node/token.
 * @param {RuleMapper} ruleMapper A map from rule IDs to defined rules
 * @param {LinterLanguage} language The language to use to adjust the location information.
 * @param {LinterSourceCode} sourceCode The SourceCode object to get comments from.
 * @param {FileReport} report The report to add problems to.
 * @returns {Array<UnprocessedDirective>} Directives from the comment
 */
function createDisableDirectives(
	{ type, value, justification, node },
	ruleMapper,
	language,
	sourceCode,
	report,
) {
	const ruleIds = Object.keys(commentParser.parseListConfig(value));

	/*
	 * A comment naming no rules applies to every rule, which the rest of the
	 * pipeline models as a single directive with a `null` rule ID.
	 */
	const directiveRules = /** @type {Array<string | null>} */ (
		ruleIds.length ? ruleIds : [null]
	);

	/** @type {Array<UnprocessedDirective>} */
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
 * @param {LinterSourceCode} sourceCode The SourceCode object to get comments from.
 * @param {RuleMapper} ruleMapper A map from rule IDs to defined rules
 * @param {LinterLanguage} language The language to use to adjust the location information
 * @param {FileReport} report The report to add problems to.
 * @returns {Array<UnprocessedDirective>}
 * A collection of the directive comments that were found, along with any problems that occurred when parsing
 */
function getDirectiveCommentsForFlatConfig(
	sourceCode,
	ruleMapper,
	language,
	report,
) {
	/** @type {Array<UnprocessedDirective>} */
	const disableDirectives = [];

	if (sourceCode.getDisableDirectives) {
		const { directives: directivesSources, problems: directivesProblems } =
			sourceCode.getDisableDirectives();

		if (Array.isArray(directivesProblems)) {
			directivesProblems.forEach(problem => report.addError(problem));
		}

		directivesSources.forEach((/** @type {any} */ directive) => {
			const directives = createDisableDirectives(
				directive,
				ruleMapper,
				language,
				sourceCode,
				report,
			);

			disableDirectives.push(...directives);
		});
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
 * @param {LinterConfig} config Config.
 * @returns {NormalizedVerifyOptions} Normalized options
 */
function normalizeVerifyOptions(providedOptions, config) {
	/*
	 * Flat configs nest these under `linterOptions`; the legacy shape the
	 * public `verify()` still accepts puts them at the top level.
	 */
	const linterOptions = /** @type {Record<string, any>} */ (
		config.linterOptions || config
	);
	const disableInlineConfig = linterOptions.noInlineConfig === true;
	const ignoreInlineConfig = providedOptions.allowInlineConfig === false;
	const configNameOfNoInlineConfig = config.configNameOfNoInlineConfig
		? ` (${config.configNameOfNoInlineConfig})`
		: "";

	/** @type {any} */
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

	/** @type {(rule: { ruleId: string, severity: number }) => boolean} */
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
 * @param {LinterInternalSlots} slots Linter internal slots map
 * @returns {void}
 */
function storeTime(time, timeOpts, slots) {
	const { type, key } = timeOpts;

	if (!slots.times) {
		slots.times = { passes: [{}] };
	}

	/*
	 * `fixPasses` is only unset outside of `verifyAndFix()`, where a single
	 * pass is recorded; `undefined` indexes the sole entry the same way `0` does.
	 */
	const passIndex = /** @type {number} */ (slots.fixPasses);
	const passes = /** @type {{ passes: Array<Record<string, any>> }} */ (
		slots.times
	).passes;

	if (passIndex > passes.length - 1) {
		passes.push({});
	}

	if (key) {
		passes[passIndex][type] ??= {};
		passes[passIndex][type][key] ??= { total: 0 };
		passes[passIndex][type][key].total += time;
	} else {
		passes[passIndex][type] ??= { total: 0 };
		passes[passIndex][type].total += time;
	}
}

/**
 * Get the options for a rule (not including severity), if any
 * @param {any} ruleConfig rule configuration
 * @param {Array<any>} [defaultOptions] rule.meta.defaultOptions
 * @returns {Array<any>} of rule options, empty Array if none
 */
function getRuleOptions(ruleConfig, defaultOptions) {
	if (Array.isArray(ruleConfig)) {
		return deepMergeArrays(defaultOptions, ruleConfig.slice(1));
	}
	return defaultOptions ?? [];
}

/**
 * Analyze scope of the given AST.
 * @param {ASTNode} ast The `Program` node to analyze.
 * @param {LinterLanguageOptions} languageOptions The language options.
 * @param {import("eslint-visitor-keys").VisitorKeys} [visitorKeys] The visitor keys.
 * @returns {import("eslint-scope").ScopeManager} The analysis result.
 */
function analyzeScope(ast, languageOptions, visitorKeys) {
	const parserOptions = languageOptions.parserOptions;
	const ecmaFeatures = parserOptions.ecmaFeatures || {};
	const ecmaVersion = languageOptions.ecmaVersion || DEFAULT_ECMA_VERSION;

	/*
	 * eslint-scope is typed against the ESTree union; the linter passes the
	 * looser node shape every language shares.
	 */
	const program = /** @type {import("estree").Program} */ (
		/** @type {unknown} */ (ast)
	);

	return eslintScope.analyze(program, {
		ignoreEval: true,
		nodejsScope: ecmaFeatures.globalReturn,
		impliedStrict: ecmaFeatures.impliedStrict,
		ecmaVersion: typeof ecmaVersion === "number" ? ecmaVersion : 6,
		sourceType: languageOptions.sourceType || "script",
		childVisitorKeys: visitorKeys || evk.KEYS,

		/*
		 * `Traverser.getKeys` is tagged `@private` and returns a
		 * `readonly string[]` where eslint-scope declares a mutable one, but
		 * it is deliberately reused here as the fallback.
		 */
		fallback: /** @type {any} */ (Traverser).getKeys,
		jsx: ecmaFeatures.jsx,
	});
}

/**
 * Runs a rule, and gets its listeners
 * @param {RuleModule} rule A rule object
 * @param {RuleContext} ruleContext The context that should be passed to the rule
 * @throws {TypeError} If `rule` is not an object with a `create` method
 * @throws {Error} Any error during the rule's `create`
 * @returns {Record<string, Function>} A map of selector listeners provided by the rule
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
		 * A `catch` binding is `unknown` under `strict`. A rule's `create()`
		 * throwing anything but an `Error` is not a case ESLint supports, and
		 * the message is prefixed rather than replaced.
		 */
		const error = /** @type {Error} */ (ex);

		error.message = `Error while loading rule '${ruleContext.id}': ${error.message}`;
		throw error;
	}
}

/**
 * Runs the given rules on the given SourceCode object
 * @param {LinterSourceCode} sourceCode A SourceCode object for the given text
 * @param {Record<string, any>} configuredRules The rules configuration
 * @param {RuleMapper} ruleMapper A mapper function from rule names to rules
 * @param {LinterLanguage} language The language object used for parsing.
 * @param {LinterLanguageOptions} languageOptions The options for parsing the code.
 * @param {Record<string, unknown>} settings The settings that were enabled in the config
 * @param {string} filename The reported filename of the code
 * @param {boolean} applyDefaultOptions If true, apply rules' meta.defaultOptions in computing their config options.
 * @param {string | undefined} cwd cwd of the cli
 * @param {string | undefined} physicalFilename The full path of the file on disk without any code block information
 * @param {(rule: { ruleId: string, severity: number }) => boolean} ruleFilter A predicate function to filter which rules should be executed.
 * @param {boolean | undefined} stats If true, stats are collected appended to the result
 * @param {LinterInternalSlots} slots InternalSlotsMap of linter
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
		// `cwd` is only absent in environments without a `process` global.
		cwd: /** @type {string} */ (cwd),
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
			 * @param {...any} args The `context.report()` arguments.
			 * @returns {void}
			 * @throws {Error} If the rule reported a fix or suggestions without declaring support for them.
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
					if (
						rule.meta &&
						rule.meta.docs &&
						typeof (
							/** @type {Record<string, unknown>} */ (
								rule.meta.docs
							).suggestion
						) !== "undefined"
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

		/*
		 * `ruleContext` is a `FileContext` with the per-rule members grafted
		 * on, which is exactly the shape a rule receives.
		 */
		const context = /** @type {RuleContext} */ (
			/** @type {unknown} */ (ruleContext)
		);

		const ruleListenersReturn =
			timing.enabled || stats
				? timing.time(ruleId, createRuleListeners, stats)(rule, context)
				: createRuleListeners(rule, context);

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
		 * @param {(...args: Array<any>) => any} ruleListener A rule method that listens for a node.
		 * @returns {(...args: Array<any>) => any} ruleListener wrapped in error handler
		 */
		function addRuleErrorHandler(ruleListener) {
			return function ruleErrorHandler(
				/** @type {...any} */ ...listenerArgs
			) {
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
					// A `catch` binding is `unknown` under `strict`.
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

	traverser.traverseSync(
		/** @type {import("./source-code-traverser.js").TraversableSourceCode} */ (
			sourceCode
		),
		visitor,
		{ steps },
	);

	return report;
}

/**
 * Ensure the source code to be a string.
 * @param {string | LinterSourceCode} textOrSourceCode The text or source code object.
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
 * @type {WeakMap<Linter, LinterInternalSlots>}
 */
const internalSlotsMap = new WeakMap();

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Object that is responsible for verifying JavaScript text
 * @name Linter
 */
class Linter {
	/**
	 * This instance's private data. Reading it through an accessor keeps the
	 * `WeakMap` the single source of truth while letting the rest of the class
	 * skip a presence check at every use — the constructor always populates it.
	 * @returns {LinterInternalSlots} The slots for this instance.
	 */
	get #slots() {
		return /** @type {LinterInternalSlots} */ (internalSlotsMap.get(this));
	}

	/**
	 * Initialize the Linter.
	 * @param {Object} [config] the config object
	 * @param {string} [config.cwd] path to a directory that should be considered as the current working directory, can be undefined.
	 * @param {Array<string>} [config.flags] the feature flags to enable.
	 * @param {string} [config.configType] the type of config used. Retrained for backwards compatibility, will be removed in future.
	 * @param {WarningService} [config.warningService] The warning service to use.
	 * @throws {TypeError} If `configType` is not `"flat"`.
	 */
	constructor({
		cwd,
		configType = "flat",
		flags = [],
		warningService = new WarningService(),
	} = {}) {
		/** @type {Array<string>} */
		const processedFlags = [];

		if (configType !== "flat") {
			throw new TypeError(
				`The 'configType' option value must be 'flat'. The value '${configType}' is not supported.`,
			);
		}

		flags.forEach(flag => {
			if (inactiveFlags.has(flag)) {
				// Sound: guarded by the `has()` check on the line above.
				const inactiveFlagData =
					/** @type {import("../shared/flags.js").InactiveFlagData} */ (
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
		return this.#slots.flags.includes(flag);
	}

	/**
	 * Verifies the text against the rules specified by the second argument.
	 * @param {string | LinterSourceCode} textOrSourceCode The text to parse or a SourceCode object.
	 * @param {any} config The ESLint config object or array to use.
	 * @param {string | VerifyOptions} [filenameOrOptions] The optional filename of the file being checked.
	 *      If this is not set, the filename will default to '<input>' in the rule context. If
	 *      an object, then it has "filename", "allowInlineConfig", and some properties.
	 * @returns {Array<LintMessage>} The results as an array of messages or an empty array if no messages.
	 */
	verify(textOrSourceCode, config, filenameOrOptions) {
		debug("Verify");

		const { cwd } = this.#slots;

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
			typeof (/** @type {any} */ (configToUse).getConfig) !== "function"
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
	 * @param {string | LinterSourceCode} textOrSourceCode The source code.
	 * @param {LinterConfig} config The config array.
	 * @param {VerifyOptions} options The options.
	 * @param {any} [configForRecursive] The `ConfigArray` object to apply multiple processors recursively.
	 * @returns {Array<LintMessage>} The found problems.
	 */
	_verifyWithFlatConfigArrayAndProcessor(
		textOrSourceCode,
		config,
		options,
		configForRecursive,
	) {
		const slots = this.#slots;
		const filename = options.filename || "<input>";
		const filenameToExpose = normalizeFilename(filename);
		const physicalFilename = options.physicalFilename || filenameToExpose;
		const text = ensureText(textOrSourceCode);
		const file = new VFile(filenameToExpose, text, {
			physicalPath: physicalFilename,
		});

		/**
		 * Splits the file into the code blocks to lint, one block by default.
		 * @type {(rawText: string) => Array<any>}
		 */
		const preprocess = options.preprocess || (rawText => [rawText]);

		/**
		 * Recombines the per-block messages into one list for the whole file.
		 * @type {(messagesList: Array<Array<LintMessage>>) => Array<LintMessage>}
		 */
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
			return /** @type {Array<LintMessage>} */ (preprocessResult.errors);
		}

		/**
		 * Decides which of the preprocessed blocks are worth linting.
		 * @type {(blockFilename: string, text?: string) => boolean}
		 */
		const filterCodeBlock =
			options.filterCodeBlock ||
			(blockFilename => blockFilename.endsWith(".js"));
		const originalExtname = path.extname(filename);
		const { files } = preprocessResult;

		const messageLists = files.map((/** @type {any} */ block) => {
			debug("A code block was found: %o", block.path || "(unnamed)");

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
		});

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
	 * @param {LinterConfig} providedConfig An ESLintConfig instance to configure everything.
	 * @param {VerifyOptions} providedOptions The optional filename of the file being checked.
	 * @throws {Error} If during rule execution.
	 * @returns {Array<LintMessage>} The results as an array of messages or an empty array if no messages.
	 */
	#flatVerifyWithoutProcessors(file, providedConfig, providedOptions) {
		const slots = this.#slots;
		const config = providedConfig || {};
		const { settings = {}, languageOptions } = config;
		const options = normalizeVerifyOptions(providedOptions, config);

		if (!slots.lastSourceCode) {
			/** @type {[number, number] | undefined} */
			let t;

			if (options.stats) {
				t = startTime();
			}

			const parserService = new ParserService();
			const parseResult = parserService.parseSync(file, config);

			if (options.stats) {
				// Assigned above under the same `options.stats` guard.
				const time = endTime(/** @type {[number, number]} */ (t));

				storeTime(time, { type: "parse" }, slots);
			}

			if (!parseResult.ok) {
				return /** @type {Array<LintMessage>} */ (parseResult.errors);
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

		/*
		 * Both branches above leave `lastSourceCode` populated: either the
		 * parse succeeded and assigned it, or it was already set.
		 */
		const sourceCode = /** @type {LinterSourceCode} */ (
			slots.lastSourceCode
		);
		const report = new FileReport({
			ruleMapper: ruleId => config.getRuleDefinition(ruleId),
			language: config.language,
			sourceCode,
			disableFixes: options.disableFixes,
		});

		/*
		 * Make adjustments based on the language options. For JavaScript,
		 * this is primarily about adding variables into the global scope
		 * to account for ecmaVersion and configured globals.
		 */
		sourceCode.applyLanguageOptions?.(languageOptions);

		const mergedInlineConfig = {
			/** @type {Record<string, Array<any>>} */
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
						(/** @type {any} */ problem) => {
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
									ruleOptions = [
										ruleOptions[0], // severity from the inline config
										...config.rules[ruleId].slice(1), // options from the provided config
									];

									// if the rule was enabled, the options have already been validated
									if (config.rules[ruleId][0] > 0) {
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
									config.validateRulesConfig({
										[ruleId]: ruleOptions,
									});
								}

								mergedInlineConfig.rules[ruleId] = ruleOptions;
							} catch (error) {
								/*
								 * A `catch` binding is `unknown` under `strict`.
								 * Everything thrown here is an `Error`; the
								 * config layer stamps the extra fields read
								 * below onto the ones it raises.
								 */
								const err =
									/** @type {Error & { code?: string, messageTemplate?: string, messageData?: Record<string, any> }} */ (
										error
									);

								/*
								 * If the rule has invalid `meta.schema`, throw the error because
								 * this is not an invalid inline configuration but an invalid rule.
								 */
								if (
									err.code ===
									"ESLINT_INVALID_RULE_OPTIONS_SCHEMA"
								) {
									throw err;
								}

								/*
								 * If the rule does not support the current language, report a
								 * specific, actionable error message.
								 */
								if (
									err.messageTemplate ===
									"rule-unsupported-language"
								) {
									report.addError({
										ruleId,
										message: `Inline configuration for rule "${ruleId}" is invalid:\n\tRule does not support the language "${/** @type {Record<string, any>} */ (err.messageData).language}". Use a config block with "files" to apply the rule only to supported files, or disable it.\n`,
										loc,
									});
									return;
								}

								let baseMessage = err.message
									.slice(
										err.message.startsWith('Key "rules":')
											? err.message.indexOf(":", 12) + 1
											: err.message.indexOf(":") + 1,
									)
									.trim();

								if (err.messageTemplate) {
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
						config.language,
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
				config.language,
				languageOptions,
				settings,
				options.filename,
				false,
				slots.cwd,
				providedOptions.physicalFilename,
				options.ruleFilter,
				options.stats,
				slots,
				report,
			);
		} catch (error) {
			/*
			 * A `catch` binding is `unknown` under `strict`. The traverser and
			 * the rule error handler stamp `currentNode` and `ruleId` onto
			 * whatever a rule threw before it reaches here.
			 */
			const err =
				/** @type {Error & { currentNode?: ASTNode, ruleId?: string }} */ (
					error
				);

			err.message += `\nOccurred while linting ${options.filename}`;
			debug("An error occurred while traversing");
			debug("Filename:", options.filename);
			if (err.currentNode) {
				const { line } = sourceCode.getLoc(err.currentNode).start;

				debug("Line:", line);
				err.message += `:${line}`;
			}
			debug("Parser Options:", languageOptions.parserOptions);
			debug("Settings:", settings);

			if (err.ruleId) {
				err.message += `\nRule: "${err.ruleId}"`;
			}

			throw err;
		}

		return applyDisableDirectives({
			language: config.language,
			sourceCode,
			directives: commentDirectives,
			disableFixes: options.disableFixes,
			problems: report.messages.sort(
				(problemA, problemB) =>
					problemA.line - problemB.line ||
					problemA.column - problemB.column,
			),
			reportUnusedDisableDirectives:
				options.reportUnusedDisableDirectives,
			ruleFilter: options.ruleFilter,
			configuredRules,
		});
	}

	/**
	 * Same as linter.verify, except without support for processors.
	 * @param {string | LinterSourceCode} textOrSourceCode The text to parse or a SourceCode object.
	 * @param {LinterConfig} providedConfig An ESLintConfig instance to configure everything.
	 * @param {VerifyOptions} providedOptions The optional filename of the file being checked.
	 * @throws {Error} If during rule execution.
	 * @returns {Array<LintMessage>} The results as an array of messages or an empty array if no messages.
	 */
	_verifyWithFlatConfigArrayAndWithoutProcessors(
		textOrSourceCode,
		providedConfig,
		providedOptions,
	) {
		const slots = this.#slots;
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
	 * @param {string | LinterSourceCode} textOrSourceCode The source code.
	 * @param {any} configArray The config array.
	 * @param {VerifyOptions} options The options.
	 * @param {boolean} [firstCall] Indicates if this is the first call in `verify()`
	 *   to determine processor behavior.
	 * @returns {Array<LintMessage>} The found problems.
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
		this.#slots.lastConfigArray = configArray;
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
	 * @param {Array<LintMessage>} problems A list of reported problems.
	 * @returns {Array<LintMessage>} A list of LintMessage.
	 */
	_distinguishSuppressedMessages(problems) {
		/** @type {Array<LintMessage>} */
		const messages = [];

		/** @type {Array<SuppressedLintMessage>} */
		const suppressedMessages = [];
		const slots = this.#slots;

		for (const problem of problems) {
			/*
			 * `suppressions` is what makes a message a `SuppressedLintMessage`;
			 * `applyDisableDirectives` is what stamps it on.
			 */
			const suppressed = /** @type {SuppressedLintMessage} */ (problem);

			if (suppressed.suppressions) {
				suppressedMessages.push(suppressed);
			} else {
				messages.push(problem);
			}
		}

		slots.lastSuppressedMessages = suppressedMessages;

		return messages;
	}

	/**
	 * Gets the SourceCode object representing the parsed source.
	 * @returns {LinterSourceCode | null} The SourceCode object.
	 */
	getSourceCode() {
		return this.#slots.lastSourceCode;
	}

	/**
	 * Gets the times spent on (parsing, fixing, linting) a file.
	 * @returns {{ passes: Array<Record<string, any>> }} The times.
	 */
	getTimes() {
		return this.#slots.times ?? { passes: [] };
	}

	/**
	 * Gets the number of autofix passes that were made in the last run.
	 * @returns {number} The number of autofix passes.
	 */
	getFixPassCount() {
		return this.#slots.fixPasses ?? 0;
	}

	/**
	 * Gets the list of SuppressedLintMessage produced in the last running.
	 * @returns {Array<SuppressedLintMessage>} The list of SuppressedLintMessage
	 */
	getSuppressedMessages() {
		return this.#slots.lastSuppressedMessages;
	}

	/**
	 * Performs multiple autofix passes over the text until as many fixes as possible
	 * have been applied.
	 * @param {string} text The source text to apply fixes to.
	 * @param {any} config The ESLint config object or array to use.
	 * @param {string | VerifyOptions} [filenameOrOptions] The filename or ESLint options object to use.
	 * @returns {import("./source-code-fixer.js").FixReport} The result of the fix operation as returned from the
	 *      SourceCodeFixer.
	 */
	verifyAndFix(text, config, filenameOrOptions) {
		let /** @type {Array<LintMessage>} */ messages,
			/** @type {import("./source-code-fixer.js").FixReport} */ fixedResult,
			fixed = false,
			passNumber = 0,
			currentText = text,
			/** @type {string | undefined} */ secondPreviousText,
			/** @type {string | undefined} */ previousText;
		const options =
			typeof filenameOrOptions === "string"
				? { filename: filenameOrOptions }
				: filenameOrOptions || {};
		const debugTextDescription =
			options.filename || `${text.slice(0, 10)}...`;
		const shouldFix =
			typeof options.fix !== "undefined" ? options.fix : true;
		const stats = options?.stats;

		const slots = this.#slots;

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

			/** @type {[number, number] | number | undefined} */
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
			/** @type {[number, number] | undefined} */
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
					// Assigned above under the same `stats` guard.
					const time = endTime(/** @type {[number, number]} */ (t));

					storeTime(time, { type: "fix" }, slots);

					// Reset to 0 above whenever `stats` is on.
					const passesSoFar = /** @type {number} */ (slots.fixPasses);

					slots.fixPasses = passesSoFar + 1;
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
				// Assigned above under the same `stats` guard.
				tTotal = endTime(/** @type {[number, number]} */ (tTotal));

				const { passes } =
					/** @type {{ passes: Array<Record<string, any>> }} */ (
						slots.times
					);
				const passIndex = passes.length - 1;

				passes[passIndex].total = tTotal;
			}

			// Stop if we've made a circular fix
			if (
				passNumber > 1 &&
				/*
				 * Only reachable from the second pass on, by which point both
				 * previous texts have been recorded.
				 */
				currentText.length ===
					/** @type {string} */ (secondPreviousText).length &&
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
			/** @type {[number, number] | undefined} */
			let tTotal;

			if (stats) {
				tTotal = startTime();
			}

			fixedResult.messages = this.verify(currentText, config, options);

			if (stats) {
				storeTime(0, { type: "fix" }, slots);

				const { passes } =
					/** @type {{ passes: Array<Record<string, any>> }} */ (
						slots.times
					);

				/*
				 * Non-empty and `tTotal` assigned: `storeTime()` just ran and
				 * the start was taken under the same `stats` guard.
				 */
				/** @type {Record<string, any>} */ (passes.at(-1)).total =
					endTime(/** @type {[number, number]} */ (tTotal));
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

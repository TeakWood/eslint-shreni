/**
 * @fileoverview A module that filters reported problems based on `eslint-disable` and `eslint-enable` comments
 * @author Teddy Katz
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Module Definition
//------------------------------------------------------------------------------

const escapeRegExp = require("escape-string-regexp");
const { Config } = require("../config/config.js");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").Comment} Comment */
/** @typedef {import("../shared/types.js").EditInfo} EditInfo */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../shared/types.js").NodeOrToken} NodeOrToken */
/** @typedef {import("../shared/types.js").Range} Range */
/** @typedef {import("../shared/types.js").SourceLocation} SourceLocation */

/**
 * Anything carrying a one-based source position. Both directives and problems
 * are ordered with {@linkcode compareLocations}.
 * @typedef {Object} Locatable
 * @property {number} line The one-based line number.
 * @property {number} column The one-based column number.
 */

/** @typedef {"disable" | "enable" | "disable-line" | "disable-next-line"} DirectiveType */

/**
 * The comment a group of directives was parsed out of. One comment can yield
 * several directives, one per rule it names.
 * @typedef {Object} ParentDirective
 * @property {Comment} node The comment token itself.
 * @property {string} value The text following the directive keyword.
 * @property {Array<string>} ruleIds The rule IDs the comment names, which may be empty.
 */

/**
 * A directive exactly as the linter parsed it out of a comment.
 * @typedef {Object} UnprocessedDirective
 * @property {ParentDirective} parentDirective The comment this directive came from.
 * @property {DirectiveType} type The kind of directive.
 * @property {number} line The one-based line the directive takes effect on.
 * @property {number} column The one-based column the directive takes effect on.
 * @property {string | null} ruleId The rule the directive applies to, or `null` for all rules.
 * @property {string} [justification] The text after the `--` separator, when present.
 */

/**
 * A directive normalized for application. `disable-line` and `disable-next-line`
 * each expand into a `disable`/`enable` pair pointing back at the directive they
 * came from; block directives point at themselves.
 * @typedef {Object} ProcessedDirective
 * @property {"disable" | "enable"} type Whether the directive starts or ends a suppression.
 * @property {number} line The one-based line the directive takes effect on.
 * @property {number} column The one-based column the directive takes effect on.
 * @property {string | null} ruleId The rule the directive applies to, or `null` for all rules.
 * @property {UnprocessedDirective} unprocessedDirective The directive this was derived from.
 */

/**
 * A pending removal of an unused directive, before it is turned into a problem.
 * @typedef {Object} DirectiveRemoval
 * @property {string} description The rule IDs the message should name, which may be empty.
 * @property {EditInfo} fix The edit that removes the directive.
 * @property {UnprocessedDirective} unprocessedDirective The directive being removed.
 */

/**
 * The slice of a source code object this module reads.
 * @typedef {Object} DirectiveSourceCode
 * @property {string} text The full source text of the file.
 * @property {(nodeOrToken: NodeOrToken) => Range} getRange Returns the range of the given node or token.
 * @property {(nodeOrToken: NodeOrToken) => SourceLocation} getLoc Returns the location of the given node or token.
 */

/**
 * The slice of a `Language` object this module reads.
 * @typedef {Object} DirectiveLanguage
 * @property {number} [columnStart] The first column number the language uses, either `0` or `1`.
 * @property {number} [lineStart] The first line number the language uses, either `0` or `1`.
 */

/** @typedef {"off" | "warn" | "error"} ReportUnusedDisableDirectivesOption */

/**
 * The options {@linkcode applyDirectives} takes.
 * @typedef {Object} ApplyDirectivesOptions
 * @property {DirectiveLanguage} language The language being linted.
 * @property {DirectiveSourceCode} sourceCode The source code object for the file being linted.
 * @property {Array<ProcessedDirective>} directives The normalized directives to apply.
 * @property {Array<LintMessage>} problems The problems reported by rules, sorted by location.
 * @property {boolean} [disableFixes] If `true`, no `fix` property is produced.
 * @property {ReportUnusedDisableDirectivesOption} reportUnusedDisableDirectives How unused directives should be reported.
 * @property {Set<string | null>} rulesToIgnore The rules a `ruleFilter` has excluded from the run.
 */

/**
 * Compares the locations of two objects in a source file
 * @param {Locatable} itemA The first object
 * @param {Locatable} itemB The second object
 * @returns {number} A value less than 1 if itemA appears before itemB in the source file, greater than 1 if
 * itemA appears after itemB in the source file, or 0 if itemA and itemB have the same location.
 */
function compareLocations(itemA, itemB) {
	return itemA.line - itemB.line || itemA.column - itemB.column;
}

/**
 * Groups a set of directives into sub-arrays by their parent comment.
 * @param {Iterable<ProcessedDirective>} directives Unused directives to be removed.
 * @returns {Array<Array<ProcessedDirective>>} Directives grouped by their parent comment.
 */
function groupByParentDirective(directives) {
	/** @type {Map<ParentDirective, Array<ProcessedDirective>>} */
	const groups = new Map();

	for (const directive of directives) {
		const {
			unprocessedDirective: { parentDirective },
		} = directive;

		if (groups.has(parentDirective)) {
			// Sound: guarded by the `has()` check on the line above.
			/** @type {Array<ProcessedDirective>} */ (
				groups.get(parentDirective)
			).push(directive);
		} else {
			groups.set(parentDirective, [directive]);
		}
	}

	return [...groups.values()];
}

/**
 * Creates removal details for a set of directives within the same comment.
 * @param {Array<ProcessedDirective>} directives Unused directives to be removed.
 * @param {ParentDirective} parentDirective Data about the backing directive.
 * @param {DirectiveSourceCode} sourceCode The source code object for the file being linted.
 * @returns {Array<DirectiveRemoval>} Details for later creation of output Problems.
 */
function createIndividualDirectivesRemoval(
	directives,
	parentDirective,
	sourceCode,
) {
	/*
	 * Get the list of the rules text without any surrounding whitespace. In order to preserve the original
	 * formatting, we don't want to change that whitespace.
	 *
	 *     // eslint-disable-line rule-one , rule-two , rule-three -- comment
	 *                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
	 */
	const listText = parentDirective.value.trim();

	// Calculate where it starts in the source code text
	const listStart = sourceCode.text.indexOf(
		listText,
		sourceCode.getRange(parentDirective.node)[0],
	);

	/*
	 * We can assume that `listText` contains multiple elements.
	 * Otherwise, this function wouldn't be called - if there is
	 * only one rule in the list, then the whole comment must be removed.
	 */

	return directives.map(directive => {
		const { ruleId } = directive;

		/*
		 * This function only runs when the comment names more than one rule,
		 * which means every directive in the group carries a real rule ID.
		 */
		const regex = new RegExp(
			String.raw`(?:^|\s*,\s*)(?<quote>['"]?)${escapeRegExp(/** @type {string} */ (ruleId))}\k<quote>(?:\s*,\s*|$)`,
			"u",
		);
		/*
		 * The comment is known to name this rule — that is how the directive
		 * came to exist — so the pattern always matches.
		 */
		const match = /** @type {RegExpExecArray} */ (regex.exec(listText));
		const matchedText = match[0];
		const matchStart = listStart + match.index;
		const matchEnd = matchStart + matchedText.length;

		const firstIndexOfComma = matchedText.indexOf(",");
		const lastIndexOfComma = matchedText.lastIndexOf(",");

		let removalStart, removalEnd;

		if (firstIndexOfComma !== lastIndexOfComma) {
			/*
			 * Since there are two commas, this must one of the elements in the middle of the list.
			 * Matched range starts where the previous rule name ends, and ends where the next rule name starts.
			 *
			 *     // eslint-disable-line rule-one , rule-two , rule-three -- comment
			 *                                    ^^^^^^^^^^^^^^
			 *
			 * We want to remove only the content between the two commas, and also one of the commas.
			 *
			 *     // eslint-disable-line rule-one , rule-two , rule-three -- comment
			 *                                     ^^^^^^^^^^^
			 */
			removalStart = matchStart + firstIndexOfComma;
			removalEnd = matchStart + lastIndexOfComma;
		} else {
			/*
			 * This is either the first element or the last element.
			 *
			 * If this is the first element, matched range starts where the first rule name starts
			 * and ends where the second rule name starts. This is exactly the range we want
			 * to remove so that the second rule name will start where the first one was starting
			 * and thus preserve the original formatting.
			 *
			 *     // eslint-disable-line rule-one , rule-two , rule-three -- comment
			 *                            ^^^^^^^^^^^
			 *
			 * Similarly, if this is the last element, we've already matched the range we want to
			 * remove. The previous rule name will end where the last one was ending, relative
			 * to the content on the right side.
			 *
			 *     // eslint-disable-line rule-one , rule-two , rule-three -- comment
			 *                                               ^^^^^^^^^^^^^
			 */
			removalStart = matchStart;
			removalEnd = matchEnd;
		}

		return {
			description: `'${ruleId}'`,
			fix: {
				range: /** @type {Range} */ ([removalStart, removalEnd]),
				text: "",
			},
			unprocessedDirective: directive.unprocessedDirective,
		};
	});
}

/**
 * Creates a description of deleting an entire unused disable directive.
 * @param {Array<ProcessedDirective>} directives Unused directives to be removed.
 * @param {Comment} node The backing Comment token.
 * @param {DirectiveSourceCode} sourceCode The source code object for the file being linted.
 * @returns {DirectiveRemoval} Details for later creation of an output problem.
 */
function createDirectiveRemoval(directives, node, sourceCode) {
	const range = sourceCode.getRange(node);
	const ruleIds = directives
		.filter(directive => directive.ruleId)
		.map(directive => `'${directive.ruleId}'`);

	return {
		description:
			ruleIds.length <= 2
				? ruleIds.join(" or ")
				: `${ruleIds.slice(0, ruleIds.length - 1).join(", ")}, or ${ruleIds.at(-1)}`,
		fix: {
			range,
			text: " ",
		},
		unprocessedDirective: directives[0].unprocessedDirective,
	};
}

/**
 * Parses details from directives to create output Problems.
 * @param {Iterable<ProcessedDirective>} allDirectives Unused directives to be removed.
 * @param {DirectiveSourceCode} sourceCode The source code object for the file being linted.
 * @returns {Array<DirectiveRemoval>} Details for later creation of output Problems.
 */
function processUnusedDirectives(allDirectives, sourceCode) {
	const directiveGroups = groupByParentDirective(allDirectives);

	return directiveGroups.flatMap(directives => {
		const { parentDirective } = directives[0].unprocessedDirective;
		/*
		 * Widened because a directive's `ruleId` is `null` when its comment
		 * named no rules; deleting one is then simply a miss.
		 */
		const remainingRuleIds = new Set(
			/** @type {Array<string | null>} */ (parentDirective.ruleIds),
		);

		for (const directive of directives) {
			remainingRuleIds.delete(directive.ruleId);
		}

		return remainingRuleIds.size
			? createIndividualDirectivesRemoval(
					directives,
					parentDirective,
					sourceCode,
				)
			: [
					createDirectiveRemoval(
						directives,
						parentDirective.node,
						sourceCode,
					),
				];
	});
}

/**
 * Collect eslint-enable comments that are removing suppressions by eslint-disable comments.
 * @param {Array<ProcessedDirective>} directives The directives to check.
 * @returns {Set<ProcessedDirective>} The used eslint-enable comments
 */
function collectUsedEnableDirectives(directives) {
	/**
	 * A Map of `eslint-enable` keyed by ruleIds that may be marked as used.
	 * If `eslint-enable` does not have a ruleId, the key will be `null`.
	 * @type {Map<string | null, ProcessedDirective>}
	 */
	const enabledRules = new Map();

	/**
	 * A Set of `eslint-enable` marked as used.
	 * It is also the return value of `collectUsedEnableDirectives` function.
	 * @type {Set<ProcessedDirective>}
	 */
	const usedEnableDirectives = new Set();

	/*
	 * Checks the directives backwards to see if the encountered `eslint-enable` is used by the previous `eslint-disable`,
	 * and if so, stores the `eslint-enable` in `usedEnableDirectives`.
	 */
	for (let index = directives.length - 1; index >= 0; index--) {
		const directive = directives[index];

		if (directive.type === "disable") {
			if (enabledRules.size === 0) {
				continue;
			}
			if (directive.ruleId === null) {
				// If encounter `eslint-disable` without ruleId,
				// mark all `eslint-enable` currently held in enabledRules as used.
				// e.g.
				//    /* eslint-disable */ <- current directive
				//    /* eslint-enable rule-id1 */ <- used
				//    /* eslint-enable rule-id2 */ <- used
				//    /* eslint-enable */ <- used
				for (const enableDirective of enabledRules.values()) {
					usedEnableDirectives.add(enableDirective);
				}
				enabledRules.clear();
			} else {
				const enableDirective = enabledRules.get(directive.ruleId);

				if (enableDirective) {
					// If encounter `eslint-disable` with ruleId, and there is an `eslint-enable` with the same ruleId in enabledRules,
					// mark `eslint-enable` with ruleId as used.
					// e.g.
					//    /* eslint-disable rule-id */ <- current directive
					//    /* eslint-enable rule-id */ <- used
					usedEnableDirectives.add(enableDirective);
				} else {
					const enabledDirectiveWithoutRuleId =
						enabledRules.get(null);

					if (enabledDirectiveWithoutRuleId) {
						// If encounter `eslint-disable` with ruleId, and there is no `eslint-enable` with the same ruleId in enabledRules,
						// mark `eslint-enable` without ruleId as used.
						// e.g.
						//    /* eslint-disable rule-id */ <- current directive
						//    /* eslint-enable */ <- used
						usedEnableDirectives.add(enabledDirectiveWithoutRuleId);
					}
				}
			}
		} else if (directive.type === "enable") {
			if (directive.ruleId === null) {
				// If encounter `eslint-enable` without ruleId, the `eslint-enable` that follows it are unused.
				// So clear enabledRules.
				// e.g.
				//    /* eslint-enable */ <- current directive
				//    /* eslint-enable rule-id *// <- unused
				//    /* eslint-enable */ <- unused
				enabledRules.clear();
				enabledRules.set(null, directive);
			} else {
				enabledRules.set(directive.ruleId, directive);
			}
		}
	}
	return usedEnableDirectives;
}

/**
 * This is the same as the exported function, except that it
 * doesn't handle disable-line and disable-next-line directives, and it always reports unused
 * disable directives.
 * @param {ApplyDirectivesOptions} options options for applying directives. This is the same as the options
 * for the exported function, except that `reportUnusedDisableDirectives` is not supported
 * (this function always reports unused disable directives).
 * @returns {{ problems: Array<LintMessage>, unusedDirectives: Array<LintMessage> }} An object with a list
 * of problems (including suppressed ones) and unused eslint-disable directives
 */
function applyDirectives(options) {
	/** @type {Array<LintMessage>} */
	const problems = [];

	/** @type {Set<ProcessedDirective>} */
	const usedDisableDirectives = new Set();
	const { sourceCode } = options;

	for (const problem of options.problems) {
		/** @type {Array<ProcessedDirective>} */
		let disableDirectivesForProblem = [];
		let nextDirectiveIndex = 0;

		while (
			nextDirectiveIndex < options.directives.length &&
			compareLocations(options.directives[nextDirectiveIndex], problem) <=
				0
		) {
			const directive = options.directives[nextDirectiveIndex++];

			if (
				directive.ruleId === null ||
				directive.ruleId === problem.ruleId
			) {
				switch (directive.type) {
					case "disable":
						disableDirectivesForProblem.push(directive);
						break;

					case "enable":
						disableDirectivesForProblem = [];
						break;

					// no default
				}
			}
		}

		if (disableDirectivesForProblem.length > 0) {
			const suppressions = disableDirectivesForProblem.map(directive => ({
				kind: /** @type {const} */ ("directive"),
				justification: directive.unprocessedDirective.justification,
			}));

			/*
			 * `suppressions` is not declared on `LintMessage` — it is what
			 * turns one into a `SuppressedLintMessage` downstream.
			 */
			const suppressed =
				/** @type {import("../shared/types.js").SuppressedLintMessage} */ (
					problem
				);

			if (suppressed.suppressions) {
				suppressed.suppressions =
					suppressed.suppressions.concat(suppressions);
			} else {
				suppressed.suppressions = suppressions;

				// Non-empty by the length check above, so `at(-1)` is present.
				usedDisableDirectives.add(
					/** @type {ProcessedDirective} */ (
						disableDirectivesForProblem.at(-1)
					),
				);
			}
		}

		problems.push(problem);
	}

	const unusedDisableDirectivesToReport = options.directives.filter(
		directive =>
			directive.type === "disable" &&
			!usedDisableDirectives.has(directive) &&
			!options.rulesToIgnore.has(directive.ruleId),
	);

	const unusedEnableDirectivesToReport = new Set(
		options.directives.filter(
			directive =>
				directive.unprocessedDirective.type === "enable" &&
				!options.rulesToIgnore.has(directive.ruleId),
		),
	);

	/*
	 * If directives has the eslint-enable directive,
	 * check whether the eslint-enable comment is used.
	 */
	if (unusedEnableDirectivesToReport.size > 0) {
		for (const directive of collectUsedEnableDirectives(
			options.directives,
		)) {
			unusedEnableDirectivesToReport.delete(directive);
		}
	}

	const processed = processUnusedDirectives(
		unusedDisableDirectivesToReport,
		sourceCode,
	).concat(
		processUnusedDirectives(unusedEnableDirectivesToReport, sourceCode),
	);
	const columnOffset = options.language.columnStart === 1 ? 0 : 1;
	const lineOffset = options.language.lineStart === 1 ? 0 : 1;

	const unusedDirectives = processed.map(
		({ description, fix, unprocessedDirective }) => {
			const { parentDirective, type, line, column } =
				unprocessedDirective;

			let message;

			if (type === "enable") {
				message = description
					? `Unused eslint-enable directive (no matching eslint-disable directives were found for ${description}).`
					: "Unused eslint-enable directive (no matching eslint-disable directives were found).";
			} else {
				message = description
					? `Unused eslint-disable directive (no problems were reported from ${description}).`
					: "Unused eslint-disable directive (no problems were reported).";
			}

			const loc = sourceCode.getLoc(parentDirective.node);

			return {
				ruleId: null,
				message,
				line:
					type === "disable-next-line"
						? loc.start.line + lineOffset
						: line,
				column:
					type === "disable-next-line"
						? loc.start.column + columnOffset
						: column,
				severity: /** @type {import("../shared/types.js").Severity} */ (
					options.reportUnusedDisableDirectives === "warn" ? 1 : 2
				),
				...(options.disableFixes ? {} : { fix }),
			};
		},
	);

	return { problems, unusedDirectives };
}

/**
 * Given a list of directive comments (i.e. metadata about eslint-disable and eslint-enable comments) and a list
 * of reported problems, adds the suppression information to the problems.
 * @param {Object} options Information about directives and problems
 * @param {DirectiveLanguage} options.language The language being linted.
 * @param {DirectiveSourceCode} options.sourceCode The source code object for the file being linted.
 * @param {Array<UnprocessedDirective>} options.directives Directive comments found in the file, with one-based columns.
 * Two directive comments can only have the same location if they also have the same type (e.g. a single eslint-disable
 * comment for two different rules is represented as two directives).
 * @param {Array<LintMessage>} options.problems
 * A list of problems reported by rules, sorted by increasing location in the file, with one-based columns.
 * @param {ReportUnusedDisableDirectivesOption} [options.reportUnusedDisableDirectives] If `"warn"` or `"error"`, adds additional problems for unused directives
 * @param {Record<string, unknown>} [options.configuredRules] The rules configuration.
 * @param {(rule: { ruleId: string, severity: number }) => boolean} [options.ruleFilter] A predicate function to filter which rules should be executed.
 * @param {boolean} [options.disableFixes] If true, it doesn't make `fix` properties.
 * @returns {Array<LintMessage>}
 * An object with a list of reported problems, the suppressed of which contain the suppression information.
 */
module.exports = ({
	language,
	sourceCode,
	directives,
	disableFixes,
	problems,
	configuredRules,
	ruleFilter,
	reportUnusedDisableDirectives = "off",
}) => {
	const blockDirectives = directives
		.filter(
			directive =>
				directive.type === "disable" || directive.type === "enable",
		)
		.map(
			directive =>
				/** @type {ProcessedDirective} */ (
					Object.assign({}, directive, {
						unprocessedDirective: directive,
					})
				),
		)
		.sort(compareLocations);

	const lineDirectives = directives
		.flatMap(directive => {
			/*
			 * Each `disable-line` / `disable-next-line` expands into the
			 * `disable`/`enable` pair that brackets the line it covers.
			 */
			const expanded = /** @type {Array<ProcessedDirective>} */ ([]);

			switch (directive.type) {
				case "disable":
				case "enable":
					break;

				case "disable-line":
					expanded.push(
						{
							type: "disable",
							line: directive.line,
							column: 1,
							ruleId: directive.ruleId,
							unprocessedDirective: directive,
						},
						{
							type: "enable",
							line: directive.line + 1,
							column: 0,
							ruleId: directive.ruleId,
							unprocessedDirective: directive,
						},
					);
					break;

				case "disable-next-line":
					expanded.push(
						{
							type: "disable",
							line: directive.line + 1,
							column: 1,
							ruleId: directive.ruleId,
							unprocessedDirective: directive,
						},
						{
							type: "enable",
							line: directive.line + 2,
							column: 0,
							ruleId: directive.ruleId,
							unprocessedDirective: directive,
						},
					);
					break;

				default:
					throw new TypeError(
						`Unrecognized directive type '${directive.type}'`,
					);
			}

			return expanded;
		})
		.sort(compareLocations);

	// This determines a list of rules that are not being run by the given ruleFilter, if present.
	const /** @type {Set<string | null>} */ rulesToIgnore =
			configuredRules && ruleFilter
				? new Set(
						Object.keys(configuredRules).filter(ruleId => {
							const severity = Config.getRuleNumericSeverity(
								configuredRules[ruleId],
							);

							// Ignore for disabled rules.
							if (severity === 0) {
								return false;
							}

							return !ruleFilter({ severity, ruleId });
						}),
					)
				: new Set();

	// If no ruleId is supplied that means this directive is applied to all rules, so we can't determine if it's unused if any rules are filtered out.
	if (rulesToIgnore.size > 0) {
		rulesToIgnore.add(null);
	}

	const blockDirectivesResult = applyDirectives({
		language,
		sourceCode,
		problems,
		directives: blockDirectives,
		disableFixes,
		reportUnusedDisableDirectives,
		rulesToIgnore,
	});
	const lineDirectivesResult = applyDirectives({
		language,
		sourceCode,
		problems: blockDirectivesResult.problems,
		directives: lineDirectives,
		disableFixes,
		reportUnusedDisableDirectives,
		rulesToIgnore,
	});

	return reportUnusedDisableDirectives !== "off"
		? lineDirectivesResult.problems
				.concat(blockDirectivesResult.unusedDirectives)
				.concat(lineDirectivesResult.unusedDirectives)
				.sort(compareLocations)
		: lineDirectivesResult.problems;
};

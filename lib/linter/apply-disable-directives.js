// @ts-check
/**
 * @fileoverview A module that filters reported problems based on `eslint-disable` and `eslint-enable` comments
 * @author Teddy Katz
 */

"use strict";

//------------------------------------------------------------------------------
// Module Definition
//------------------------------------------------------------------------------

const escapeRegExp = require("escape-string-regexp");
const { Config } = require("../config/config.js");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").EditInfo} EditInfo */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../shared/types.js").ReportedSeverity} ReportedSeverity */
/** @typedef {import("../shared/types.js").RulesConfig} RulesConfig */
/** @typedef {import("../shared/types.js").SuppressionInfo} SuppressionInfo */
/** @typedef {import("./esquery").ASTNode} ASTNode */
/** @typedef {import("@eslint/core").DirectiveType} DirectiveType */

/**
 * The comment a group of directives was written in. One comment can name
 * several rules, which become one directive each.
 * @typedef {Object} ParentDirective
 * @property {ASTNode} node The comment node or token the directive was written in.
 * @property {string} value The text following the directive keyword.
 * @property {string[]} ruleIds The rule IDs the comment names, empty when it names none.
 */

/**
 * A single directive, as `lib/linter/linter.js` builds them: one per rule named
 * by a directive comment, or one with a `null` `ruleId` for a comment that
 * names no rule and so applies to every rule.
 * @typedef {Object} Directive
 * @property {ParentDirective} parentDirective The comment this directive came from.
 * @property {DirectiveType} type The kind of directive.
 * @property {number} line The one-based line the directive takes effect on.
 * @property {number} column The one-based column the directive takes effect on.
 * @property {string | null} ruleId The rule the directive applies to, or `null` for all rules.
 * @property {string} [justification] The justification written after `--`.
 */

/**
 * A directive after `disable-line` and `disable-next-line` have been rewritten
 * into the equivalent `disable`/`enable` pair, carrying a back-reference to the
 * directive it was derived from.
 * @typedef {Object} ProcessedDirective
 * @property {Directive} unprocessedDirective The directive this was derived from.
 * @property {DirectiveType} type The kind of directive.
 * @property {number} line The one-based line the directive takes effect on.
 * @property {number} column The one-based column the directive takes effect on.
 * @property {string | null} ruleId The rule the directive applies to, or `null` for all rules.
 */

/**
 * Anything carrying a one-based source position, which is all
 * `compareLocations()` needs. Both are optional because a reported problem need
 * not have a position.
 * @typedef {{ line?: number, column?: number }} Located
 */

/**
 * A reported problem as this module handles it: a lint message that may already
 * carry suppressions, and that this module may add more to.
 * @typedef {LintMessage & { suppressions?: SuppressionInfo[] }} SuppressibleLintMessage
 */

/**
 * How an unused directive should be reported. `lib/linter/linter.js`
 * normalizes the config's severity to one of these three strings before
 * calling in.
 * @typedef {"off" | "warn" | "error"} UnusedDirectiveSeverity
 */

/**
 * What a directive removal needs to become a reportable problem.
 * @typedef {Object} DirectiveRemoval
 * @property {string} description The quoted rule IDs the removal covers, or the empty string.
 * @property {EditInfo} fix The edit that removes the directive, or the part of it that is unused.
 * @property {Directive} unprocessedDirective The directive being removed.
 */

/**
 * The members of a language object this module reads, which are only the
 * one-versus-zero-based position conventions.
 * @typedef {Object} DirectiveLanguage
 * @property {number} [columnStart] The first column number of a line.
 * @property {number} [lineStart] The first line number of a file.
 */

/**
 * The part of a source code object this module reads. Declared narrowly rather
 * than naming a language's source code class, since directives are not
 * JavaScript-specific.
 * @typedef {Object} DirectiveSourceCode
 * @property {string} text The full source text.
 * @property {(nodeOrToken: ASTNode) => [number, number]} getRange Returns the range of a node or token.
 * @property {(nodeOrToken: ASTNode) => { start: { line: number, column: number }, end: { line: number, column: number } }} getLoc Returns the location of a node or token.
 */

/**
 * The options `applyDirectives()` takes, which are the exported function's
 * minus `configuredRules`/`ruleFilter` and plus the resolved `rulesToIgnore`.
 * @typedef {Object} ApplyDirectivesOptions
 * @property {DirectiveLanguage} language The language being linted.
 * @property {DirectiveSourceCode} sourceCode The source code object for the file being linted.
 * @property {ProcessedDirective[]} directives The directives to apply, sorted by location.
 * @property {SuppressibleLintMessage[]} problems The problems reported by rules, sorted by location.
 * @property {UnusedDirectiveSeverity} reportUnusedDisableDirectives How to report an unused directive.
 * @property {boolean} [disableFixes] `true` to omit the `fix` property from reported problems.
 * @property {Set<string | null>} rulesToIgnore The rules a `ruleFilter` excluded from this run.
 */

/**
 * Compares the locations of two objects in a source file
 * @param {Located} itemA The first object
 * @param {Located} itemB The second object
 * @returns {number} A value less than 1 if itemA appears before itemB in the source file, greater than 1 if
 * itemA appears after itemB in the source file, or 0 if itemA and itemB have the same location.
 */
function compareLocations(itemA, itemB) {
	/*
	 * A reported problem need not carry a position, and subtracting an absent
	 * one gives `NaN`, which `sort()` treats as "equal" and `||` falls through.
	 * The defaults state that rather than change the ordering.
	 */
	return (
		(itemA.line ?? NaN) - (itemB.line ?? NaN) ||
		(itemA.column ?? NaN) - (itemB.column ?? NaN)
	);
}

/**
 * Groups a set of directives into sub-arrays by their parent comment.
 * @param {Iterable<ProcessedDirective>} directives Unused directives to be removed.
 * @returns {ProcessedDirective[][]} Directives grouped by their parent comment.
 */
function groupByParentDirective(directives) {
	/** @type {Map<ParentDirective, ProcessedDirective[]>} */
	const groups = new Map();

	for (const directive of directives) {
		const {
			unprocessedDirective: { parentDirective },
		} = directive;

		if (groups.has(parentDirective)) {
			// Guarded by `has()`, which `Map#get`'s type cannot express.
			/** @type {ProcessedDirective[]} */ (
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
 * @param {ProcessedDirective[]} directives Unused directives to be removed.
 * @param {ParentDirective} parentDirective Data about the backing directive.
 * @param {DirectiveSourceCode} sourceCode The source code object for the file being linted.
 * @returns {DirectiveRemoval[]} Details for later creation of output Problems.
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
		/*
		 * This function is only reached for a comment naming more than one
		 * rule, so each directive in the group names one of them and the
		 * `null` that stands for "every rule" is not reachable here.
		 */
		const ruleId = /** @type {string} */ (directive.ruleId);

		const regex = new RegExp(
			String.raw`(?:^|\s*,\s*)(?<quote>['"]?)${escapeRegExp(ruleId)}\k<quote>(?:\s*,\s*|$)`,
			"u",
		);
		/*
		 * `listText` is known to name this rule, as the directive was built
		 * from it, so the match is never `null` — which `exec()`'s type
		 * cannot express.
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
				range: [removalStart, removalEnd],
				text: "",
			},
			unprocessedDirective: directive.unprocessedDirective,
		};
	});
}

/**
 * Creates a description of deleting an entire unused disable directive.
 * @param {ProcessedDirective[]} directives Unused directives to be removed.
 * @param {ASTNode} node The backing Comment token.
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
 * @returns {DirectiveRemoval[]} Details for later creation of output Problems.
 */
function processUnusedDirectives(allDirectives, sourceCode) {
	const directiveGroups = groupByParentDirective(allDirectives);

	return directiveGroups.flatMap(directives => {
		const { parentDirective } = directives[0].unprocessedDirective;

		/*
		 * Widened past the comment's own rule IDs because a directive naming
		 * no rule carries a `null` `ruleId`, and deleting it below is a
		 * deliberate no-op.
		 */
		/** @type {Set<string | null>} */
		const remainingRuleIds = new Set(parentDirective.ruleIds);

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
 * @param {ProcessedDirective[]} directives The directives to check.
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
 * @returns {{ problems: SuppressibleLintMessage[], unusedDirectives: LintMessage[] }} An object with a list
 * of problems (including suppressed ones) and unused eslint-disable directives
 */
function applyDirectives(options) {
	/** @type {SuppressibleLintMessage[]} */
	const problems = [];

	/** @type {Set<ProcessedDirective>} */
	const usedDisableDirectives = new Set();
	const { sourceCode } = options;

	for (const problem of options.problems) {
		/** @type {ProcessedDirective[]} */
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
			/** @type {SuppressionInfo[]} */
			const suppressions = disableDirectivesForProblem.map(directive => ({
				kind: "directive",
				/*
				 * `@eslint/core`'s `Directive` leaves this optional, while a
				 * recorded `SuppressionInfo` declares it a string. Every
				 * directive the linter builds carries one —
				 * `@eslint/plugin-kit`'s parser defaults it to the empty
				 * string — so the value is asserted rather than defaulted
				 * here, which would change what a custom language sees.
				 */
				justification: /** @type {string} */ (
					directive.unprocessedDirective.justification
				),
			}));

			if (problem.suppressions) {
				problem.suppressions =
					problem.suppressions.concat(suppressions);
			} else {
				problem.suppressions = suppressions;

				/*
				 * The array is non-empty inside this branch, which `at()`'s
				 * type cannot express.
				 */
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
				severity: /** @type {ReportedSeverity} */ (
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
 * @param {object} options Information about directives and problems
 * @param {DirectiveLanguage} options.language The language being linted.
 * @param {DirectiveSourceCode} options.sourceCode The source code object for the file being linted.
 * @param {Directive[]} options.directives Directive comments found in the file, with one-based columns.
 * Two directive comments can only have the same location if they also have the same type (e.g. a single eslint-disable
 * comment for two different rules is represented as two directives).
 * @param {SuppressibleLintMessage[]} options.problems
 * A list of problems reported by rules, sorted by increasing location in the file, with one-based columns.
 * @param {UnusedDirectiveSeverity} [options.reportUnusedDisableDirectives] If `"warn"` or `"error"`, adds additional problems for unused directives
 * @param {RulesConfig} [options.configuredRules] The rules configuration.
 * @param {(descriptor: { ruleId: string, severity: number }) => boolean} [options.ruleFilter] A predicate function to filter which rules should be executed.
 * @param {boolean} [options.disableFixes] If true, it doesn't make `fix` properties.
 * @returns {SuppressibleLintMessage[]}
 * An object with a list of reported problems, the suppressed of which contain the suppression information.
 * @throws {TypeError} If a directive has an unrecognized type.
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
		.map(directive =>
			Object.assign({}, directive, { unprocessedDirective: directive }),
		)
		.sort(compareLocations);

	const lineDirectives = directives
		.flatMap(
			/**
			 * Rewrites a line-scoped directive into the equivalent
			 * `disable`/`enable` pair.
			 * @param {Directive} directive The directive to rewrite.
			 * @returns {ProcessedDirective[]} The pair, or nothing for a
			 * directive that is already block-scoped.
			 * @throws {TypeError} If the directive type is unrecognized.
			 */
			directive => {
				switch (directive.type) {
					case "disable":
					case "enable":
						return [];

					case "disable-line":
						return [
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
						];

					case "disable-next-line":
						return [
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
						];

					default:
						throw new TypeError(
							`Unrecognized directive type '${directive.type}'`,
						);
				}
			},
		)
		.sort(compareLocations);

	// This determines a list of rules that are not being run by the given ruleFilter, if present.
	const rulesToIgnore =
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

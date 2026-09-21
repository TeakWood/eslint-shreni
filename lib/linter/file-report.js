/**
 * @fileoverview A class to track messages reported by the linter for a file.
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("../shared/assert");
const { RuleFixer } = require("./rule-fixer");
const { interpolate } = require("./interpolate");
const ruleReplacements = require("../../conf/replacements.json");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").EditInfo} EditInfo */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../shared/types.js").NodeOrToken} NodeOrToken */
/** @typedef {import("../shared/types.js").Position} Position */
/** @typedef {import("../shared/types.js").Range} Range */
/** @typedef {import("../shared/types.js").RuleModule} RuleModule */
/** @typedef {import("../shared/types.js").Severity} Severity */
/** @typedef {import("../shared/types.js").SourceLocation} SourceLocation */
/** @typedef {import("../shared/types.js").SuggestionResult} SuggestionResult */

/**
 * Resolves a rule ID to its definition, or to nothing when the rule is unknown.
 * @typedef {(ruleId: string) => RuleModule | null | undefined} RuleMapper
 */

/**
 * The loose node shape the linter hands around, shared with the rules layer.
 * @typedef {import("../rules/utils/ast-utils.js").ASTNode} ASTNode
 */

/**
 * The slice of a `Language` object this module reads to normalize positions.
 * @typedef {Object} ReportLanguage
 * @property {number} [columnStart] The first column number the language uses, either `0` or `1`.
 * @property {number} [lineStart] The first line number the language uses, either `0` or `1`.
 */

/**
 * The slice of a source code object this module reads.
 * @typedef {Object} ReportSourceCode
 * @property {string} text The full source text of the file.
 * @property {(nodeOrToken: NodeOrToken) => Range} getRange Returns the range of the given node or token.
 * @property {(nodeOrToken: NodeOrToken) => SourceLocation} getLoc Returns the location of the given node or token.
 */

/**
 * A rule's `fix` callback. It may return one edit, several, or nothing at all.
 * @typedef {(fixer: RuleFixer) => EditInfo | Iterable<EditInfo> | null | undefined} FixFunction
 */

/**
 * One entry of a report descriptor's `suggest` array.
 * @typedef {Object} SuggestionDescriptor
 * @property {string} [desc] The literal description of the suggestion.
 * @property {string} [messageId] The ID of the description in the rule's `meta.messages`.
 * @property {Record<string, string>} [data] The placeholder values for the description.
 * @property {FixFunction} [fix] The edit the suggestion applies.
 */

/**
 * The object form of a `context.report()` argument, after the multi-argument
 * form has been normalized away.
 * @typedef {Object} ReportDescriptor
 * @property {ASTNode} [node] The node the problem is reported on.
 * @property {SourceLocation | Position} [loc] An explicit location, which wins over `node`.
 * @property {string} [message] The literal message to report.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {Record<string, string>} [data] The placeholder values for the message.
 * @property {FixFunction} [fix] The edit that fixes the problem.
 * @property {Array<SuggestionDescriptor>} [suggest] The suggested, non-automatic fixes.
 */

/**
 * A report location after normalization. `end` is `null` when the reporter gave
 * a bare position rather than a start/end pair.
 * @typedef {Object} NormalizedReportLoc
 * @property {Position} start The start position.
 * @property {Position | null} end The end position, when one is known.
 */

/**
 * The descriptor the linter itself (rather than a rule) reports with.
 * @typedef {Object} LintingProblemDescriptor
 * @property {string | null} [ruleId] The rule the problem concerns.
 * @property {SourceLocation} [loc] The location of the problem.
 * @property {string} [message] The message, defaulting to a missing-rule message.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/** @type {SourceLocation} */
const DEFAULT_ERROR_LOC = {
	start: { line: 1, column: 0 },
	end: { line: 1, column: 1 },
};

/**
 * Updates a given location based on the language offsets. This allows us to
 * change 0-based locations to 1-based locations. We always want ESLint
 * reporting lines and columns starting from 1.
 * @todo Potentially this should be moved into a shared utility file.
 * @param {Object} location The location to update.
 * @param {number} location.line The starting line number.
 * @param {number} location.column The starting column number.
 * @param {number} [location.endLine] The ending line number.
 * @param {number} [location.endColumn] The ending column number.
 * @param {ReportLanguage} language The language to use to adjust the location information.
 * @returns {{ line: number, column: number, endLine: number | undefined, endColumn: number | undefined }} The updated location.
 */
function updateLocationInformation(
	{ line, column, endLine, endColumn },
	language,
) {
	const columnOffset = language.columnStart === 1 ? 0 : 1;
	const lineOffset = language.lineStart === 1 ? 0 : 1;

	// calculate separately to account for undefined
	const finalEndLine = endLine === void 0 ? endLine : endLine + lineOffset;
	const finalEndColumn =
		endColumn === void 0 ? endColumn : endColumn + columnOffset;

	return {
		line: line + lineOffset,
		column: column + columnOffset,
		endLine: finalEndLine,
		endColumn: finalEndColumn,
	};
}

/**
 * creates a missing-rule message.
 * @param {string} ruleId the ruleId to create
 * @returns {string} created error message
 * @private
 */
function createMissingRuleMessage(ruleId) {
	/*
	 * The JSON is imported as a wide object literal type; every value under
	 * `rules` is a list of the rule IDs that replaced the removed rule.
	 */
	const replacementRules = /** @type {Record<string, Array<string>>} */ (
		ruleReplacements.rules
	);

	return Object.hasOwn(replacementRules, ruleId)
		? `Rule '${ruleId}' was removed and replaced by: ${replacementRules[ruleId].join(", ")}`
		: `Definition for rule '${ruleId}' was not found.`;
}

/**
 * creates a linting problem
 * @param {LintingProblemDescriptor} options to create linting error
 * @param {Severity} severity the error message to report
 * @param {ReportLanguage} language the language to use to adjust the location information.
 * @returns {LintMessage} created problem, returns a missing-rule problem if only provided ruleId.
 * @private
 */
function createLintingProblem(options, severity, language) {
	const {
		ruleId = null,
		loc = DEFAULT_ERROR_LOC,

		/*
		 * Defaulting only happens when no message was given, and every such
		 * call site reports a rule that could not be found.
		 */
		message = createMissingRuleMessage(
			/** @type {string} */ (options.ruleId),
		),
	} = options;

	return {
		ruleId,
		message,
		...updateLocationInformation(
			{
				line: loc.start.line,
				column: loc.start.column,
				endLine: loc.end.line,
				endColumn: loc.end.column,
			},
			language,
		),
		severity,
	};
}

/**
 * Translates a multi-argument context.report() call into a single object argument call
 * @param {...any} args A list of arguments passed to `context.report`
 * @returns {ReportDescriptor} A normalized object containing report information
 */
function normalizeMultiArgReportCall(...args) {
	// If there is one argument, it is considered to be a new-style call already.
	if (args.length === 1) {
		// Shallow clone the object to avoid surprises if reusing the descriptor
		return Object.assign({}, args[0]);
	}

	// If the second argument is a string, the arguments are interpreted as [node, message, data, fix].
	if (typeof args[1] === "string") {
		return {
			node: args[0],
			message: args[1],
			data: args[2],
			fix: args[3],
		};
	}

	// Otherwise, the arguments are interpreted as [node, loc, message, data, fix].
	return {
		node: args[0],
		loc: args[1],
		message: args[2],
		data: args[3],
		fix: args[4],
	};
}

/**
 * Asserts that either a loc or a node was provided, and the node is valid if it was provided.
 * @param {ReportDescriptor} descriptor A descriptor to validate
 * @returns {void}
 * @throws {Error} AssertionError if neither a node nor a loc was provided, or if the node is not an object
 */
function assertValidNodeInfo(descriptor) {
	if (descriptor.node) {
		assert(typeof descriptor.node === "object", "Node must be an object");
	} else {
		assert(
			descriptor.loc,
			"Node must be provided when reporting error if location is not provided",
		);
	}
}

/**
 * Normalizes a MessageDescriptor to always have a `loc` with `start` and `end` properties
 * @param {ReportDescriptor} descriptor A descriptor for the report from a rule.
 * @returns {NormalizedReportLoc} An updated location that infers the `start` and `end` properties
 * from the `node` of the original descriptor, or infers the `start` from the `loc` of the original descriptor.
 */
function normalizeReportLoc(descriptor) {
	/*
	 * Only called when `descriptor.loc` is present. The `start` probe is what
	 * tells the two accepted shapes apart at runtime.
	 */
	const loc = /** @type {SourceLocation & Position} */ (descriptor.loc);

	if (loc.start) {
		return loc;
	}
	return { start: loc, end: null };
}

/**
 * Clones the given fix object.
 * @param {EditInfo | null | undefined} fix The fix to clone.
 * @returns {EditInfo | null} Deep cloned fix object or `null` if `null` or `undefined` was passed in.
 */
function cloneFix(fix) {
	if (!fix) {
		return null;
	}

	return {
		range: /** @type {Range} */ ([fix.range[0], fix.range[1]]),
		text: fix.text,
	};
}

/**
 * Check that a fix has a valid range.
 * @param {EditInfo | null | undefined} fix The fix to validate.
 * @returns {void}
 */
function assertValidFix(fix) {
	if (fix) {
		assert(
			fix.range &&
				typeof fix.range[0] === "number" &&
				typeof fix.range[1] === "number",
			`Fix has invalid range: ${JSON.stringify(fix, null, 2)}`,
		);
	}
}

/**
 * Compares items in a fixes array by range.
 * @param {EditInfo} a The first message.
 * @param {EditInfo} b The second message.
 * @returns {number} -1 if a comes before b, 1 if a comes after b, 0 if equal.
 * @private
 */
function compareFixesByRange(a, b) {
	return a.range[0] - b.range[0] || a.range[1] - b.range[1];
}

/**
 * Merges the given fixes array into one.
 * @param {Array<EditInfo>} fixes The fixes to merge.
 * @param {ReportSourceCode} sourceCode The source code object to get the text between fixes.
 * @returns {EditInfo | null} The merged fixes
 */
function mergeFixes(fixes, sourceCode) {
	for (const fix of fixes) {
		assertValidFix(fix);
	}

	if (fixes.length === 0) {
		return null;
	}
	if (fixes.length === 1) {
		return cloneFix(fixes[0]);
	}

	fixes.sort(compareFixesByRange);

	const originalText = sourceCode.text;
	const start = fixes[0].range[0];
	// Non-empty: the length checks above returned for 0 and 1.
	const end = /** @type {EditInfo} */ (fixes.at(-1)).range[1];
	let text = "";
	let lastPos = Number.MIN_SAFE_INTEGER;

	for (const fix of fixes) {
		assert(
			fix.range[0] >= lastPos,
			"Fix objects must not be overlapped in a report.",
		);

		if (fix.range[0] >= 0) {
			text += originalText.slice(
				Math.max(0, start, lastPos),
				fix.range[0],
			);
		}
		text += fix.text;
		lastPos = fix.range[1];
	}
	text += originalText.slice(Math.max(0, start, lastPos), end);

	return { range: /** @type {Range} */ ([start, end]), text };
}

/**
 * Gets one fix object from the given descriptor.
 * If the descriptor retrieves multiple fixes, this merges those to one.
 * @param {ReportDescriptor | SuggestionDescriptor} descriptor The report descriptor.
 * @param {ReportSourceCode} sourceCode The source code object to get text between fixes.
 * @returns {EditInfo | null} The fix for the descriptor
 */
function normalizeFixes(descriptor, sourceCode) {
	if (typeof descriptor.fix !== "function") {
		return null;
	}

	const ruleFixer = new RuleFixer({ sourceCode });

	const fix = descriptor.fix(ruleFixer);

	// Merge to one.
	if (fix && Symbol.iterator in fix) {
		return mergeFixes(Array.from(fix), sourceCode);
	}

	assertValidFix(fix);
	return cloneFix(fix);
}

/**
 * Gets an array of suggestion objects from the given descriptor.
 * @param {ReportDescriptor} descriptor The report descriptor.
 * @param {ReportSourceCode} sourceCode The source code object to get text between fixes.
 * @param {Record<string, string> | undefined} messages Object of meta messages for the rule.
 * @returns {Array<SuggestionResult>} The suggestions for the descriptor
 */
function mapSuggestions(descriptor, sourceCode, messages) {
	if (!descriptor.suggest || !Array.isArray(descriptor.suggest)) {
		return [];
	}

	/*
	 * The `filter()` below is what makes every surviving `fix` non-null, which
	 * is the one thing separating these objects from `SuggestionResult`.
	 */
	return /** @type {Array<SuggestionResult>} */ (
		descriptor.suggest
			.map(suggestInfo => {
				/*
				 * `validateSuggestions()` has already run, so a suggestion
				 * without a `desc` carries a `messageId` that `messages` has.
				 */
				const computedDesc =
					suggestInfo.desc ||
					/** @type {Record<string, string>} */ (messages)[
						/** @type {string} */ (suggestInfo.messageId)
					];

				return {
					...suggestInfo,
					desc: interpolate(computedDesc, suggestInfo.data),
					fix: normalizeFixes(suggestInfo, sourceCode),
				};
			})

			// Remove suggestions that didn't provide a fix
			.filter(({ fix }) => fix)
	);
}

/**
 * Creates information about the report from a descriptor
 * @param {Object} options Information about the problem
 * @param {string | null} options.ruleId Rule ID
 * @param {Severity} options.severity Rule severity
 * @param {string} options.message Error message
 * @param {string} [options.messageId] The error message ID.
 * @param {NormalizedReportLoc} options.loc Start and end location
 * @param {EditInfo | null} options.fix The fix object
 * @param {Array<SuggestionResult>} options.suggestions The array of suggestions objects
 * @param {ReportLanguage} options.language The language to use to adjust line and column offsets.
 * @returns {LintMessage} Information about the report
 */
function createProblem(options) {
	const { language } = options;

	// calculate offsets based on the language in use
	const columnOffset = language.columnStart === 1 ? 0 : 1;
	const lineOffset = language.lineStart === 1 ? 0 : 1;

	/** @type {LintMessage} */
	const problem = {
		ruleId: options.ruleId,
		severity: options.severity,
		message: options.message,
		line: options.loc.start.line + lineOffset,
		column: options.loc.start.column + columnOffset,
	};

	/*
	 * If this isn’t in the conditional, some of the tests fail
	 * because `messageId` is present in the problem object
	 */
	if (options.messageId) {
		problem.messageId = options.messageId;
	}

	if (options.loc.end) {
		problem.endLine = options.loc.end.line + lineOffset;
		problem.endColumn = options.loc.end.column + columnOffset;
	}

	if (options.fix) {
		problem.fix = options.fix;
	}

	if (options.suggestions && options.suggestions.length > 0) {
		problem.suggestions = options.suggestions;
	}

	return problem;
}

/**
 * Validates that suggestions are properly defined. Throws if an error is detected.
 * @param {Array<SuggestionDescriptor> | undefined} suggest The incoming suggest data.
 * @param {Record<string, string> | undefined} messages Object of meta messages for the rule.
 * @returns {void}
 * @throws {TypeError} If any suggestion is malformed.
 */
function validateSuggestions(suggest, messages) {
	if (suggest && Array.isArray(suggest)) {
		suggest.forEach(suggestion => {
			if (suggestion.messageId) {
				const { messageId } = suggestion;

				if (!messages) {
					throw new TypeError(
						`context.report() called with a suggest option with a messageId '${messageId}', but no messages were present in the rule metadata.`,
					);
				}

				if (!messages[messageId]) {
					throw new TypeError(
						`context.report() called with a suggest option with a messageId '${messageId}' which is not present in the 'messages' config: ${JSON.stringify(messages, null, 2)}`,
					);
				}

				if (suggestion.desc) {
					throw new TypeError(
						"context.report() called with a suggest option that defines both a 'messageId' and an 'desc'. Please only pass one.",
					);
				}
			} else if (!suggestion.desc) {
				throw new TypeError(
					"context.report() called with a suggest option that doesn't have either a `desc` or `messageId`",
				);
			}

			if (typeof suggestion.fix !== "function") {
				throw new TypeError(
					`context.report() called with a suggest option without a fix function. See: ${JSON.stringify(suggestion, null, 2)}`,
				);
			}
		});
	}
}

/**
 * Computes the message from a report descriptor.
 * @param {ReportDescriptor} descriptor The report descriptor.
 * @param {Record<string, string> | undefined} messages Object of meta messages for the rule.
 * @returns {string} The computed message.
 * @throws {TypeError} If messageId is not found or both message and messageId are provided.
 */
function computeMessageFromDescriptor(descriptor, messages) {
	if (descriptor.messageId) {
		if (!messages) {
			throw new TypeError(
				"context.report() called with a messageId, but no messages were present in the rule metadata.",
			);
		}
		const id = descriptor.messageId;

		if (descriptor.message) {
			throw new TypeError(
				"context.report() called with a message and a messageId. Please only pass one.",
			);
		}
		if (!messages || !Object.hasOwn(messages, id)) {
			throw new TypeError(
				`context.report() called with a messageId of '${id}' which is not present in the 'messages' config: ${JSON.stringify(messages, null, 2)}`,
			);
		}
		return messages[id];
	}

	if (descriptor.message) {
		return descriptor.message;
	}

	throw new TypeError(
		"Missing `message` property in report() call; add a message that describes the linting problem.",
	);
}

/**
 * A report object that contains the messages reported the linter
 * for a file.
 */
class FileReport {
	/**
	 * The messages reported by the linter for this file.
	 * @type {Array<LintMessage>}
	 */
	messages = [];

	/**
	 * A rule mapper that maps rule IDs to their metadata.
	 * @type {RuleMapper}
	 */
	#ruleMapper;

	/**
	 * The source code object for the file.
	 * @type {ReportSourceCode}
	 */
	#sourceCode;

	/**
	 * The language to use to adjust line and column offsets.
	 * @type {ReportLanguage}
	 */
	#language;

	/**
	 * Whether to disable fixes for this report.
	 * @type {boolean}
	 */
	#disableFixes;

	/**
	 * Creates a new FileReport instance.
	 * @param {Object} options The options for the file report
	 * @param {RuleMapper} options.ruleMapper A rule mapper that maps rule IDs to their metadata.
	 * @param {ReportSourceCode} options.sourceCode The source code object for the file.
	 * @param {ReportLanguage} options.language The language to use to adjust line and column offsets.
	 * @param {boolean} [options.disableFixes] Whether to disable fixes for this report.
	 */
	constructor({ ruleMapper, sourceCode, language, disableFixes = false }) {
		this.#ruleMapper = ruleMapper;
		this.#sourceCode = sourceCode;
		this.#language = language;
		this.#disableFixes = disableFixes;
	}

	/**
	 * Adds a rule-generated message to the report.
	 * @param {string} ruleId The rule ID that reported the problem.
	 * @param {Severity} severity The severity of the problem (0 = off, 1 = warning, 2 = error).
	 * @param {...any} args The arguments passed to `context.report()`.
	 * @returns {LintMessage} The created message object.
	 * @throws {TypeError} If the messageId is not found or both message and messageId are provided.
	 * @throws {Error} If the node is not an object or neither a node nor a loc is provided.
	 */
	addRuleMessage(ruleId, severity, ...args) {
		const descriptor = normalizeMultiArgReportCall(...args);
		const ruleDefinition = this.#ruleMapper(ruleId);
		const messages = ruleDefinition?.meta?.messages;

		assertValidNodeInfo(descriptor);

		const computedMessage = computeMessageFromDescriptor(
			descriptor,
			messages,
		);

		validateSuggestions(descriptor.suggest, messages);

		this.messages.push(
			createProblem({
				ruleId,
				severity,
				message: interpolate(computedMessage, descriptor.data),
				messageId: descriptor.messageId,
				loc: descriptor.loc
					? normalizeReportLoc(descriptor)
					: this.#sourceCode.getLoc(
							// `assertValidNodeInfo()` guarantees one or the other.
							/** @type {ASTNode} */ (descriptor.node),
						),
				fix: this.#disableFixes
					? null
					: normalizeFixes(descriptor, this.#sourceCode),
				suggestions: this.#disableFixes
					? []
					: mapSuggestions(descriptor, this.#sourceCode, messages),
				language: this.#language,
			}),
		);

		// Non-empty: the push above is what it reads back.
		return /** @type {LintMessage} */ (this.messages.at(-1));
	}

	/**
	 * Adds an error message to the report. Meant to be called outside of rules.
	 * @param {LintingProblemDescriptor} descriptor The descriptor for the error message.
	 * @returns {LintMessage} The created message object.
	 */
	addError(descriptor) {
		const message = createLintingProblem(descriptor, 2, this.#language);
		this.messages.push(message);
		return message;
	}

	/**
	 * Adds a fatal error message to the report. Meant to be called outside of rules.
	 * @param {LintingProblemDescriptor} descriptor The descriptor for the fatal error message.
	 * @returns {LintMessage} The created message object.
	 */
	addFatal(descriptor) {
		const message = createLintingProblem(descriptor, 2, this.#language);
		message.fatal = true;
		this.messages.push(message);
		return message;
	}

	/**
	 * Adds a warning message to the report. Meant to be called outside of rules.
	 * @param {LintingProblemDescriptor} descriptor The descriptor for the warning message.
	 * @returns {LintMessage} The created message object.
	 */
	addWarning(descriptor) {
		const message = createLintingProblem(descriptor, 1, this.#language);
		this.messages.push(message);
		return message;
	}
}

module.exports = {
	FileReport,
	updateLocationInformation,
};

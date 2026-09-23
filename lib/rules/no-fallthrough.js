/**
 * @fileoverview Rule to flag fall-through cases in switch statements.
 * @author Matt DuVall <http://mattduvall.com/>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { directivesPattern } = require("../shared/directives");
const { isAnySegmentReachable } = require("./utils/code-path-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * A comment as `sourceCode.getCommentsBefore()` hands it back. That is the
 * `lib/shared/types.js` variant, whose `type` is a plain `string`: the JS
 * language's comment list also carries the `"Shebang"` comment that `espree`
 * synthesizes for a hashbang line, which the narrower `"Line" | "Block"` union
 * in `./utils/ast-utils.js` cannot express.
 * @typedef {import("../shared/types.js").Comment} Comment
 */

/**
 * What the rule remembers about the `SwitchCase` it most recently left, so
 * that the next `SwitchCase` can decide whether the previous one fell through.
 * @typedef {Object} PreviousCaseInfo
 * @property {ASTNode} node The `SwitchCase` node that was left.
 * @property {boolean} isSwitchExitReachable Whether the end of that case was reachable.
 * @property {boolean} isFallthrough Whether that case falls through into the next one.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const DEFAULT_FALLTHROUGH_COMMENT = /falls?\s?through/iu;

/**
 * Checks whether or not a given comment string is really a fallthrough comment and not an ESLint directive.
 * @param {string} comment The comment string to check.
 * @param {RegExp} fallthroughCommentPattern The regular expression used for checking for fallthrough comments.
 * @returns {boolean} `true` if the comment string is truly a fallthrough comment.
 */
function isFallThroughComment(comment, fallthroughCommentPattern) {
	return (
		fallthroughCommentPattern.test(comment) &&
		!directivesPattern.test(comment.trim())
	);
}

/**
 * Checks whether or not a given case has a fallthrough comment.
 * @param {ASTNode} caseWhichFallsThrough SwitchCase node which falls through.
 * @param {ASTNode} subsequentCase The case after caseWhichFallsThrough.
 * @param {RuleContext} context A rule context which stores comments.
 * @param {RegExp} fallthroughCommentPattern A pattern to match comment to.
 * @returns {Comment | null} the comment if the case has a valid fallthrough comment, otherwise null
 */
function getFallthroughComment(
	caseWhichFallsThrough,
	subsequentCase,
	context,
	fallthroughCommentPattern,
) {
	const sourceCode = context.sourceCode;

	if (
		caseWhichFallsThrough.consequent.length === 1 &&
		caseWhichFallsThrough.consequent[0].type === "BlockStatement"
	) {
		// A `BlockStatement` always ends with its `}` punctuator, so this is a token and never `null`.
		const trailingCloseBrace = /** @type {Token} */ (
			sourceCode.getLastToken(caseWhichFallsThrough.consequent[0])
		);
		const commentInBlock = sourceCode
			.getCommentsBefore(trailingCloseBrace)
			.pop();

		if (
			commentInBlock &&
			isFallThroughComment(
				commentInBlock.value,
				fallthroughCommentPattern,
			)
		) {
			return commentInBlock;
		}
	}

	const comment = sourceCode.getCommentsBefore(subsequentCase).pop();

	if (
		comment &&
		isFallThroughComment(comment.value, fallthroughCommentPattern)
	) {
		return comment;
	}

	return null;
}

/**
 * Checks whether a node and a token are separated by blank lines
 * @param {ASTNode} node The node to check
 * @param {Token} token The token to compare against
 * @returns {boolean} `true` if there are blank lines between node and token
 */
function hasBlankLinesBetween(node, token) {
	return token.loc.start.line > node.loc.end.line + 1;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				allowEmptyCase: false,
				reportUnusedFallthroughComment: false,
			},
		],

		docs: {
			description: "Disallow fallthrough of `case` statements",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-fallthrough",
		},

		schema: [
			{
				type: "object",
				properties: {
					commentPattern: {
						type: "string",
					},
					allowEmptyCase: {
						type: "boolean",
					},
					reportUnusedFallthroughComment: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			unusedFallthroughComment:
				"Found a comment that would permit fallthrough, but case cannot fall through.",
			case: "Expected a 'break' statement before 'case'.",
			default: "Expected a 'break' statement before 'default'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/** @type {Array<Set<CodePathSegment>>} */
		const codePathSegments = [];

		/** @type {Set<CodePathSegment>} */
		let currentCodePathSegments = new Set();
		const sourceCode = context.sourceCode;
		const [
			{ allowEmptyCase, commentPattern, reportUnusedFallthroughComment },
		] = context.options;
		const fallthroughCommentPattern = commentPattern
			? new RegExp(commentPattern, "u")
			: DEFAULT_FALLTHROUGH_COMMENT;

		/*
		 * We need to use leading comments of the next SwitchCase node because
		 * trailing comments is wrong if semicolons are omitted.
		 */
		/** @type {PreviousCaseInfo | null} */
		let previousCase = null;

		return {
			/**
			 * Starts tracking the segments of a newly entered code path.
			 * @returns {void}
			 */
			onCodePathStart() {
				codePathSegments.push(currentCodePathSegments);
				currentCodePathSegments = new Set();
			},

			/**
			 * Restores the segments of the enclosing code path.
			 * @returns {void}
			 */
			onCodePathEnd() {
				// `onCodePathEnd` always pairs with the `onCodePathStart` that pushed the entry, so the stack is never empty here.
				currentCodePathSegments = /** @type {Set<CodePathSegment>} */ (
					codePathSegments.pop()
				);
			},

			/**
			 * Tracks an unreachable segment that has just started.
			 * @param {CodePathSegment} segment The segment that started.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentStart(segment) {
				currentCodePathSegments.add(segment);
			},

			/**
			 * Stops tracking an unreachable segment that has just ended.
			 * @param {CodePathSegment} segment The segment that ended.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentEnd(segment) {
				currentCodePathSegments.delete(segment);
			},

			/**
			 * Tracks a segment that has just started.
			 * @param {CodePathSegment} segment The segment that started.
			 * @returns {void}
			 */
			onCodePathSegmentStart(segment) {
				currentCodePathSegments.add(segment);
			},

			/**
			 * Stops tracking a segment that has just ended.
			 * @param {CodePathSegment} segment The segment that ended.
			 * @returns {void}
			 */
			onCodePathSegmentEnd(segment) {
				currentCodePathSegments.delete(segment);
			},

			/**
			 * Reports the previous case if it fell through into this one without
			 * a fallthrough comment, or reports an unused fallthrough comment.
			 * @param {ASTNode} node The `SwitchCase` node being entered.
			 * @returns {void}
			 */
			SwitchCase(node) {
				/*
				 * Checks whether or not there is a fallthrough comment.
				 * And reports the previous fallthrough node if that does not exist.
				 */

				if (previousCase && previousCase.node.parent === node.parent) {
					const previousCaseFallthroughComment =
						getFallthroughComment(
							previousCase.node,
							node,
							context,
							fallthroughCommentPattern,
						);

					if (
						previousCase.isFallthrough &&
						!previousCaseFallthroughComment
					) {
						context.report({
							messageId: node.test ? "case" : "default",
							node,
						});
					} else if (
						reportUnusedFallthroughComment &&
						!previousCase.isSwitchExitReachable &&
						previousCaseFallthroughComment
					) {
						context.report({
							messageId: "unusedFallthroughComment",
							node: previousCaseFallthroughComment,
						});
					}
				}
				previousCase = null;
			},

			/**
			 * Records whether the case being left falls through into the next one.
			 * @param {ASTNode} node The `SwitchCase` node being left.
			 * @returns {void}
			 */
			"SwitchCase:exit"(node) {
				// A `SwitchCase` is always followed by at least the `}` of its enclosing `SwitchStatement`.
				const nextToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(node)
				);

				/*
				 * `reachable` meant fall through because statements preceded by
				 * `break`, `return`, or `throw` are unreachable.
				 * And allows empty cases and the last case.
				 */
				const isSwitchExitReachable = isAnySegmentReachable(
					currentCodePathSegments,
				);
				const isFallthrough =
					isSwitchExitReachable &&
					(node.consequent.length > 0 ||
						(!allowEmptyCase &&
							hasBlankLinesBetween(node, nextToken))) &&
					node.parent.cases.at(-1) !== node;

				previousCase = {
					node,
					isSwitchExitReachable,
					isFallthrough,
				};
			},
		};
	},
};

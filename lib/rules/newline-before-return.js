/**
 * @fileoverview Rule to require newlines before `return` statement
 * @author Kai Cataldo
 * @deprecated in ESLint v4.0.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("../shared/types.js").Comment} Comment */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "layout",

		docs: {
			description: "Require an empty line before `return` statements",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/newline-before-return",
		},

		fixable: "whitespace",
		schema: [],
		messages: {
			expected: "Expected newline before return statement.",
		},

		deprecated: {
			message: "The rule was replaced with a more general rule.",
			url: "https://eslint.org/blog/2017/06/eslint-v4.0.0-released/",
			deprecatedSince: "4.0.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message: "The new rule moved to a plugin.",
					url: "https://eslint.org/docs/latest/rules/padding-line-between-statements#examples",
					plugin: {
						name: "@stylistic/eslint-plugin",
						url: "https://eslint.style",
					},
					rule: {
						name: "padding-line-between-statements",
						url: "https://eslint.style/rules/padding-line-between-statements",
					},
				},
			],
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Tests whether node is preceded by supplied tokens
		 * @param {ASTNode} node node to check
		 * @param {Array<string>} testTokens array of tokens to test against
		 * @returns {boolean} Whether or not the node is preceded by one of the supplied tokens
		 * @private
		 */
		function isPrecededByTokens(node, testTokens) {
			// Every caller reaches here from a parent that guarantees a preceding token: `else`/`)`, `do`, or `:`.
			const tokenBefore = /** @type {Token} */ (
				sourceCode.getTokenBefore(node)
			);

			return testTokens.includes(tokenBefore.value);
		}

		/**
		 * Checks whether node is the first node after statement or in block
		 * @param {ASTNode} node node to check
		 * @returns {boolean} Whether or not the node is the first node after statement or in block
		 * @private
		 */
		function isFirstNode(node) {
			const parentType = node.parent.type;

			if (node.parent.body) {
				return Array.isArray(node.parent.body)
					? node.parent.body[0] === node
					: node.parent.body === node;
			}

			if (parentType === "IfStatement") {
				return isPrecededByTokens(node, ["else", ")"]);
			}
			if (parentType === "DoWhileStatement") {
				return isPrecededByTokens(node, ["do"]);
			}
			if (parentType === "SwitchCase") {
				return isPrecededByTokens(node, [":"]);
			}
			return isPrecededByTokens(node, [")"]);
		}

		/**
		 * Returns the number of lines of comments that precede the node
		 * @param {ASTNode} node node to check for overlapping comments
		 * @param {number} lineNumTokenBefore line number of previous token, to check for overlapping comments
		 * @returns {number} Number of lines of comments that precede the node
		 * @private
		 */
		function calcCommentLines(node, lineNumTokenBefore) {
			const comments = sourceCode.getCommentsBefore(node);
			let numLinesComments = 0;

			if (!comments.length) {
				return numLinesComments;
			}

			comments.forEach(comment => {
				numLinesComments++;

				if (comment.type === "Block") {
					numLinesComments +=
						comment.loc.end.line - comment.loc.start.line;
				}

				// avoid counting lines with inline comments twice
				if (comment.loc.start.line === lineNumTokenBefore) {
					numLinesComments--;
				}

				if (comment.loc.end.line === node.loc.start.line) {
					numLinesComments--;
				}
			});

			return numLinesComments;
		}

		/**
		 * Returns the line number of the token before the node that is passed in as an argument
		 * @param {ASTNode} node The node to use as the start of the calculation
		 * @returns {number} Line number of the token before `node`
		 * @private
		 */
		function getLineNumberOfTokenBefore(node) {
			const tokenBefore = sourceCode.getTokenBefore(node);
			let lineNumTokenBefore;

			/**
			 * Global return (at the beginning of a script) is a special case.
			 * If there is no token before `return`, then we expect no line
			 * break before the return. Comments are allowed to occupy lines
			 * before the global return, just no blank lines.
			 * Setting lineNumTokenBefore to zero in that case results in the
			 * desired behavior.
			 */
			if (tokenBefore) {
				lineNumTokenBefore = tokenBefore.loc.end.line;
			} else {
				lineNumTokenBefore = 0; // global return at beginning of script
			}

			return lineNumTokenBefore;
		}

		/**
		 * Checks whether node is preceded by a newline
		 * @param {ASTNode} node node to check
		 * @returns {boolean} Whether or not the node is preceded by a newline
		 * @private
		 */
		function hasNewlineBefore(node) {
			const lineNumNode = node.loc.start.line;
			const lineNumTokenBefore = getLineNumberOfTokenBefore(node);
			const commentLines = calcCommentLines(node, lineNumTokenBefore);

			return lineNumNode - lineNumTokenBefore - commentLines > 1;
		}

		/**
		 * Checks whether it is safe to apply a fix to a given return statement.
		 *
		 * The fix is not considered safe if the given return statement has leading comments,
		 * as we cannot safely determine if the newline should be added before or after the comments.
		 * For more information, see: https://github.com/eslint/eslint/issues/5958#issuecomment-222767211
		 * @param {ASTNode} node The return statement node to check.
		 * @returns {boolean} `true` if it can fix the node.
		 * @private
		 */
		function canFix(node) {
			const leadingComments = sourceCode.getCommentsBefore(node);

			/*
			 * Both lookups are only read below after `leadingComments.length === 0` has
			 * returned, so there is a last comment; and a `return` with a comment before
			 * it that is not the first node of its parent always has a token before it.
			 */
			const lastLeadingComment = /** @type {Comment} */ (
				leadingComments.at(-1)
			);
			const tokenBefore = /** @type {Token} */ (
				sourceCode.getTokenBefore(node)
			);

			if (leadingComments.length === 0) {
				return true;
			}

			/*
			 * if the last leading comment ends in the same line as the previous token and
			 * does not share a line with the `return` node, we can consider it safe to fix.
			 * Example:
			 * function a() {
			 *     var b; //comment
			 *     return;
			 * }
			 */
			if (
				lastLeadingComment.loc.end.line === tokenBefore.loc.end.line &&
				lastLeadingComment.loc.end.line !== node.loc.start.line
			) {
				return true;
			}

			return false;
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports a `return` statement that is not preceded by a newline.
			 * @param {ASTNode} node The `ReturnStatement` node to check.
			 * @returns {void} No return value.
			 */
			ReturnStatement(node) {
				if (!isFirstNode(node) && !hasNewlineBefore(node)) {
					context.report({
						node,
						messageId: "expected",
						/**
						 * Inserts the newline before the `return` statement.
						 * @param {RuleFixer} fixer The fixer to build the edit with.
						 * @returns {EditInfo | null} The edit, or `null` if the fix is not safe.
						 */
						fix(fixer) {
							if (canFix(node)) {
								// `isFirstNode()` returned false, so the `return` has a token before it.
								const tokenBefore = /** @type {Token} */ (
									sourceCode.getTokenBefore(node)
								);
								const newlines =
									node.loc.start.line ===
									tokenBefore.loc.end.line
										? "\n\n"
										: "\n";

								return fixer.insertTextBefore(node, newlines);
							}
							return null;
						},
					});
				}
			},
		};
	},
};

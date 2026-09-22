/**
 * @fileoverview Rule to spot scenarios where a newline looks like it is ending a statement, but is not.
 * @author Glen Mailer
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow confusing multiline expressions",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-unexpected-multiline",
		},

		schema: [],
		messages: {
			function:
				"Unexpected newline between function and ( of function call.",
			property:
				"Unexpected newline between object and [ of property access.",
			taggedTemplate:
				"Unexpected newline between template tag and template literal.",
			division:
				"Unexpected newline between numerator and division operator.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const REGEX_FLAG_MATCHER = /^[gimsuy]+$/u;

		const sourceCode = context.sourceCode;

		/**
		 * Check to see if there is a newline between the node and the following open bracket
		 * line's expression
		 * @param {ASTNode} node The node to check.
		 * @param {string} messageId The error messageId to use.
		 * @returns {void}
		 * @private
		 */
		function checkForBreakAfter(node, messageId) {
			// every caller has already matched the syntax that puts a bracket after `node`, and a bracket is never the first token of the file
			const openParen = /** @type {Token} */ (
				sourceCode.getTokenAfter(node, astUtils.isNotClosingParenToken)
			);
			const nodeExpressionEnd = /** @type {Token} */ (
				sourceCode.getTokenBefore(openParen)
			);

			if (openParen.loc.start.line !== nodeExpressionEnd.loc.end.line) {
				context.report({
					node,
					loc: openParen.loc,
					messageId,
				});
			}
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks a computed property access for a newline before its `[`.
			 * @param {ASTNode} node The `MemberExpression` node.
			 * @returns {void}
			 */
			MemberExpression(node) {
				if (!node.computed || node.optional) {
					return;
				}
				checkForBreakAfter(node.object, "property");
			},

			/**
			 * Checks a tagged template for a newline between the tag and the template literal.
			 * @param {ASTNode} node The `TaggedTemplateExpression` node.
			 * @returns {void}
			 */
			TaggedTemplateExpression(node) {
				const { quasi } = node;

				/*
				 * handles common tags, parenthesized tags, and typescript's
				 * generic type arguments. The tag expression always precedes
				 * the template literal, so this token exists.
				 */
				const tokenBefore = /** @type {Token} */ (
					sourceCode.getTokenBefore(quasi)
				);

				if (tokenBefore.loc.end.line !== quasi.loc.start.line) {
					context.report({
						node,
						loc: {
							start: quasi.loc.start,
							end: {
								line: quasi.loc.start.line,
								column: quasi.loc.start.column + 1,
							},
						},
						messageId: "taggedTemplate",
					});
				}
			},

			/**
			 * Checks a call for a newline between the callee and its `(`.
			 * @param {ASTNode} node The `CallExpression` node.
			 * @returns {void}
			 */
			CallExpression(node) {
				if (node.arguments.length === 0 || node.optional) {
					return;
				}
				checkForBreakAfter(node.callee, "function");
			},

			/**
			 * Checks a chained division that could be read as a regular expression.
			 * @param {ASTNode} node The left `BinaryExpression` of the outer division.
			 * @returns {void}
			 */
			"BinaryExpression[operator='/'] > BinaryExpression[operator='/'].left"(
				node,
			) {
				// the selector matched an outer `/` after `node`, and that operator is always followed by its right operand
				const secondSlash = /** @type {Token} */ (
					sourceCode.getTokenAfter(
						node,
						(/** @type {Token} */ token) => token.value === "/",
					)
				);
				const tokenAfterOperator = /** @type {Token} */ (
					sourceCode.getTokenAfter(secondSlash)
				);

				if (
					tokenAfterOperator.type === "Identifier" &&
					REGEX_FLAG_MATCHER.test(tokenAfterOperator.value) &&
					secondSlash.range[1] === tokenAfterOperator.range[0]
				) {
					checkForBreakAfter(node.left, "division");
				}
			},
		};
	},
};

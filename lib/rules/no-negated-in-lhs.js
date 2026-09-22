/**
 * @fileoverview A rule to disallow negated left operands of the `in` operator
 * @author Michael Ficarra
 * @deprecated in ESLint v3.3.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow negating the left operand in `in` expressions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-negated-in-lhs",
		},

		deprecated: {
			message: "Renamed rule.",
			url: "https://eslint.org/blog/2016/08/eslint-v3.3.0-released/#deprecated-rules",
			deprecatedSince: "3.3.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					rule: {
						name: "no-unsafe-negation",
						url: "https://eslint.org/docs/rules/no-unsafe-negation",
					},
				},
			],
		},
		schema: [],

		messages: {
			negatedLHS: "The 'in' expression's left operand is negated.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		return {
			/**
			 * Reports an `in` expression whose left operand is negated.
			 * @param {ASTNode} node The `BinaryExpression` node.
			 * @returns {void}
			 */
			BinaryExpression(node) {
				if (
					node.operator === "in" &&
					node.left.type === "UnaryExpression" &&
					node.left.operator === "!"
				) {
					context.report({ node, messageId: "negatedLHS" });
				}
			},
		};
	},
};

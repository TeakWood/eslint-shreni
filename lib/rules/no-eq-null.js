/**
 * @fileoverview Rule to flag comparisons to null without a type-checking
 * operator.
 * @author Ian Christian Myers
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
		type: "suggestion",

		docs: {
			description:
				"Disallow `null` comparisons without type-checking operators",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-eq-null",
		},

		schema: [],

		messages: {
			unexpected: "Use '===' to compare with null.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		return {
			/**
			 * Reports a `==` or `!=` comparison against the `null` literal.
			 * @param {ASTNode} node The BinaryExpression node to check.
			 * @returns {void}
			 */
			BinaryExpression(node) {
				const badOperator =
					node.operator === "==" || node.operator === "!=";

				if (
					(node.right.type === "Literal" &&
						node.right.raw === "null" &&
						badOperator) ||
					(node.left.type === "Literal" &&
						node.left.raw === "null" &&
						badOperator)
				) {
					context.report({ node, messageId: "unexpected" });
				}
			},
		};
	},
};

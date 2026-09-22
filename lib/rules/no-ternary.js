/**
 * @fileoverview Rule to flag use of ternary operators.
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
			description: "Disallow ternary operators",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-ternary",
		},

		schema: [],

		messages: {
			noTernaryOperator: "Ternary operator used.",
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
			 * Reports the ternary operator.
			 * @param {ASTNode} node The `ConditionalExpression` node.
			 * @returns {void}
			 */
			ConditionalExpression(node) {
				context.report({ node, messageId: "noTernaryOperator" });
			},
		};
	},
};

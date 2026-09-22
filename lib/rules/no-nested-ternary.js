/**
 * @fileoverview Rule to flag nested ternary expressions
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
			description: "Disallow nested ternary expressions",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-nested-ternary",
		},

		schema: [],

		messages: {
			noNestedTernary: "Do not nest ternary expressions.",
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
			 * Reports a ternary whose consequent or alternate is another ternary.
			 * @param {ASTNode} node The `ConditionalExpression` node.
			 * @returns {void}
			 */
			ConditionalExpression(node) {
				if (
					node.alternate.type === "ConditionalExpression" ||
					node.consequent.type === "ConditionalExpression"
				) {
					context.report({
						node,
						messageId: "noNestedTernary",
					});
				}
			},
		};
	},
};

/**
 * @fileoverview Rule to flag when deleting variables
 * @author Ilya Volodin
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
			description: "Disallow deleting variables",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-delete-var",
		},

		schema: [],

		messages: {
			unexpected: "Variables should not be deleted.",
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
			 * Reports a `delete` applied to a bare variable.
			 * @param {ASTNode} node The `UnaryExpression` node to check.
			 * @returns {void} No return value.
			 */
			UnaryExpression(node) {
				if (
					node.operator === "delete" &&
					node.argument.type === "Identifier"
				) {
					context.report({ node, messageId: "unexpected" });
				}
			},
		};
	},
};

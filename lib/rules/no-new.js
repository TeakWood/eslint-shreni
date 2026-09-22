/**
 * @fileoverview Rule to flag statements with function invocation preceded by
 * "new" and not part of assignment
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
			description:
				"Disallow `new` operators outside of assignments or comparisons",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-new",
		},

		schema: [],

		messages: {
			noNewStatement: "Do not use 'new' for side effects.",
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
			 * Reports the expression statement a bare `new` expression forms.
			 * @param {ASTNode} node The `NewExpression` node.
			 * @returns {void}
			 */
			"ExpressionStatement > NewExpression"(node) {
				context.report({
					node: node.parent,
					messageId: "noNewStatement",
				});
			},
		};
	},
};

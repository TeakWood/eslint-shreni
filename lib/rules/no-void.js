/**
 * @fileoverview Rule to disallow use of void operator.
 * @author Mike Sidorov
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

		defaultOptions: [
			{
				allowAsStatement: false,
			},
		],

		docs: {
			description: "Disallow `void` operators",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-void",
		},

		messages: {
			noVoid: "Expected 'undefined' and instead saw 'void'.",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowAsStatement: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ allowAsStatement }] = context.options;

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports the `void` operator.
			 * @param {ASTNode} node The `UnaryExpression` node.
			 * @returns {void}
			 */
			'UnaryExpression[operator="void"]'(node) {
				if (
					allowAsStatement &&
					node.parent &&
					node.parent.type === "ExpressionStatement"
				) {
					return;
				}
				context.report({
					node,
					messageId: "noVoid",
				});
			},
		};
	},
};

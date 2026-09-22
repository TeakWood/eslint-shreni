/**
 * @fileoverview Warn when using template string syntax in regular strings
 * @author Jeroen Engels
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
				"Disallow template literal placeholder syntax in regular strings",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-template-curly-in-string",
		},

		schema: [],

		messages: {
			unexpectedTemplateExpression:
				"Unexpected template string expression.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const regex = /\$\{[^}]+\}/u;

		return {
			/**
			 * Reports a regular string that contains template placeholder syntax.
			 * @param {ASTNode} node The `Literal` node.
			 * @returns {void}
			 */
			Literal(node) {
				if (typeof node.value === "string" && regex.test(node.value)) {
					context.report({
						node,
						messageId: "unexpectedTemplateExpression",
					});
				}
			},
		};
	},
};

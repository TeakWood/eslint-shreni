/**
 * @fileoverview Rule to disallow use of new operator with the `require` function
 * @author Wil Moore III
 * @deprecated in ESLint v7.0.0
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
		deprecated: {
			message: "Node.js rules were moved out of ESLint core.",
			url: "https://eslint.org/docs/latest/use/migrating-to-7.0.0#deprecate-node-rules",
			deprecatedSince: "7.0.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"eslint-plugin-n now maintains deprecated Node.js-related rules.",
					plugin: {
						name: "eslint-plugin-n",
						url: "https://github.com/eslint-community/eslint-plugin-n",
					},
					rule: {
						name: "no-new-require",
						url: "https://github.com/eslint-community/eslint-plugin-n/tree/master/docs/rules/no-new-require.md",
					},
				},
			],
		},

		type: "suggestion",

		docs: {
			description: "Disallow `new` operators with calls to `require`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-new-require",
		},

		schema: [],

		messages: {
			noNewRequire: "Unexpected use of new with require.",
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
			 * Reports a `new` expression whose callee is the `require` identifier.
			 * @param {ASTNode} node The `NewExpression` node.
			 * @returns {void}
			 */
			NewExpression(node) {
				if (
					node.callee.type === "Identifier" &&
					node.callee.name === "require"
				) {
					context.report({
						node,
						messageId: "noNewRequire",
					});
				}
			},
		};
	},
};

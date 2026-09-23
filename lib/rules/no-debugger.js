/**
 * @fileoverview Rule to flag use of a debugger statement
 * @author Nicholas C. Zakas
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
			description: "Disallow the use of `debugger`",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-debugger",
		},

		fixable: null,
		schema: [],

		messages: {
			unexpected: "Unexpected 'debugger' statement.",
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
			 * Reports a `debugger` statement.
			 * @param {ASTNode} node The `DebuggerStatement` node.
			 * @returns {void} No return value.
			 */
			DebuggerStatement(node) {
				context.report({
					node,
					messageId: "unexpected",
				});
			},
		};
	},
};

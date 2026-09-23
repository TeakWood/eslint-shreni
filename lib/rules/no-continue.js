/**
 * @fileoverview Rule to flag use of continue statement
 * @author Borislav Zhivkov
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
			description: "Disallow `continue` statements",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-continue",
		},

		schema: [],

		messages: {
			unexpected: "Unexpected use of continue statement.",
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
			 * Reports a `continue` statement.
			 * @param {ASTNode} node The `ContinueStatement` node.
			 * @returns {void} No return value.
			 */
			ContinueStatement(node) {
				context.report({ node, messageId: "unexpected" });
			},
		};
	},
};

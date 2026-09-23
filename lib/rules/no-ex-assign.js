/**
 * @fileoverview Rule to flag assignment of the exception parameter
 * @author Stephen Murray <spmurrayzzz>
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Variable} Variable */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow reassigning exceptions in `catch` clauses",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-ex-assign",
		},

		schema: [],

		messages: {
			unexpected: "Do not assign to the exception parameter.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor the linter walks the AST with.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Finds and reports references that are non initializer and writable.
		 * @param {Variable} variable A variable to check.
		 * @returns {void}
		 */
		function checkVariable(variable) {
			astUtils
				.getModifyingReferences(variable.references)
				.forEach(reference => {
					context.report({
						node: reference.identifier,
						messageId: "unexpected",
					});
				});
		}

		return {
			/**
			 * Checks the variables a `catch` clause declares.
			 * @param {ASTNode} node The CatchClause node to check.
			 * @returns {void}
			 */
			CatchClause(node) {
				sourceCode.getDeclaredVariables(node).forEach(checkVariable);
			},
		};
	},
};

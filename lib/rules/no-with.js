/**
 * @fileoverview Rule to flag use of with statement
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow `with` statements",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-with",
		},

		schema: [],

		messages: {
			unexpectedWith: "Unexpected use of 'with' statement.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports the `with` statement.
			 * @param {ASTNode} node The `WithStatement` node.
			 * @returns {void}
			 */
			WithStatement(node) {
				context.report({
					node,
					// A `WithStatement` always starts with the `with` keyword token.
					loc: /** @type {Token} */ (sourceCode.getFirstToken(node))
						.loc,
					messageId: "unexpectedWith",
				});
			},
		};
	},
};

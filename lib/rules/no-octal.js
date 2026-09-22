/**
 * @fileoverview Rule to flag when initializing octal literal
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
			description: "Disallow octal literals",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-octal",
		},

		schema: [],

		messages: {
			noOctal: "Octal literals should not be used.",
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
			 * Reports a numeric literal written in legacy octal notation.
			 * @param {ASTNode} node The `Literal` node.
			 * @returns {void}
			 */
			Literal(node) {
				if (typeof node.value === "number" && /^0\d/u.test(node.raw)) {
					context.report({
						node,
						messageId: "noOctal",
					});
				}
			},
		};
	},
};

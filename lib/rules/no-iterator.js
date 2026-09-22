/**
 * @fileoverview Rule to flag usage of __iterator__ property
 * @author Ian Christian Myers
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { getStaticPropertyName } = require("./utils/ast-utils");

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
			description: "Disallow the use of the `__iterator__` property",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-iterator",
		},

		schema: [],

		messages: {
			noIterator: "Reserved name '__iterator__'.",
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
			 * Reports a member expression that reads or writes `__iterator__`.
			 * @param {ASTNode} node The `MemberExpression` node to check.
			 * @returns {void}
			 */
			MemberExpression(node) {
				if (getStaticPropertyName(node) === "__iterator__") {
					context.report({
						node,
						messageId: "noIterator",
					});
				}
			},
		};
	},
};

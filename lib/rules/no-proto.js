/**
 * @fileoverview Rule to flag usage of __proto__ property
 * @author Ilya Volodin
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
			description: "Disallow the use of the `__proto__` property",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-proto",
		},

		schema: [],

		messages: {
			unexpectedProto: "The '__proto__' property is deprecated.",
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
			 * Reports a member access whose static property name is `__proto__`.
			 * @param {ASTNode} node The `MemberExpression` node.
			 * @returns {void}
			 */
			MemberExpression(node) {
				if (getStaticPropertyName(node) === "__proto__") {
					context.report({ node, messageId: "unexpectedProto" });
				}
			},
		};
	},
};

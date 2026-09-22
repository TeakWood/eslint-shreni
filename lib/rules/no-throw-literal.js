/**
 * @fileoverview Rule to restrict what can be thrown as an exception.
 * @author Dieter Oberkofler
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

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow throwing literals as exceptions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-throw-literal",
		},

		schema: [],

		messages: {
			object: "Expected an error object to be thrown.",
			undef: "Do not throw undefined.",
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
			 * Reports a `throw` of something that cannot be an `Error`.
			 * @param {ASTNode} node The `ThrowStatement` node.
			 * @returns {void}
			 */
			ThrowStatement(node) {
				if (!astUtils.couldBeError(node.argument)) {
					context.report({ node, messageId: "object" });
				} else if (node.argument.type === "Identifier") {
					if (
						node.argument.name === "undefined" &&
						sourceCode.isGlobalReference(node.argument)
					) {
						context.report({ node, messageId: "undef" });
					}
				}
			},
		};
	},
};

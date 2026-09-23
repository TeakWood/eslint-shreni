/**
 * @fileoverview Rule to flag use of arguments.callee and arguments.caller.
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
		type: "suggestion",

		docs: {
			description:
				"Disallow the use of `arguments.caller` or `arguments.callee`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-caller",
		},

		schema: [],

		messages: {
			unexpected: "Avoid arguments.{{prop}}.",
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
			 * Reports a reference to `arguments.caller` or `arguments.callee`.
			 * @param {ASTNode} node The `MemberExpression` node to check.
			 * @returns {void} No return value.
			 */
			MemberExpression(node) {
				const objectName = node.object.name,
					propertyName = node.property.name;

				if (
					objectName === "arguments" &&
					!node.computed &&
					propertyName &&
					propertyName.match(/^calle[er]$/u)
				) {
					context.report({
						node,
						messageId: "unexpected",
						data: { prop: propertyName },
					});
				}
			},
		};
	},
};

/**
 * @fileoverview Rule to disallow an empty pattern
 * @author Alberto Rodríguez
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
		type: "problem",

		defaultOptions: [
			{
				allowObjectPatternsAsParameters: false,
			},
		],

		docs: {
			description: "Disallow empty destructuring patterns",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-empty-pattern",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowObjectPatternsAsParameters: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpected: "Unexpected empty {{type}} pattern.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const [{ allowObjectPatternsAsParameters }] = context.options;

		return {
			/**
			 * Reports an object destructuring pattern that binds nothing.
			 * @param {ASTNode} node The `ObjectPattern` node to check.
			 * @returns {void} No return value.
			 */
			ObjectPattern(node) {
				if (node.properties.length > 0) {
					return;
				}

				// Allow {} and {} = {} empty object patterns as parameters when allowObjectPatternsAsParameters is true
				if (
					allowObjectPatternsAsParameters &&
					(astUtils.isFunction(node.parent) ||
						(node.parent.type === "AssignmentPattern" &&
							astUtils.isFunction(node.parent.parent) &&
							node.parent.right.type === "ObjectExpression" &&
							node.parent.right.properties.length === 0))
				) {
					return;
				}

				context.report({
					node,
					messageId: "unexpected",
					data: { type: "object" },
				});
			},
			/**
			 * Reports an array destructuring pattern that binds nothing.
			 * @param {ASTNode} node The `ArrayPattern` node to check.
			 * @returns {void} No return value.
			 */
			ArrayPattern(node) {
				if (node.elements.length === 0) {
					context.report({
						node,
						messageId: "unexpected",
						data: { type: "array" },
					});
				}
			},
		};
	},
};

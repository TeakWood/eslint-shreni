/**
 * @fileoverview Rule to flag when return statement contains assignment
 * @author Ilya Volodin
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const SENTINEL_TYPE =
	/^(?:[a-zA-Z]+?Statement|ArrowFunctionExpression|FunctionExpression|ClassExpression)$/u;

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: ["except-parens"],

		docs: {
			description: "Disallow assignment operators in `return` statements",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-return-assign",
		},

		schema: [
			{
				enum: ["except-parens", "always"],
			},
		],

		messages: {
			returnAssignment: "Return statement should not contain assignment.",
			arrowAssignment: "Arrow function should not return assignment.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const always = context.options[0] !== "except-parens";
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports an assignment that is the value of a `return` statement or the body of an arrow function.
			 * @param {ASTNode} node The `AssignmentExpression` node.
			 * @returns {void}
			 */
			AssignmentExpression(node) {
				if (!always && astUtils.isParenthesised(sourceCode, node)) {
					return;
				}

				let currentChild = node;
				let parent = currentChild.parent;

				// Find ReturnStatement or ArrowFunctionExpression in ancestors.
				while (parent && !SENTINEL_TYPE.test(parent.type)) {
					currentChild = parent;
					parent = parent.parent;
				}

				// Reports.
				if (parent && parent.type === "ReturnStatement") {
					context.report({
						node: parent,
						messageId: "returnAssignment",
					});
				} else if (
					parent &&
					parent.type === "ArrowFunctionExpression" &&
					parent.body === currentChild
				) {
					context.report({
						node: parent,
						messageId: "arrowAssignment",
					});
				}
			},
		};
	},
};

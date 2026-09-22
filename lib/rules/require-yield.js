/**
 * @fileoverview Rule to flag the generator functions that does not have yield.
 * @author Toru Nagashima
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
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Require generator functions to contain `yield`",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/require-yield",
		},

		schema: [],

		messages: {
			missingYield: "This generator function does not have 'yield'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/**
		 * The number of `yield` keywords seen so far in each generator function
		 * currently being traversed, innermost last.
		 * @type {number[]}
		 */
		const stack = [];
		const sourceCode = context.sourceCode;

		/**
		 * If the node is a generator function, start counting `yield` keywords.
		 * @param {ASTNode} node A function node to check.
		 * @returns {void}
		 */
		function beginChecking(node) {
			if (node.generator) {
				stack.push(0);
			}
		}

		/**
		 * If the node is a generator function, end counting `yield` keywords, then
		 * reports result.
		 * @param {ASTNode} node A function node to check.
		 * @returns {void}
		 */
		function endChecking(node) {
			if (!node.generator) {
				return;
			}

			const countYield = stack.pop();

			if (countYield === 0 && node.body.body.length > 0) {
				context.report({
					loc: astUtils.getFunctionHeadLoc(node, sourceCode),
					messageId: "missingYield",
				});
			}
		}

		return {
			FunctionDeclaration: beginChecking,
			"FunctionDeclaration:exit": endChecking,
			FunctionExpression: beginChecking,
			"FunctionExpression:exit": endChecking,

			/**
			 * Increases the count of `yield` keyword.
			 * @returns {void}
			 */
			YieldExpression() {
				if (stack.length > 0) {
					stack[stack.length - 1] += 1;
				}
			},
		};
	},
};

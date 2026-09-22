/**
 * @fileoverview Rule to disallow a negated condition
 * @author Alberto Rodríguez
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
			description: "Disallow negated conditions",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-negated-condition",
		},

		schema: [],

		messages: {
			unexpectedNegated: "Unexpected negated condition.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/**
		 * Determines if a given node is an if-else without a condition on the else
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} True if the node has an else without an if.
		 * @private
		 */
		function hasElseWithoutCondition(node) {
			return node.alternate && node.alternate.type !== "IfStatement";
		}

		/**
		 * Determines if a given node is a negated unary expression
		 * @param {ASTNode} test The test object to check.
		 * @returns {boolean} True if the node is a negated unary expression.
		 * @private
		 */
		function isNegatedUnaryExpression(test) {
			return test.type === "UnaryExpression" && test.operator === "!";
		}

		/**
		 * Determines if a given node is a negated binary expression
		 * @param {ASTNode} test The test to check.
		 * @returns {boolean} True if the node is a negated binary expression.
		 * @private
		 */
		function isNegatedBinaryExpression(test) {
			return (
				test.type === "BinaryExpression" &&
				(test.operator === "!=" || test.operator === "!==")
			);
		}

		/**
		 * Determines if a given node has a negated if expression
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} True if the node has a negated if expression.
		 * @private
		 */
		function isNegatedIf(node) {
			return (
				isNegatedUnaryExpression(node.test) ||
				isNegatedBinaryExpression(node.test)
			);
		}

		return {
			/**
			 * Reports an `if` statement whose test is negated and which has a
			 * plain `else` branch.
			 * @param {ASTNode} node The `IfStatement` node.
			 * @returns {void}
			 */
			IfStatement(node) {
				if (!hasElseWithoutCondition(node)) {
					return;
				}

				if (isNegatedIf(node)) {
					context.report({
						node,
						messageId: "unexpectedNegated",
					});
				}
			},
			/**
			 * Reports a conditional expression whose test is negated.
			 * @param {ASTNode} node The `ConditionalExpression` node.
			 * @returns {void}
			 */
			ConditionalExpression(node) {
				if (isNegatedIf(node)) {
					context.report({
						node,
						messageId: "unexpectedNegated",
					});
				}
			},
		};
	},
};

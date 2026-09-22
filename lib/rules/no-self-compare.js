/**
 * @fileoverview Rule to flag comparison where left part is the same as the right
 * part.
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
		type: "problem",

		docs: {
			description:
				"Disallow comparisons where both sides are exactly the same",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-self-compare",
		},

		schema: [],

		messages: {
			comparingToSelf: "Comparing to itself is potentially pointless.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Determines whether two nodes are composed of the same tokens.
		 * @param {ASTNode} nodeA The first node
		 * @param {ASTNode} nodeB The second node
		 * @returns {boolean} true if the nodes have identical token representations
		 */
		function hasSameTokens(nodeA, nodeB) {
			const tokensA = sourceCode.getTokens(nodeA);
			const tokensB = sourceCode.getTokens(nodeB);

			return (
				tokensA.length === tokensB.length &&
				tokensA.every(
					(token, index) =>
						token.type === tokensB[index].type &&
						token.value === tokensB[index].value,
				)
			);
		}

		return {
			/**
			 * Reports a comparison whose two sides are spelled identically.
			 * @param {ASTNode} node The `BinaryExpression` node.
			 * @returns {void}
			 */
			BinaryExpression(node) {
				const operators = new Set([
					"===",
					"==",
					"!==",
					"!=",
					">",
					"<",
					">=",
					"<=",
				]);

				if (
					operators.has(node.operator) &&
					hasSameTokens(node.left, node.right)
				) {
					context.report({ node, messageId: "comparingToSelf" });
				}
			},
		};
	},
};

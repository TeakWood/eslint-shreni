/**
 * @fileoverview disallow unnecessary concatenation of template strings
 * @author Henry Zhu
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
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Casts a node to the `Token` shape that `isTokenOnSameLine` is declared with.
 *
 * That helper reads nothing but `loc`, which every node carries, and rules have
 * always handed it nodes as well as tokens. The two shapes do not overlap
 * structurally, though — a token has no `parent` and a node has no `value` — so
 * the step through `unknown` is what lets a node through.
 * @param {ASTNode} node The node to pass as a token.
 * @returns {Token} The same node, typed as a token.
 */
function asToken(node) {
	return /** @type {Token} */ (/** @type {unknown} */ (node));
}

/**
 * Checks whether or not a given node is a concatenation.
 * @param {ASTNode} node A node to check.
 * @returns {boolean} `true` if the node is a concatenation.
 */
function isConcatenation(node) {
	return node.type === "BinaryExpression" && node.operator === "+";
}

/**
 * Checks if the given token is a `+` token or not.
 * @param {Token} token The token to check.
 * @returns {boolean} `true` if the token is a `+` token.
 */
function isConcatOperatorToken(token) {
	return token.value === "+" && token.type === "Punctuator";
}

/**
 * Gets the right most node on the left side of a BinaryExpression with + operator.
 * @param {ASTNode} node A BinaryExpression node to check.
 * @returns {ASTNode} node
 */
function getLeft(node) {
	let left = node.left;

	while (isConcatenation(left)) {
		left = left.right;
	}
	return left;
}

/**
 * Gets the left most node on the right side of a BinaryExpression with + operator.
 * @param {ASTNode} node A BinaryExpression node to check.
 * @returns {ASTNode} node
 */
function getRight(node) {
	let right = node.right;

	while (isConcatenation(right)) {
		right = right.left;
	}
	return right;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Disallow unnecessary concatenation of literals or template literals",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-useless-concat",
		},

		schema: [],

		messages: {
			unexpectedConcat: "Unexpected string concatenation of literals.",
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
			 * Reports a concatenation of two string literals.
			 * @param {ASTNode} node The `BinaryExpression` node.
			 * @returns {void}
			 */
			BinaryExpression(node) {
				// check if not concatenation
				if (node.operator !== "+") {
					return;
				}

				// account for the `foo + "a" + "b"` case
				const left = getLeft(node);
				const right = getRight(node);

				if (
					astUtils.isStringLiteral(left) &&
					astUtils.isStringLiteral(right) &&
					astUtils.isTokenOnSameLine(asToken(left), asToken(right))
				) {
					const operatorToken = sourceCode.getFirstTokenBetween(
						left,
						right,
						isConcatOperatorToken,
					);

					context.report({
						node,
						// `left` and `right` are operands of a `+` chain, so a `+` punctuator always sits between them.
						loc: /** @type {Token} */ (operatorToken).loc,
						messageId: "unexpectedConcat",
					});
				}
			},
		};
	},
};

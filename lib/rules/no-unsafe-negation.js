/**
 * @fileoverview Rule to disallow negating the left operand of relational operators
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

/** @typedef {import("../shared/types.js").Range} Range */
/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether the given operator is `in` or `instanceof`
 * @param {string} op The operator type to check.
 * @returns {boolean} `true` if the operator is `in` or `instanceof`
 */
function isInOrInstanceOfOperator(op) {
	return op === "in" || op === "instanceof";
}

/**
 * Checks whether the given operator is an ordering relational operator or not.
 * @param {string} op The operator type to check.
 * @returns {boolean} `true` if the operator is an ordering relational operator.
 */
function isOrderingRelationalOperator(op) {
	return op === "<" || op === ">" || op === ">=" || op === "<=";
}

/**
 * Checks whether the given node is a logical negation expression or not.
 * @param {ASTNode} node The node to check.
 * @returns {boolean} `true` if the node is a logical negation expression.
 */
function isNegation(node) {
	return node.type === "UnaryExpression" && node.operator === "!";
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				enforceForOrderingRelations: false,
			},
		],

		docs: {
			description:
				"Disallow negating the left operand of relational operators",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-unsafe-negation",
		},

		hasSuggestions: true,

		schema: [
			{
				type: "object",
				properties: {
					enforceForOrderingRelations: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		fixable: null,

		messages: {
			unexpected:
				"Unexpected negating the left operand of '{{operator}}' operator.",
			suggestNegatedExpression:
				"Negate '{{operator}}' expression instead of its left operand. This changes the current behavior.",
			suggestParenthesisedNegation:
				"Wrap negation in '()' to make the intention explicit. This preserves the current behavior.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const [{ enforceForOrderingRelations }] = context.options;

		return {
			/**
			 * Checks a binary expression for a negated left operand.
			 * @param {ASTNode} node The `BinaryExpression` node.
			 * @returns {void}
			 */
			BinaryExpression(node) {
				const operator = node.operator;
				const orderingRelationRuleApplies =
					enforceForOrderingRelations &&
					isOrderingRelationalOperator(operator);

				if (
					(isInOrInstanceOfOperator(operator) ||
						orderingRelationRuleApplies) &&
					isNegation(node.left) &&
					!astUtils.isParenthesised(sourceCode, node.left)
				) {
					context.report({
						node,
						loc: node.left.loc,
						messageId: "unexpected",
						data: { operator },
						suggest: [
							{
								messageId: "suggestNegatedExpression",
								data: { operator },
								/**
								 * Wraps the relational expression in parentheses so the negation applies to it.
								 * @param {RuleFixer} fixer The fixer to use.
								 * @returns {EditInfo} The fix.
								 */
								fix(fixer) {
									// `node.left` is a `UnaryExpression`, so its first token is the `!` operator.
									const negationToken = /** @type {Token} */ (
										sourceCode.getFirstToken(node.left)
									);
									const fixRange = /** @type {Range} */ ([
										negationToken.range[1],
										node.range[1],
									]);
									const text = sourceCode.text.slice(
										fixRange[0],
										fixRange[1],
									);

									return fixer.replaceTextRange(
										fixRange,
										`(${text})`,
									);
								},
							},
							{
								messageId: "suggestParenthesisedNegation",
								/**
								 * Wraps the negated operand in parentheses.
								 * @param {RuleFixer} fixer The fixer to use.
								 * @returns {EditInfo} The fix.
								 */
								fix(fixer) {
									return fixer.replaceText(
										node.left,
										`(${sourceCode.getText(node.left)})`,
									);
								},
							},
						],
					});
				}
			},
		};
	},
};

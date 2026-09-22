/**
 * @fileoverview Rule to flag no-unneeded-ternary
 * @author Gyandeep Singh
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

// Operators that always result in a boolean value
const BOOLEAN_OPERATORS = new Set([
	"==",
	"===",
	"!=",
	"!==",
	">",
	">=",
	"<",
	"<=",
	"in",
	"instanceof",
]);
const OPERATOR_INVERSES = {
	"==": "!=",
	"!=": "==",
	"===": "!==",
	"!==": "===",

	// Operators like < and >= are not true inverses, since both will return false with NaN.
};
/**
 * A stand-in `||` expression, built only so `getPrecedence()` can be asked
 * about that operator. `getPrecedence()` reads nothing but `type` and
 * `operator`, so the `parent`, `range` and `loc` an `ASTNode` declares are
 * left off and the cast goes through `unknown`.
 */
const OR_NODE = /** @type {ASTNode} */ (
	/** @type {unknown} */ ({ type: "LogicalExpression", operator: "||" })
);
const OR_PRECEDENCE = astUtils.getPrecedence(OR_NODE);

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [{ defaultAssignment: true }],

		docs: {
			description:
				"Disallow ternary operators when simpler alternatives exist",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-unneeded-ternary",
		},

		schema: [
			{
				type: "object",
				properties: {
					defaultAssignment: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		fixable: "code",

		messages: {
			unnecessaryConditionalExpression:
				"Unnecessary use of boolean literals in conditional expression.",
			unnecessaryConditionalAssignment:
				"Unnecessary use of conditional expression for default assignment.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ defaultAssignment }] = context.options;
		const sourceCode = context.sourceCode;

		/**
		 * Test if the node is a boolean literal
		 * @param {ASTNode} node The node to report.
		 * @returns {boolean} True if the its a boolean literal
		 * @private
		 */
		function isBooleanLiteral(node) {
			return node.type === "Literal" && typeof node.value === "boolean";
		}

		/**
		 * Creates an expression that represents the boolean inverse of the expression represented by the original node
		 * @param {ASTNode} node A node representing an expression
		 * @returns {string} A string representing an inverted expression
		 */
		function invertExpression(node) {
			const operatorInverses = /** @type {Record<string, string>} */ (
				OPERATOR_INVERSES
			);

			if (
				node.type === "BinaryExpression" &&
				Object.hasOwn(OPERATOR_INVERSES, node.operator)
			) {
				// a binary expression always has its operator token between the two operands
				const operatorToken = /** @type {Token} */ (
					sourceCode.getFirstTokenBetween(
						node.left,
						node.right,
						(/** @type {Token} */ token) =>
							token.value === node.operator,
					)
				);
				const text = sourceCode.getText();

				return (
					text.slice(node.range[0], operatorToken.range[0]) +
					operatorInverses[node.operator] +
					text.slice(operatorToken.range[1], node.range[1])
				);
			}

			/** A stand-in unary expression, built the same way as `OR_NODE` above. */
			const unaryNode = /** @type {ASTNode} */ (
				/** @type {unknown} */ ({ type: "UnaryExpression" })
			);

			if (
				astUtils.getPrecedence(node) < astUtils.getPrecedence(unaryNode)
			) {
				return `!(${astUtils.getParenthesisedText(sourceCode, node)})`;
			}
			return `!${astUtils.getParenthesisedText(sourceCode, node)}`;
		}

		/**
		 * Tests if a given node always evaluates to a boolean value
		 * @param {ASTNode} node An expression node
		 * @returns {boolean} True if it is determined that the node will always evaluate to a boolean value
		 */
		function isBooleanExpression(node) {
			return (
				(node.type === "BinaryExpression" &&
					BOOLEAN_OPERATORS.has(node.operator)) ||
				(node.type === "UnaryExpression" && node.operator === "!")
			);
		}

		/**
		 * Test if the node matches the pattern id ? id : expression
		 * @param {ASTNode} node The ConditionalExpression to check.
		 * @returns {boolean} True if the pattern is matched, and false otherwise
		 * @private
		 */
		function matchesDefaultAssignment(node) {
			return (
				node.test.type === "Identifier" &&
				node.consequent.type === "Identifier" &&
				node.test.name === node.consequent.name
			);
		}

		return {
			/**
			 * Reports a conditional expression that has a simpler equivalent.
			 * @param {ASTNode} node The `ConditionalExpression` node.
			 * @returns {void}
			 */
			ConditionalExpression(node) {
				if (
					isBooleanLiteral(node.alternate) &&
					isBooleanLiteral(node.consequent)
				) {
					context.report({
						node,
						messageId: "unnecessaryConditionalExpression",

						/**
						 * Replaces the conditional with the boolean it always produces.
						 * @param {RuleFixer} fixer The fixer.
						 * @returns {EditInfo | null} The edit, or `null` when the test may have side effects.
						 */
						fix(fixer) {
							if (
								node.consequent.value === node.alternate.value
							) {
								// Replace `foo ? true : true` with just `true`, but don't replace `foo() ? true : true`
								return node.test.type === "Identifier"
									? fixer.replaceText(
											node,
											node.consequent.value.toString(),
										)
									: null;
							}
							if (node.alternate.value) {
								// Replace `foo() ? false : true` with `!(foo())`
								return fixer.replaceText(
									node,
									invertExpression(node.test),
								);
							}

							// Replace `foo ? true : false` with `foo` if `foo` is guaranteed to be a boolean, or `!!foo` otherwise.

							return fixer.replaceText(
								node,
								isBooleanExpression(node.test)
									? astUtils.getParenthesisedText(
											sourceCode,
											node.test,
										)
									: `!${invertExpression(node.test)}`,
							);
						},
					});
				} else if (
					!defaultAssignment &&
					matchesDefaultAssignment(node)
				) {
					context.report({
						node,
						messageId: "unnecessaryConditionalAssignment",

						/**
						 * Replaces the default-assignment conditional with a `||` expression.
						 * @param {RuleFixer} fixer The fixer.
						 * @returns {EditInfo} The edit.
						 */
						fix(fixer) {
							const shouldParenthesizeAlternate =
								(astUtils.getPrecedence(node.alternate) <
									OR_PRECEDENCE ||
									astUtils.isCoalesceExpression(
										node.alternate,
									)) &&
								!astUtils.isParenthesised(
									sourceCode,
									node.alternate,
								);
							const alternateText = shouldParenthesizeAlternate
								? `(${sourceCode.getText(node.alternate)})`
								: astUtils.getParenthesisedText(
										sourceCode,
										node.alternate,
									);
							const testText = astUtils.getParenthesisedText(
								sourceCode,
								node.test,
							);

							return fixer.replaceText(
								node,
								`${testText} || ${alternateText}`,
							);
						},
					});
				}
			},
		};
	},
};

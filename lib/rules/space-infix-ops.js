/**
 * @fileoverview Require spaces around infix operators
 * @author Michael Ficarra
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

const { isEqToken } = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		deprecated: {
			message: "Formatting rules are being moved out of ESLint core.",
			url: "https://eslint.org/blog/2023/10/deprecating-formatting-rules/",
			deprecatedSince: "8.53.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"ESLint Stylistic now maintains deprecated stylistic core rules.",
					url: "https://eslint.style/guide/migration",
					plugin: {
						name: "@stylistic/eslint-plugin",
						url: "https://eslint.style",
					},
					rule: {
						name: "space-infix-ops",
						url: "https://eslint.style/rules/space-infix-ops",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Require spacing around infix operators",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/space-infix-ops",
		},

		fixable: "whitespace",

		schema: [
			{
				type: "object",
				properties: {
					int32Hint: {
						type: "boolean",
						default: false,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			missingSpace: "Operator '{{operator}}' must be spaced.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const int32Hint = context.options[0]
			? context.options[0].int32Hint === true
			: false;
		const sourceCode = context.sourceCode;

		/**
		 * Returns the first token which violates the rule
		 * @param {ASTNode} left The left node of the main node
		 * @param {ASTNode} right The right node of the main node
		 * @param {string} op The operator of the main node
		 * @returns {Token | null} The violator token or null
		 * @private
		 */
		function getFirstNonSpacedToken(left, right, op) {
			/*
			 * Every caller passes an operator the grammar puts between `left`
			 * and `right`, so the search always lands on that token, and the
			 * tokens on either side of an infix operator always exist.
			 */
			const operator = /** @type {Token} */ (
				sourceCode.getFirstTokenBetween(
					left,
					right,
					token => token.value === op,
				)
			);
			const prev = /** @type {Token} */ (
				sourceCode.getTokenBefore(operator)
			);
			const next = /** @type {Token} */ (
				sourceCode.getTokenAfter(operator)
			);

			if (
				!sourceCode.isSpaceBetween(prev, operator) ||
				!sourceCode.isSpaceBetween(operator, next)
			) {
				return operator;
			}

			return null;
		}

		/**
		 * Reports an AST node as a rule violation
		 * @param {ASTNode} mainNode The node to report
		 * @param {Token} culpritToken The token which has a problem
		 * @returns {void}
		 * @private
		 */
		function report(mainNode, culpritToken) {
			context.report({
				node: mainNode,
				loc: culpritToken.loc,
				messageId: "missingSpace",
				data: {
					operator: culpritToken.value,
				},
				/**
				 * Adds the missing space on either side of the operator.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					// An infix operator is always flanked by tokens.
					const previousToken = /** @type {Token} */ (
						sourceCode.getTokenBefore(culpritToken)
					);
					const afterToken = /** @type {Token} */ (
						sourceCode.getTokenAfter(culpritToken)
					);
					let fixString = "";

					if (culpritToken.range[0] - previousToken.range[1] === 0) {
						fixString = " ";
					}

					fixString += culpritToken.value;

					if (afterToken.range[0] - culpritToken.range[1] === 0) {
						fixString += " ";
					}

					return fixer.replaceText(culpritToken, fixString);
				},
			});
		}

		/**
		 * Check if the node is binary then report
		 * @param {ASTNode} node node to evaluate
		 * @returns {void}
		 * @private
		 */
		function checkBinary(node) {
			const leftNode = node.left.typeAnnotation
				? node.left.typeAnnotation
				: node.left;
			const rightNode = node.right;

			// search for = in AssignmentPattern nodes
			const operator = node.operator || "=";

			const nonSpacedNode = getFirstNonSpacedToken(
				leftNode,
				rightNode,
				operator,
			);

			if (nonSpacedNode) {
				if (!(int32Hint && sourceCode.getText(node).endsWith("|0"))) {
					report(node, nonSpacedNode);
				}
			}
		}

		/**
		 * Check if the node is conditional
		 * @param {ASTNode} node node to evaluate
		 * @returns {void}
		 * @private
		 */
		function checkConditional(node) {
			const nonSpacedConsequentNode = getFirstNonSpacedToken(
				node.test,
				node.consequent,
				"?",
			);
			const nonSpacedAlternateNode = getFirstNonSpacedToken(
				node.consequent,
				node.alternate,
				":",
			);

			if (nonSpacedConsequentNode) {
				report(node, nonSpacedConsequentNode);
			}

			if (nonSpacedAlternateNode) {
				report(node, nonSpacedAlternateNode);
			}
		}

		/**
		 * Check if the node is a variable
		 * @param {ASTNode} node node to evaluate
		 * @returns {void}
		 * @private
		 */
		function checkVar(node) {
			const leftNode = node.id.typeAnnotation
				? node.id.typeAnnotation
				: node.id;
			const rightNode = node.init;

			if (rightNode) {
				const nonSpacedNode = getFirstNonSpacedToken(
					leftNode,
					rightNode,
					"=",
				);

				if (nonSpacedNode) {
					report(node, nonSpacedNode);
				}
			}
		}

		return {
			AssignmentExpression: checkBinary,
			AssignmentPattern: checkBinary,
			BinaryExpression: checkBinary,
			LogicalExpression: checkBinary,
			ConditionalExpression: checkConditional,
			VariableDeclarator: checkVar,

			/**
			 * Checks the spacing around the `=` of a class property.
			 * @param {ASTNode} node The `PropertyDefinition` node.
			 * @returns {void}
			 */
			PropertyDefinition(node) {
				if (!node.value) {
					return;
				}

				/*
				 * Because of computed properties and type annotations, some
				 * tokens may exist between `node.key` and `=`.
				 * Therefore, find the `=` from the right.
				 *
				 * An initialized property definition always has that `=`, and
				 * it is always flanked by the key and the value.
				 */
				const operatorToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(node.value, isEqToken)
				);
				const leftToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(operatorToken)
				);
				const rightToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(operatorToken)
				);

				if (
					!sourceCode.isSpaceBetween(leftToken, operatorToken) ||
					!sourceCode.isSpaceBetween(operatorToken, rightToken)
				) {
					report(node, operatorToken);
				}
			},
		};
	},
};

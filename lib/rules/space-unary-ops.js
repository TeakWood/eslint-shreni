/**
 * @fileoverview This rule should require or disallow spaces before or after unary operations.
 * @author Marcin Kumorek
 * @deprecated in ESLint v8.53.0
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
						name: "space-unary-ops",
						url: "https://eslint.style/rules/space-unary-ops",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent spacing before or after unary operators",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/space-unary-ops",
		},

		fixable: "whitespace",

		schema: [
			{
				type: "object",
				properties: {
					words: {
						type: "boolean",
						default: true,
					},
					nonwords: {
						type: "boolean",
						default: false,
					},
					overrides: {
						type: "object",
						additionalProperties: {
							type: "boolean",
						},
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			unexpectedBefore:
				"Unexpected space before unary operator '{{operator}}'.",
			unexpectedAfter:
				"Unexpected space after unary operator '{{operator}}'.",
			unexpectedAfterWord:
				"Unexpected space after unary word operator '{{word}}'.",
			wordOperator:
				"Unary word operator '{{word}}' must be followed by whitespace.",
			operator:
				"Unary operator '{{operator}}' must be followed by whitespace.",
			beforeUnaryExpressions:
				"Space is required before unary expressions '{{token}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const options = context.options[0] || { words: true, nonwords: false };

		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Check if the node is the first "!" in a "!!" convert to Boolean expression
		 * @param {ASTNode} node AST node
		 * @returns {boolean} Whether or not the node is first "!" in "!!"
		 */
		function isFirstBangInBangBangExpression(node) {
			return (
				node &&
				node.type === "UnaryExpression" &&
				node.argument.operator === "!" &&
				node.argument &&
				node.argument.type === "UnaryExpression" &&
				node.argument.operator === "!"
			);
		}

		/**
		 * Checks if an override exists for a given operator.
		 * @param {string} operator Operator
		 * @returns {boolean} Whether or not an override has been provided for the operator
		 */
		function overrideExistsForOperator(operator) {
			return (
				options.overrides && Object.hasOwn(options.overrides, operator)
			);
		}

		/**
		 * Gets the value that the override was set to for this operator
		 * @param {string} operator Operator
		 * @returns {boolean} Whether or not an override enforces a space with this operator
		 */
		function overrideEnforcesSpaces(operator) {
			return options.overrides[operator];
		}

		/**
		 * Verify Unary Word Operator has spaces after the word operator
		 * @param {ASTNode} node AST node
		 * @param {Token} firstToken first token from the AST node
		 * @param {Token} secondToken second token from the AST node
		 * @param {string} word The word to be used for reporting
		 * @returns {void}
		 */
		function verifyWordHasSpaces(node, firstToken, secondToken, word) {
			if (secondToken.range[0] === firstToken.range[1]) {
				context.report({
					node,
					messageId: "wordOperator",
					data: {
						word,
					},
					/**
					 * Inserts the missing space after the word operator.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix(fixer) {
						return fixer.insertTextAfter(firstToken, " ");
					},
				});
			}
		}

		/**
		 * Verify Unary Word Operator doesn't have spaces after the word operator
		 * @param {ASTNode} node AST node
		 * @param {Token} firstToken first token from the AST node
		 * @param {Token} secondToken second token from the AST node
		 * @param {string} word The word to be used for reporting
		 * @returns {void}
		 */
		function verifyWordDoesntHaveSpaces(
			node,
			firstToken,
			secondToken,
			word,
		) {
			if (astUtils.canTokensBeAdjacent(firstToken, secondToken)) {
				if (secondToken.range[0] > firstToken.range[1]) {
					context.report({
						node,
						messageId: "unexpectedAfterWord",
						data: {
							word,
						},
						/**
						 * Removes the disallowed space after the word operator.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.removeRange([
								firstToken.range[1],
								secondToken.range[0],
							]);
						},
					});
				}
			}
		}

		/**
		 * Check Unary Word Operators for spaces after the word operator
		 * @param {ASTNode} node AST node
		 * @param {Token} firstToken first token from the AST node
		 * @param {Token} secondToken second token from the AST node
		 * @param {string} word The word to be used for reporting
		 * @returns {void}
		 */
		function checkUnaryWordOperatorForSpaces(
			node,
			firstToken,
			secondToken,
			word,
		) {
			if (overrideExistsForOperator(word)) {
				if (overrideEnforcesSpaces(word)) {
					verifyWordHasSpaces(node, firstToken, secondToken, word);
				} else {
					verifyWordDoesntHaveSpaces(
						node,
						firstToken,
						secondToken,
						word,
					);
				}
			} else if (options.words) {
				verifyWordHasSpaces(node, firstToken, secondToken, word);
			} else {
				verifyWordDoesntHaveSpaces(node, firstToken, secondToken, word);
			}
		}

		/**
		 * Verifies YieldExpressions satisfy spacing requirements
		 * @param {ASTNode} node AST node
		 * @returns {void}
		 */
		function checkForSpacesAfterYield(node) {
			const tokens = sourceCode.getFirstTokens(node, 3),
				word = "yield";

			if (!node.argument || node.delegate) {
				return;
			}

			checkUnaryWordOperatorForSpaces(node, tokens[0], tokens[1], word);
		}

		/**
		 * Verifies AwaitExpressions satisfy spacing requirements
		 * @param {ASTNode} node AwaitExpression AST node
		 * @returns {void}
		 */
		function checkForSpacesAfterAwait(node) {
			const tokens = sourceCode.getFirstTokens(node, 3);

			checkUnaryWordOperatorForSpaces(
				node,
				tokens[0],
				tokens[1],
				"await",
			);
		}

		/**
		 * Verifies UnaryExpression, UpdateExpression and NewExpression have spaces before or after the operator
		 * @param {ASTNode} node AST node
		 * @param {Token} firstToken First token in the expression
		 * @param {Token} secondToken Second token in the expression
		 * @returns {void}
		 */
		function verifyNonWordsHaveSpaces(node, firstToken, secondToken) {
			if (node.prefix) {
				if (isFirstBangInBangBangExpression(node)) {
					return;
				}
				if (firstToken.range[1] === secondToken.range[0]) {
					context.report({
						node,
						messageId: "operator",
						data: {
							operator: firstToken.value,
						},
						/**
						 * Inserts the missing space after the operator.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.insertTextAfter(firstToken, " ");
						},
					});
				}
			} else {
				if (firstToken.range[1] === secondToken.range[0]) {
					context.report({
						node,
						messageId: "beforeUnaryExpressions",
						data: {
							token: secondToken.value,
						},
						/**
						 * Inserts the missing space before the operator.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.insertTextBefore(secondToken, " ");
						},
					});
				}
			}
		}

		/**
		 * Verifies UnaryExpression, UpdateExpression and NewExpression don't have spaces before or after the operator
		 * @param {ASTNode} node AST node
		 * @param {Token} firstToken First token in the expression
		 * @param {Token} secondToken Second token in the expression
		 * @returns {void}
		 */
		function verifyNonWordsDontHaveSpaces(node, firstToken, secondToken) {
			if (node.prefix) {
				if (secondToken.range[0] > firstToken.range[1]) {
					context.report({
						node,
						messageId: "unexpectedAfter",
						data: {
							operator: firstToken.value,
						},
						/**
						 * Removes the disallowed space after the operator, when
						 * doing so would not glue two tokens together.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo | null} The fix, or `null` if there is none.
						 */
						fix(fixer) {
							if (
								astUtils.canTokensBeAdjacent(
									firstToken,
									secondToken,
								)
							) {
								return fixer.removeRange([
									firstToken.range[1],
									secondToken.range[0],
								]);
							}
							return null;
						},
					});
				}
			} else {
				if (secondToken.range[0] > firstToken.range[1]) {
					context.report({
						node,
						messageId: "unexpectedBefore",
						data: {
							operator: secondToken.value,
						},
						/**
						 * Removes the disallowed space before the operator.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.removeRange([
								firstToken.range[1],
								secondToken.range[0],
							]);
						},
					});
				}
			}
		}

		/**
		 * Verifies UnaryExpression, UpdateExpression and NewExpression satisfy spacing requirements
		 * @param {ASTNode} node AST node
		 * @returns {void}
		 */
		function checkForSpaces(node) {
			const tokens =
				node.type === "UpdateExpression" && !node.prefix
					? sourceCode.getLastTokens(node, 2)
					: sourceCode.getFirstTokens(node, 2);
			const firstToken = tokens[0];
			const secondToken = tokens[1];

			if (
				(node.type === "NewExpression" || node.prefix) &&
				firstToken.type === "Keyword"
			) {
				checkUnaryWordOperatorForSpaces(
					node,
					firstToken,
					secondToken,
					firstToken.value,
				);
				return;
			}

			const operator = node.prefix ? tokens[0].value : tokens[1].value;

			if (overrideExistsForOperator(operator)) {
				if (overrideEnforcesSpaces(operator)) {
					verifyNonWordsHaveSpaces(node, firstToken, secondToken);
				} else {
					verifyNonWordsDontHaveSpaces(node, firstToken, secondToken);
				}
			} else if (options.nonwords) {
				verifyNonWordsHaveSpaces(node, firstToken, secondToken);
			} else {
				verifyNonWordsDontHaveSpaces(node, firstToken, secondToken);
			}
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			UnaryExpression: checkForSpaces,
			UpdateExpression: checkForSpaces,
			NewExpression: checkForSpaces,
			YieldExpression: checkForSpacesAfterYield,
			AwaitExpression: checkForSpacesAfterAwait,
		};
	},
};

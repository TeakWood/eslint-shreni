/**
 * @fileoverview Disallow construction of dense arrays using the Array constructor
 * @author Matt DuVall <http://www.mattduvall.com/>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const {
	getVariableByName,
	isClosingParenToken,
	isOpeningParenToken,
	isStartOfExpressionStatement,
	needsPrecedingSemicolon,
} = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow `Array` constructors",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-array-constructor",
		},

		fixable: "code",

		hasSuggestions: true,

		schema: [],

		messages: {
			preferLiteral: "The array literal notation [] is preferable.",
			useLiteral: "Replace with an array literal.",
			useLiteralAfterSemicolon:
				"Replace with an array literal, add preceding semicolon.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Checks if there are comments in Array constructor expressions.
		 * @param {ASTNode} node A CallExpression or NewExpression node.
		 * @returns {boolean} True if there are comments, false otherwise.
		 */
		function hasCommentsInArrayConstructor(node) {
			const firstToken = /** @type {Token} */ (
				sourceCode.getFirstToken(node)
			);
			const lastToken = sourceCode.getLastToken(node);

			let lastRelevantToken = /** @type {Token} */ (
				sourceCode.getLastToken(node.callee)
			);

			while (
				lastRelevantToken !== lastToken &&
				!isOpeningParenToken(lastRelevantToken)
			) {
				lastRelevantToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(lastRelevantToken)
				);
			}

			return sourceCode.commentsExistBetween(
				firstToken,
				lastRelevantToken,
			);
		}

		/**
		 * Gets the text between the calling parentheses of a CallExpression or NewExpression.
		 * @param {ASTNode} node A CallExpression or NewExpression node.
		 * @returns {string} The text between the calling parentheses, or an empty string if there are none.
		 */
		function getArgumentsText(node) {
			const lastToken = /** @type {Token} */ (
				sourceCode.getLastToken(node)
			);

			if (!isClosingParenToken(lastToken)) {
				return "";
			}

			/** @type {ASTNode | Token} */
			let firstToken = node.callee;

			do {
				// The `null` case is still handled by the check below.
				firstToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(firstToken)
				);
				if (!firstToken || firstToken === lastToken) {
					return "";
				}
			} while (!isOpeningParenToken(firstToken));

			return sourceCode.text.slice(
				firstToken.range[1],
				lastToken.range[0],
			);
		}

		/**
		 * Disallow construction of dense arrays using the Array constructor
		 * @param {ASTNode} node node to evaluate
		 * @returns {void} No return value.
		 * @private
		 */
		function check(node) {
			if (
				node.callee.type !== "Identifier" ||
				node.callee.name !== "Array" ||
				node.typeArguments ||
				(node.arguments.length === 1 &&
					node.arguments[0].type !== "SpreadElement")
			) {
				return;
			}

			const variable = getVariableByName(
				sourceCode.getScope(node),
				"Array",
			);

			/*
			 * Check if `Array` is a predefined global variable: predefined globals have no declarations,
			 * meaning that the `identifiers` list of the variable object is empty.
			 */
			if (variable && variable.identifiers.length === 0) {
				const argsText = getArgumentsText(node);
				let fixText;
				let messageId;

				const nonSpreadCount = node.arguments.reduce(
					(
						/** @type {number} */ count,
						/** @type {ASTNode} */ arg,
					) => (arg.type !== "SpreadElement" ? count + 1 : count),
					0,
				);

				const shouldSuggest =
					node.optional ||
					(node.arguments.length > 0 && nonSpreadCount < 2) ||
					hasCommentsInArrayConstructor(node);

				/*
				 * Check if the suggested change should include a preceding semicolon or not.
				 * Due to JavaScript's ASI rules, a missing semicolon may be inserted automatically
				 * before an expression like `Array()` or `new Array()`, but not when the expression
				 * is changed into an array literal like `[]`.
				 */
				if (
					isStartOfExpressionStatement(node) &&
					needsPrecedingSemicolon(sourceCode, node)
				) {
					fixText = `;[${argsText}]`;
					messageId = "useLiteralAfterSemicolon";
				} else {
					fixText = `[${argsText}]`;
					messageId = "useLiteral";
				}

				context.report({
					node,
					messageId: "preferLiteral",
					/**
					 * Replaces the `Array` constructor call with an array literal.
					 * @param {RuleFixer} fixer The fixer to build the edit with.
					 * @returns {EditInfo | null} The edit, or `null` if only a suggestion should be offered.
					 */
					fix(fixer) {
						if (shouldSuggest) {
							return null;
						}

						return fixer.replaceText(node, fixText);
					},
					suggest: [
						{
							messageId,
							/**
							 * Replaces the `Array` constructor call with an array literal.
							 * @param {RuleFixer} fixer The fixer to build the edit with.
							 * @returns {EditInfo | null} The edit, or `null` if the problem is auto-fixed instead.
							 */
							fix(fixer) {
								if (shouldSuggest) {
									return fixer.replaceText(node, fixText);
								}

								return null;
							},
						},
					],
				});
			}
		}

		return {
			CallExpression: check,
			NewExpression: check,
		};
	},
};

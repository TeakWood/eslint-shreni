/**
 * @fileoverview Rule to flag when using constructor without parentheses
 * @author Ilya Volodin
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
// Helpers
//------------------------------------------------------------------------------

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
						name: "new-parens",
						url: "https://eslint.style/rules/new-parens",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce or disallow parentheses when invoking a constructor with no arguments",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/new-parens",
		},

		fixable: "code",
		schema: [
			{
				enum: ["always", "never"],
			},
		],
		messages: {
			missing: "Missing '()' invoking a constructor.",
			unnecessary:
				"Unnecessary '()' invoking a constructor with no arguments.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const options = context.options;
		const always = options[0] !== "never"; // Default is always

		const sourceCode = context.sourceCode;

		return {
			/**
			 * Checks the parentheses of a `new` expression with no arguments.
			 * @param {ASTNode} node The `NewExpression` node.
			 * @returns {void}
			 */
			NewExpression(node) {
				if (node.arguments.length !== 0) {
					return; // if there are arguments, there have to be parens
				}

				const lastToken = sourceCode.getLastToken(node);
				const hasLastParen =
					lastToken && astUtils.isClosingParenToken(lastToken);

				/*
				 * `hasParens` is true only if the new expression ends with its own parens, e.g., new new foo() does not end with its own parens.
				 * `hasLastParen` is only truthy when `lastToken` is a token, and a token inside the expression always has a token before it.
				 */
				const hasParens =
					hasLastParen &&
					astUtils.isOpeningParenToken(
						/** @type {Token} */ (
							sourceCode.getTokenBefore(lastToken)
						),
					) &&
					node.callee.range[1] < node.range[1];

				if (always) {
					if (!hasParens) {
						context.report({
							node,
							messageId: "missing",
							/**
							 * Adds the missing parentheses.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix: fixer => fixer.insertTextAfter(node, "()"),
						});
					}
				} else {
					if (hasParens) {
						context.report({
							node,
							messageId: "unnecessary",
							/**
							 * Removes the unnecessary parentheses, wrapping the expression instead so that it keeps its precedence.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {Array<EditInfo>} The fixes.
							 */
							fix: fixer => [
								fixer.remove(
									/** @type {Token} */ (
										sourceCode.getTokenBefore(lastToken)
									),
								),
								fixer.remove(lastToken),
								fixer.insertTextBefore(node, "("),
								fixer.insertTextAfter(node, ")"),
							],
						});
					}
				}
			},
		};
	},
};

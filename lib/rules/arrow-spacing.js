/**
 * @fileoverview Rule to define spacing before/after arrow function's arrow.
 * @author Jxck
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

/**
 * The `=>` token together with the tokens on either side of it.
 * @typedef {{ before: Token, arrow: Token, after: Token }} ArrowTokens
 */

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
						name: "arrow-spacing",
						url: "https://eslint.style/rules/arrow-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent spacing before and after the arrow in arrow functions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/arrow-spacing",
		},

		fixable: "whitespace",

		schema: [
			{
				type: "object",
				properties: {
					before: {
						type: "boolean",
						default: true,
					},
					after: {
						type: "boolean",
						default: true,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			expectedBefore: "Missing space before =>.",
			unexpectedBefore: "Unexpected space before =>.",

			expectedAfter: "Missing space after =>.",
			unexpectedAfter: "Unexpected space after =>.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		// merge rules with default
		const rule = Object.assign({}, context.options[0]);

		rule.before = rule.before !== false;
		rule.after = rule.after !== false;

		const sourceCode = context.sourceCode;

		/**
		 * Get tokens of arrow(`=>`) and before/after arrow.
		 * @param {ASTNode} node The arrow function node.
		 * @returns {ArrowTokens} Tokens of arrow and before/after arrow.
		 */
		function getTokens(node) {
			/*
			 * An arrow function always has a `=>`, always has a parameter list
			 * or `(` before it, and always has a body after it, so none of
			 * these three lookups can fail.
			 */
			const arrow = /** @type {Token} */ (
				sourceCode.getTokenBefore(node.body, astUtils.isArrowToken)
			);

			return {
				before: /** @type {Token} */ (sourceCode.getTokenBefore(arrow)),
				arrow,
				after: /** @type {Token} */ (sourceCode.getTokenAfter(arrow)),
			};
		}

		/**
		 * Count spaces before/after arrow(`=>`) token.
		 * @param {ArrowTokens} tokens Tokens before/after arrow.
		 * @returns {{ before: number, after: number }} count of space before/after arrow.
		 */
		function countSpaces(tokens) {
			const before = tokens.arrow.range[0] - tokens.before.range[1];
			const after = tokens.after.range[0] - tokens.arrow.range[1];

			return { before, after };
		}

		/**
		 * Determines whether space(s) before after arrow(`=>`) is satisfy rule.
		 * if before/after value is `true`, there should be space(s).
		 * if before/after value is `false`, there should be no space.
		 * @param {ASTNode} node The arrow function node.
		 * @returns {void}
		 */
		function spaces(node) {
			const tokens = getTokens(node);
			const countSpace = countSpaces(tokens);

			if (rule.before) {
				// should be space(s) before arrow
				if (countSpace.before === 0) {
					context.report({
						node: tokens.before,
						messageId: "expectedBefore",
						/**
						 * Inserts the required space before the arrow.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.insertTextBefore(tokens.arrow, " ");
						},
					});
				}
			} else {
				// should be no space before arrow
				if (countSpace.before > 0) {
					context.report({
						node: tokens.before,
						messageId: "unexpectedBefore",
						/**
						 * Removes the space before the arrow.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.removeRange([
								tokens.before.range[1],
								tokens.arrow.range[0],
							]);
						},
					});
				}
			}

			if (rule.after) {
				// should be space(s) after arrow
				if (countSpace.after === 0) {
					context.report({
						node: tokens.after,
						messageId: "expectedAfter",
						/**
						 * Inserts the required space after the arrow.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.insertTextAfter(tokens.arrow, " ");
						},
					});
				}
			} else {
				// should be no space after arrow
				if (countSpace.after > 0) {
					context.report({
						node: tokens.after,
						messageId: "unexpectedAfter",
						/**
						 * Removes the space after the arrow.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.removeRange([
								tokens.arrow.range[1],
								tokens.after.range[0],
							]);
						},
					});
				}
			}
		}

		return {
			ArrowFunctionExpression: spaces,
		};
	},
};

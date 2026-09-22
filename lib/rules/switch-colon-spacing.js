/**
 * @fileoverview Rule to enforce spacing around colons of switch statements.
 * @author Toru Nagashima
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
						name: "switch-colon-spacing",
						url: "https://eslint.style/rules/switch-colon-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce spacing around colons of switch statements",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/switch-colon-spacing",
		},

		schema: [
			{
				type: "object",
				properties: {
					before: { type: "boolean", default: false },
					after: { type: "boolean", default: true },
				},
				additionalProperties: false,
			},
		],
		fixable: "whitespace",
		messages: {
			expectedBefore: "Expected space(s) before this colon.",
			expectedAfter: "Expected space(s) after this colon.",
			unexpectedBefore: "Unexpected space(s) before this colon.",
			unexpectedAfter: "Unexpected space(s) after this colon.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const options = context.options[0] || {};
		const beforeSpacing = options.before === true; // false by default
		const afterSpacing = options.after !== false; // true by default

		/**
		 * Check whether the spacing between the given 2 tokens is valid or not.
		 * @param {Token} left The left token to check.
		 * @param {Token} right The right token to check.
		 * @param {boolean} expected The expected spacing to check. `true` if there should be a space.
		 * @returns {boolean} `true` if the spacing between the tokens is valid.
		 */
		function isValidSpacing(left, right, expected) {
			return (
				astUtils.isClosingBraceToken(right) ||
				!astUtils.isTokenOnSameLine(left, right) ||
				sourceCode.isSpaceBetween(left, right) === expected
			);
		}

		/**
		 * Check whether comments exist between the given 2 tokens.
		 * @param {Token} left The left token to check.
		 * @param {Token} right The right token to check.
		 * @returns {boolean} `true` if comments exist between the given 2 tokens.
		 */
		function commentsExistBetween(left, right) {
			return (
				sourceCode.getFirstTokenBetween(left, right, {
					includeComments: true,
					filter: astUtils.isCommentToken,
				}) !== null
			);
		}

		/**
		 * Fix the spacing between the given 2 tokens.
		 * @param {RuleFixer} fixer The fixer to fix.
		 * @param {Token} left The left token of fix range.
		 * @param {Token} right The right token of fix range.
		 * @param {boolean} spacing The spacing style. `true` if there should be a space.
		 * @returns {EditInfo | null} The fix object, or `null` if there are comments in the way.
		 */
		function fix(fixer, left, right, spacing) {
			if (commentsExistBetween(left, right)) {
				return null;
			}
			if (spacing) {
				return fixer.insertTextAfter(left, " ");
			}
			return fixer.removeRange([left.range[1], right.range[0]]);
		}

		return {
			/**
			 * Checks the spacing around the colon of a switch case.
			 * @param {ASTNode} node The `SwitchCase` node to check.
			 * @returns {void}
			 */
			SwitchCase(node) {
				const colonToken = astUtils.getSwitchCaseColonToken(
					node,
					sourceCode,
				);

				/*
				 * A `SwitchCase` always has a colon, and it is always preceded
				 * and followed by a token (`switch`/`case`/`default` before it,
				 * and at minimum the switch statement's `}` after it).
				 */
				const beforeToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(colonToken)
				);
				const afterToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(colonToken)
				);

				if (!isValidSpacing(beforeToken, colonToken, beforeSpacing)) {
					context.report({
						node,
						loc: colonToken.loc,
						messageId: beforeSpacing
							? "expectedBefore"
							: "unexpectedBefore",
						/**
						 * Corrects the spacing before the colon.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo | null} The fix.
						 */
						fix: fixer =>
							fix(fixer, beforeToken, colonToken, beforeSpacing),
					});
				}
				if (!isValidSpacing(colonToken, afterToken, afterSpacing)) {
					context.report({
						node,
						loc: colonToken.loc,
						messageId: afterSpacing
							? "expectedAfter"
							: "unexpectedAfter",
						/**
						 * Corrects the spacing after the colon.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo | null} The fix.
						 */
						fix: fixer =>
							fix(fixer, colonToken, afterToken, afterSpacing),
					});
				}
			},
		};
	},
};

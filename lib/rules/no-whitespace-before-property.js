/**
 * @fileoverview Rule to disallow whitespace before properties
 * @author Kai Cataldo
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
/** @typedef {import("../shared/types.js").EditInfo} EditInfo */
/** @typedef {import("../shared/types.js").RuleFixer} RuleFixer */

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
						name: "no-whitespace-before-property",
						url: "https://eslint.style/rules/no-whitespace-before-property",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Disallow whitespace before properties",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-whitespace-before-property",
		},

		fixable: "whitespace",
		schema: [],

		messages: {
			unexpectedWhitespace:
				"Unexpected whitespace before property {{propName}}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Reports whitespace before property token
		 * @param {ASTNode} node the node to report in the event of an error
		 * @param {Token} leftToken the left token
		 * @param {Token} rightToken the right token
		 * @returns {void}
		 * @private
		 */
		function reportError(node, leftToken, rightToken) {
			context.report({
				node,
				messageId: "unexpectedWhitespace",
				data: {
					propName: sourceCode.getText(node.property),
				},

				/**
				 * Removes the whitespace before the property.
				 * @param {RuleFixer} fixer The fixer to build the edit with.
				 * @returns {EditInfo | null} The edit, or `null` when it is not safe to fix.
				 */
				fix(fixer) {
					let replacementText = "";

					if (
						!node.computed &&
						!node.optional &&
						astUtils.isDecimalInteger(node.object)
					) {
						/*
						 * If the object is a number literal, fixing it to something like 5.toString() would cause a SyntaxError.
						 * Don't fix this case.
						 */
						return null;
					}

					// Don't fix if comments exist.
					if (
						sourceCode.commentsExistBetween(leftToken, rightToken)
					) {
						return null;
					}

					if (node.optional) {
						replacementText = "?.";
					} else if (!node.computed) {
						replacementText = ".";
					}

					return fixer.replaceTextRange(
						[leftToken.range[1], rightToken.range[0]],
						replacementText,
					);
				},
			});
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks a member expression for whitespace before its property.
			 * @param {ASTNode} node The `MemberExpression` node.
			 * @returns {void}
			 */
			MemberExpression(node) {
				/** @type {Token} */
				let rightToken;

				/** @type {Token} */
				let leftToken;

				if (!astUtils.isTokenOnSameLine(node.object, node.property)) {
					return;
				}

				/*
				 * A `MemberExpression` always has an object before its property, so
				 * neither the property's first token nor any of the tokens preceding
				 * it can be missing: the four lookups below never return `null`.
				 */
				if (node.computed) {
					rightToken = /** @type {Token} */ (
						sourceCode.getTokenBefore(
							node.property,
							astUtils.isOpeningBracketToken,
						)
					);
					leftToken = /** @type {Token} */ (
						sourceCode.getTokenBefore(
							rightToken,
							node.optional ? 1 : 0,
						)
					);
				} else {
					rightToken = /** @type {Token} */ (
						sourceCode.getFirstToken(node.property)
					);
					leftToken = /** @type {Token} */ (
						sourceCode.getTokenBefore(rightToken, 1)
					);
				}

				if (sourceCode.isSpaceBetween(leftToken, rightToken)) {
					reportError(node, leftToken, rightToken);
				}
			},
		};
	},
};

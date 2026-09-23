/**
 * @fileoverview enforce the location of arrow function bodies
 * @author Sharmila Jesupaul
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

const { isCommentToken, isNotOpeningParenToken } = require("./utils/ast-utils");

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
						name: "implicit-arrow-linebreak",
						url: "https://eslint.style/rules/implicit-arrow-linebreak",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce the location of arrow function bodies",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/implicit-arrow-linebreak",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["beside", "below"],
			},
		],
		messages: {
			expected: "Expected a linebreak before this expression.",
			unexpected: "Expected no linebreak before this expression.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const option = context.options[0] || "beside";

		/**
		 * Validates the location of an arrow function body
		 * @param {ASTNode} node The arrow function body
		 * @returns {void}
		 */
		function validateExpression(node) {
			if (node.body.type === "BlockStatement") {
				return;
			}

			/*
			 * The grammar guarantees both of these exist: a concise arrow body is
			 * always preceded by its `=>` token, which in turn is always followed
			 * by the first token of the body.
			 */
			const arrowToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(node.body, isNotOpeningParenToken)
			);
			const firstTokenOfBody = /** @type {Token} */ (
				sourceCode.getTokenAfter(arrowToken)
			);

			if (
				arrowToken.loc.end.line === firstTokenOfBody.loc.start.line &&
				option === "below"
			) {
				context.report({
					node: firstTokenOfBody,
					messageId: "expected",
					/**
					 * Inserts the missing linebreak before the arrow function body.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix: fixer =>
						fixer.insertTextBefore(firstTokenOfBody, "\n"),
				});
			} else if (
				arrowToken.loc.end.line !== firstTokenOfBody.loc.start.line &&
				option === "beside"
			) {
				context.report({
					node: firstTokenOfBody,
					messageId: "unexpected",
					/**
					 * Removes the unexpected linebreak before the arrow function body, unless a comment sits in the way.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo|null} The fix, or `null` if it is not safe to apply one.
					 */
					fix(fixer) {
						if (
							sourceCode.getFirstTokenBetween(
								arrowToken,
								firstTokenOfBody,
								{
									includeComments: true,
									filter: isCommentToken,
								},
							)
						) {
							return null;
						}

						return fixer.replaceTextRange(
							[arrowToken.range[1], firstTokenOfBody.range[0]],
							" ",
						);
					},
				});
			}
		}

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------
		return {
			/**
			 * Validates the body location of an arrow function.
			 * @param {ASTNode} node The `ArrowFunctionExpression` node.
			 * @returns {void}
			 */
			ArrowFunctionExpression: node => validateExpression(node),
		};
	},
};

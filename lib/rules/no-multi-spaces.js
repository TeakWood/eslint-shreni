/**
 * @fileoverview Disallow use of multiple spaces.
 * @author Nicholas C. Zakas
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

/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/ast-utils.js").Comment} Comment */
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
						name: "no-multi-spaces",
						url: "https://eslint.style/rules/no-multi-spaces",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Disallow multiple spaces",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-multi-spaces",
		},

		fixable: "whitespace",

		schema: [
			{
				type: "object",
				properties: {
					exceptions: {
						type: "object",
						patternProperties: {
							"^([A-Z][a-z]*)+$": {
								type: "boolean",
							},
						},
						additionalProperties: false,
					},
					ignoreEOLComments: {
						type: "boolean",
						default: false,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			multipleSpaces: "Multiple spaces found before '{{displayValue}}'.",
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
		const ignoreEOLComments = options.ignoreEOLComments;
		const exceptions = Object.assign(
			{ Property: true },
			options.exceptions,
		);
		const hasExceptions = Object.keys(exceptions).some(
			key => exceptions[key],
		);

		/**
		 * Formats value of given comment token for error message by truncating its length.
		 * @param {Comment} token comment token
		 * @returns {string} formatted value
		 * @private
		 */
		function formatReportedCommentValue(token) {
			const valueLines = token.value.split("\n");
			const value = valueLines[0];
			const formattedValue = `${value.slice(0, 12)}...`;

			return valueLines.length === 1 && value.length <= 12
				? value
				: formattedValue;
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks every gap between two adjacent tokens or comments in the file.
			 * @returns {void}
			 */
			Program() {
				sourceCode.tokensAndComments.forEach(
					(leftToken, leftIndex, tokensAndComments) => {
						if (leftIndex === tokensAndComments.length - 1) {
							return;
						}
						const rightToken = tokensAndComments[leftIndex + 1];

						// Ignore tokens that don't have 2 spaces between them or are on different lines
						if (
							!sourceCode.text
								.slice(leftToken.range[1], rightToken.range[0])
								.includes("  ") ||
							leftToken.loc.end.line < rightToken.loc.start.line
						) {
							return;
						}

						// Ignore comments that are the last token on their line if `ignoreEOLComments` is active.
						if (
							ignoreEOLComments &&
							astUtils.isCommentToken(rightToken) &&
							(leftIndex === tokensAndComments.length - 2 ||
								rightToken.loc.end.line <
									tokensAndComments[leftIndex + 2].loc.start
										.line)
						) {
							return;
						}

						// Ignore tokens that are in a node in the "exceptions" object
						if (hasExceptions) {
							const parentNode = sourceCode.getNodeByRangeIndex(
								rightToken.range[0] - 1,
							);

							if (parentNode && exceptions[parentNode.type]) {
								return;
							}
						}

						let displayValue;

						// A "Block" or "Line" `type` only ever occurs on a comment.
						if (rightToken.type === "Block") {
							displayValue = `/*${formatReportedCommentValue(/** @type {Comment} */ (rightToken))}*/`;
						} else if (rightToken.type === "Line") {
							displayValue = `//${formatReportedCommentValue(/** @type {Comment} */ (rightToken))}`;
						} else {
							displayValue = rightToken.value;
						}

						context.report({
							node: rightToken,
							loc: {
								start: leftToken.loc.end,
								end: rightToken.loc.start,
							},
							messageId: "multipleSpaces",
							data: { displayValue },
							/**
							 * Collapses the run of whitespace down to a single space.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix: fixer =>
								fixer.replaceTextRange(
									[leftToken.range[1], rightToken.range[0]],
									" ",
								),
						});
					},
				);
			},
		};
	},
};

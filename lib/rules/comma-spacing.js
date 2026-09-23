/**
 * @fileoverview Comma spacing - validates spacing before and after comma
 * @author Vignesh Anand aka vegetableman.
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Comment} Comment */
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
						name: "comma-spacing",
						url: "https://eslint.style/rules/comma-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent spacing before and after commas",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/comma-spacing",
		},

		fixable: "whitespace",

		schema: [
			{
				type: "object",
				properties: {
					before: {
						type: "boolean",
						default: false,
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
			missing: "A space is required {{loc}} ','.",
			unexpected: "There should be no space {{loc}} ','.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const tokensAndComments = sourceCode.tokensAndComments;

		/** @type {{ before: boolean, after: boolean }} */
		const options = {
			before: context.options[0] ? context.options[0].before : false,
			after: context.options[0] ? context.options[0].after : true,
		};

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		// list of comma tokens to ignore for the check of leading whitespace
		/** @type {Array<Token>} */
		const commaTokensToIgnore = [];

		/**
		 * Reports a spacing error with an appropriate message.
		 * @param {Token} node The binary expression node to report.
		 * @param {"before" | "after"} loc Is the error "before" or "after" the comma?
		 * @param {Token} otherNode The node at the left or right of `node`
		 * @returns {void}
		 * @private
		 */
		function report(node, loc, otherNode) {
			context.report({
				node,
				/**
				 * Adds or removes the whitespace on the reported side of the comma.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The edit that fixes the spacing.
				 */
				fix(fixer) {
					if (options[loc]) {
						if (loc === "before") {
							return fixer.insertTextBefore(node, " ");
						}
						return fixer.insertTextAfter(node, " ");
					}
					let start, end;
					const newText = "";

					if (loc === "before") {
						start = otherNode.range[1];
						end = node.range[0];
					} else {
						start = node.range[1];
						end = otherNode.range[0];
					}

					return fixer.replaceTextRange([start, end], newText);
				},
				messageId: options[loc] ? "missing" : "unexpected",
				data: {
					loc,
				},
			});
		}

		/**
		 * Adds null elements of the given ArrayExpression or ArrayPattern node to the ignore list.
		 * @param {ASTNode} node An ArrayExpression or ArrayPattern node.
		 * @returns {void}
		 */
		function addNullElementsToIgnoreList(node) {
			/*
			 * The node always opens with `[`, and every element is followed by
			 * either a `,` or the closing `]`, so each of these lookups is
			 * guaranteed by the grammar to find a token.
			 */
			let previousToken = /** @type {Token} */ (
				sourceCode.getFirstToken(node)
			);

			node.elements.forEach(
				/**
				 * Records the comma that terminates this element when it is a hole.
				 * @param {ASTNode | null} element The element, or `null` for a hole.
				 * @returns {void}
				 */
				element => {
					let token;

					if (element === null) {
						token = /** @type {Token} */ (
							sourceCode.getTokenAfter(previousToken)
						);

						if (astUtils.isCommaToken(token)) {
							commaTokensToIgnore.push(token);
						}
					} else {
						token = /** @type {Token} */ (
							sourceCode.getTokenAfter(element)
						);
					}

					previousToken = token;
				},
			);
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks the spacing around every comma token in the file.
			 * @returns {void}
			 */
			"Program:exit"() {
				tokensAndComments.forEach(
					/**
					 * Checks the spacing around the token if it is a comma.
					 * @param {Token | Comment} token The token or comment to check.
					 * @param {number} i The index of `token` in `tokensAndComments`.
					 * @returns {void}
					 */
					(token, i) => {
						if (!astUtils.isCommaToken(token)) {
							return;
						}

						const previousToken = tokensAndComments[i - 1];
						const nextToken = tokensAndComments[i + 1];

						if (
							previousToken &&
							!astUtils.isCommaToken(previousToken) && // ignore spacing between two commas
							/*
							 * `commaTokensToIgnore` are ending commas of `null` elements (array holes/elisions).
							 * In addition to spacing between two commas, this can also ignore:
							 *
							 *   - Spacing after `[` (controlled by array-bracket-spacing)
							 *       Example: [ , ]
							 *                 ^
							 *   - Spacing after a comment (for backwards compatibility, this was possibly unintentional)
							 *       Example: [a, /* * / ,]
							 *                          ^
							 */
							!commaTokensToIgnore.includes(token) &&
							astUtils.isTokenOnSameLine(previousToken, token) &&
							options.before !==
								sourceCode.isSpaceBetween(previousToken, token)
						) {
							report(token, "before", previousToken);
						}

						if (
							nextToken &&
							!astUtils.isCommaToken(nextToken) && // ignore spacing between two commas
							!astUtils.isClosingParenToken(nextToken) && // controlled by space-in-parens
							!astUtils.isClosingBracketToken(nextToken) && // controlled by array-bracket-spacing
							!astUtils.isClosingBraceToken(nextToken) && // controlled by object-curly-spacing
							!(!options.after && nextToken.type === "Line") && // special case, allow space before line comment
							astUtils.isTokenOnSameLine(token, nextToken) &&
							options.after !==
								sourceCode.isSpaceBetween(token, nextToken)
						) {
							report(token, "after", nextToken);
						}
					},
				);
			},
			ArrayExpression: addNullElementsToIgnoreList,
			ArrayPattern: addNullElementsToIgnoreList,
		};
	},
};

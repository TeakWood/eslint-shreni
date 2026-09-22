/**
 * @fileoverview Rule to enforce linebreaks after open and before close array brackets
 * @author Jan Peer Stöcklmair <https://github.com/JPeer264>
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

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
 * A single option value, reduced to the three questions `check()` asks of it.
 * @typedef {{ consistent: boolean, multiline: boolean, minItems: number }} NormalizedOption
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
						name: "array-bracket-newline",
						url: "https://eslint.style/rules/array-bracket-newline",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce linebreaks after opening and before closing array brackets",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/array-bracket-newline",
		},

		fixable: "whitespace",

		schema: [
			{
				oneOf: [
					{
						enum: ["always", "never", "consistent"],
					},
					{
						type: "object",
						properties: {
							multiline: {
								type: "boolean",
							},
							minItems: {
								type: ["integer", "null"],
								minimum: 0,
							},
						},
						additionalProperties: false,
					},
				],
			},
		],

		messages: {
			unexpectedOpeningLinebreak:
				"There should be no linebreak after '['.",
			unexpectedClosingLinebreak:
				"There should be no linebreak before ']'.",
			missingOpeningLinebreak: "A linebreak is required after '['.",
			missingClosingLinebreak: "A linebreak is required before ']'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//----------------------------------------------------------------------
		// Helpers
		//----------------------------------------------------------------------

		/**
		 * Normalizes a given option value.
		 * @param {any} option An option value to parse.
		 * @returns {NormalizedOption} Normalized option object.
		 */
		function normalizeOptionValue(option) {
			let consistent = false;
			let multiline = false;
			/** @type {number} */
			let minItems;

			if (option) {
				if (option === "consistent") {
					consistent = true;
					minItems = Number.POSITIVE_INFINITY;
				} else if (option === "always" || option.minItems === 0) {
					minItems = 0;
				} else if (option === "never") {
					minItems = Number.POSITIVE_INFINITY;
				} else {
					multiline = Boolean(option.multiline);
					minItems = option.minItems || Number.POSITIVE_INFINITY;
				}
			} else {
				consistent = false;
				multiline = true;
				minItems = Number.POSITIVE_INFINITY;
			}

			return { consistent, multiline, minItems };
		}

		/**
		 * Normalizes a given option value.
		 * @param {any} options An option value to parse.
		 * @returns {Record<string, NormalizedOption>} Normalized option object.
		 */
		function normalizeOptions(options) {
			const value = normalizeOptionValue(options);

			return { ArrayExpression: value, ArrayPattern: value };
		}

		/**
		 * Reports that there shouldn't be a linebreak after the first token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportNoBeginningLinebreak(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "unexpectedOpeningLinebreak",
				/**
				 * Removes the linebreak after the opening bracket.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo | null} The fix, or `null` when a comment blocks it.
				 */
				fix(fixer) {
					const nextToken = /** @type {Token} */ (
						sourceCode.getTokenAfter(token, {
							includeComments: true,
						})
					);

					if (astUtils.isCommentToken(nextToken)) {
						return null;
					}

					return fixer.removeRange([
						token.range[1],
						nextToken.range[0],
					]);
				},
			});
		}

		/**
		 * Reports that there shouldn't be a linebreak before the last token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportNoEndingLinebreak(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "unexpectedClosingLinebreak",
				/**
				 * Removes the linebreak before the closing bracket.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo | null} The fix, or `null` when a comment blocks it.
				 */
				fix(fixer) {
					const previousToken = /** @type {Token} */ (
						sourceCode.getTokenBefore(token, {
							includeComments: true,
						})
					);

					if (astUtils.isCommentToken(previousToken)) {
						return null;
					}

					return fixer.removeRange([
						previousToken.range[1],
						token.range[0],
					]);
				},
			});
		}

		/**
		 * Reports that there should be a linebreak after the first token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportRequiredBeginningLinebreak(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "missingOpeningLinebreak",
				/**
				 * Inserts the required linebreak after the opening bracket.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					return fixer.insertTextAfter(token, "\n");
				},
			});
		}

		/**
		 * Reports that there should be a linebreak before the last token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportRequiredEndingLinebreak(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "missingClosingLinebreak",
				/**
				 * Inserts the required linebreak before the closing bracket.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					return fixer.insertTextBefore(token, "\n");
				},
			});
		}

		/**
		 * Reports a given node if it violated this rule.
		 * @param {ASTNode} node A node to check. This is an ArrayExpression node or an ArrayPattern node.
		 * @returns {void}
		 */
		function check(node) {
			const elements = node.elements;
			const normalizedOptions = normalizeOptions(context.options[0]);
			const options = normalizedOptions[node.type];
			/*
			 * An array literal or pattern always has both brackets, and each
			 * bracket always has a token on its inner side — the other bracket
			 * at worst. None of these six lookups can return `null`.
			 */
			const openBracket = /** @type {Token} */ (
				sourceCode.getFirstToken(node)
			);
			const closeBracket = /** @type {Token} */ (
				sourceCode.getLastToken(node)
			);
			const firstIncComment = /** @type {Token} */ (
				sourceCode.getTokenAfter(openBracket, {
					includeComments: true,
				})
			);
			const lastIncComment = /** @type {Token} */ (
				sourceCode.getTokenBefore(closeBracket, {
					includeComments: true,
				})
			);
			const first = /** @type {Token} */ (
				sourceCode.getTokenAfter(openBracket)
			);
			const last = /** @type {Token} */ (
				sourceCode.getTokenBefore(closeBracket)
			);

			const needsLinebreaks =
				elements.length >= options.minItems ||
				(options.multiline &&
					elements.length > 0 &&
					firstIncComment.loc.start.line !==
						lastIncComment.loc.end.line) ||
				(elements.length === 0 &&
					firstIncComment.type === "Block" &&
					firstIncComment.loc.start.line !==
						lastIncComment.loc.end.line &&
					firstIncComment === lastIncComment) ||
				(options.consistent &&
					openBracket.loc.end.line !== first.loc.start.line);

			/*
			 * Use tokens or comments to check multiline or not.
			 * But use only tokens to check whether linebreaks are needed.
			 * This allows:
			 *     var arr = [ // eslint-disable-line foo
			 *         'a'
			 *     ]
			 */

			if (needsLinebreaks) {
				if (astUtils.isTokenOnSameLine(openBracket, first)) {
					reportRequiredBeginningLinebreak(node, openBracket);
				}
				if (astUtils.isTokenOnSameLine(last, closeBracket)) {
					reportRequiredEndingLinebreak(node, closeBracket);
				}
			} else {
				if (!astUtils.isTokenOnSameLine(openBracket, first)) {
					reportNoBeginningLinebreak(node, openBracket);
				}
				if (!astUtils.isTokenOnSameLine(last, closeBracket)) {
					reportNoEndingLinebreak(node, closeBracket);
				}
			}
		}

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------

		return {
			ArrayPattern: check,
			ArrayExpression: check,
		};
	},
};

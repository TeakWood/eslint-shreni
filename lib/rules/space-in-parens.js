/**
 * @fileoverview Disallows or enforces spaces inside of parentheses.
 * @author Jonathan Rajavuori
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
 * The `exceptions` array option, expanded into one flag per exception kind.
 * Every flag is optional because the object is left empty when the option is
 * absent, and every read of it is a plain truthiness check.
 * @typedef {{ braceException?: boolean, bracketException?: boolean, parenException?: boolean, empty?: boolean }} ExceptionOptions
 */

/**
 * The token values which, when adjacent to a paren, invert the configured
 * spacing for that paren.
 * @typedef {{ openers: Array<string>, closers: Array<string> }} ParenExceptions
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
						name: "space-in-parens",
						url: "https://eslint.style/rules/space-in-parens",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent spacing inside parentheses",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/space-in-parens",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["always", "never"],
			},
			{
				type: "object",
				properties: {
					exceptions: {
						type: "array",
						items: {
							enum: ["{}", "[]", "()", "empty"],
						},
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			missingOpeningSpace: "There must be a space after this paren.",
			missingClosingSpace: "There must be a space before this paren.",
			rejectedOpeningSpace: "There should be no space after this paren.",
			rejectedClosingSpace: "There should be no space before this paren.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const ALWAYS = context.options[0] === "always",
			exceptionsArrayOptions =
				(context.options[1] && context.options[1].exceptions) || [],
			/** @type {ExceptionOptions} */
			options = {};

		/** @type {ParenExceptions} */
		let exceptions;

		if (exceptionsArrayOptions.length) {
			options.braceException = exceptionsArrayOptions.includes("{}");
			options.bracketException = exceptionsArrayOptions.includes("[]");
			options.parenException = exceptionsArrayOptions.includes("()");
			options.empty = exceptionsArrayOptions.includes("empty");
		}

		/**
		 * Produces an object with the opener and closer exception values
		 * @returns {ParenExceptions} `openers` and `closers` exception values
		 * @private
		 */
		function getExceptions() {
			const openers = [],
				closers = [];

			if (options.braceException) {
				openers.push("{");
				closers.push("}");
			}

			if (options.bracketException) {
				openers.push("[");
				closers.push("]");
			}

			if (options.parenException) {
				openers.push("(");
				closers.push(")");
			}

			if (options.empty) {
				openers.push(")");
				closers.push("(");
			}

			return {
				openers,
				closers,
			};
		}

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------
		const sourceCode = context.sourceCode;

		/**
		 * Determines if a token is one of the exceptions for the opener paren
		 * @param {Token} token The token to check
		 * @returns {boolean} True if the token is one of the exceptions for the opener paren
		 */
		function isOpenerException(token) {
			return exceptions.openers.includes(token.value);
		}

		/**
		 * Determines if a token is one of the exceptions for the closer paren
		 * @param {Token} token The token to check
		 * @returns {boolean} True if the token is one of the exceptions for the closer paren
		 */
		function isCloserException(token) {
			return exceptions.closers.includes(token.value);
		}

		/**
		 * Determines if an opening paren is immediately followed by a required space
		 * @param {Token} openingParenToken The paren token
		 * @param {Token} tokenAfterOpeningParen The token after it
		 * @returns {boolean} True if the opening paren is missing a required space
		 */
		function openerMissingSpace(openingParenToken, tokenAfterOpeningParen) {
			if (
				sourceCode.isSpaceBetween(
					openingParenToken,
					tokenAfterOpeningParen,
				)
			) {
				return false;
			}

			if (
				!options.empty &&
				astUtils.isClosingParenToken(tokenAfterOpeningParen)
			) {
				return false;
			}

			if (ALWAYS) {
				return !isOpenerException(tokenAfterOpeningParen);
			}
			return isOpenerException(tokenAfterOpeningParen);
		}

		/**
		 * Determines if an opening paren is immediately followed by a disallowed space
		 * @param {Token} openingParenToken The paren token
		 * @param {Token} tokenAfterOpeningParen The token after it
		 * @returns {boolean} True if the opening paren has a disallowed space
		 */
		function openerRejectsSpace(openingParenToken, tokenAfterOpeningParen) {
			if (
				!astUtils.isTokenOnSameLine(
					openingParenToken,
					tokenAfterOpeningParen,
				)
			) {
				return false;
			}

			if (tokenAfterOpeningParen.type === "Line") {
				return false;
			}

			if (
				!sourceCode.isSpaceBetween(
					openingParenToken,
					tokenAfterOpeningParen,
				)
			) {
				return false;
			}

			if (ALWAYS) {
				return isOpenerException(tokenAfterOpeningParen);
			}
			return !isOpenerException(tokenAfterOpeningParen);
		}

		/**
		 * Determines if a closing paren is immediately preceded by a required space
		 * @param {Token} tokenBeforeClosingParen The token before the paren
		 * @param {Token} closingParenToken The paren token
		 * @returns {boolean} True if the closing paren is missing a required space
		 */
		function closerMissingSpace(
			tokenBeforeClosingParen,
			closingParenToken,
		) {
			if (
				sourceCode.isSpaceBetween(
					tokenBeforeClosingParen,
					closingParenToken,
				)
			) {
				return false;
			}

			if (
				!options.empty &&
				astUtils.isOpeningParenToken(tokenBeforeClosingParen)
			) {
				return false;
			}

			if (ALWAYS) {
				return !isCloserException(tokenBeforeClosingParen);
			}
			return isCloserException(tokenBeforeClosingParen);
		}

		/**
		 * Determines if a closer paren is immediately preceded by a disallowed space
		 * @param {Token} tokenBeforeClosingParen The token before the paren
		 * @param {Token} closingParenToken The paren token
		 * @returns {boolean} True if the closing paren has a disallowed space
		 */
		function closerRejectsSpace(
			tokenBeforeClosingParen,
			closingParenToken,
		) {
			if (
				!astUtils.isTokenOnSameLine(
					tokenBeforeClosingParen,
					closingParenToken,
				)
			) {
				return false;
			}

			if (
				!sourceCode.isSpaceBetween(
					tokenBeforeClosingParen,
					closingParenToken,
				)
			) {
				return false;
			}

			if (ALWAYS) {
				return isCloserException(tokenBeforeClosingParen);
			}
			return !isCloserException(tokenBeforeClosingParen);
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks every paren in the file for the configured spacing.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			Program: function checkParenSpaces(node) {
				exceptions = getExceptions();
				const tokens = sourceCode.tokensAndComments;

				tokens.forEach((token, i) => {
					const prevToken = tokens[i - 1];
					const nextToken = tokens[i + 1];

					// if token is not an opening or closing paren token, do nothing
					if (
						!astUtils.isOpeningParenToken(token) &&
						!astUtils.isClosingParenToken(token)
					) {
						return;
					}

					// if token is an opening paren and is not followed by a required space
					if (
						token.value === "(" &&
						openerMissingSpace(token, nextToken)
					) {
						context.report({
							node,
							loc: token.loc,
							messageId: "missingOpeningSpace",
							/**
							 * Inserts the missing space after the open paren.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix(fixer) {
								return fixer.insertTextAfter(token, " ");
							},
						});
					}

					// if token is an opening paren and is followed by a disallowed space
					if (
						token.value === "(" &&
						openerRejectsSpace(token, nextToken)
					) {
						context.report({
							node,
							loc: {
								start: token.loc.end,
								end: nextToken.loc.start,
							},
							messageId: "rejectedOpeningSpace",
							/**
							 * Removes the disallowed space after the open paren.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix(fixer) {
								return fixer.removeRange([
									token.range[1],
									nextToken.range[0],
								]);
							},
						});
					}

					// if token is a closing paren and is not preceded by a required space
					if (
						token.value === ")" &&
						closerMissingSpace(prevToken, token)
					) {
						context.report({
							node,
							loc: token.loc,
							messageId: "missingClosingSpace",
							/**
							 * Inserts the missing space before the close paren.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix(fixer) {
								return fixer.insertTextBefore(token, " ");
							},
						});
					}

					// if token is a closing paren and is preceded by a disallowed space
					if (
						token.value === ")" &&
						closerRejectsSpace(prevToken, token)
					) {
						context.report({
							node,
							loc: {
								start: prevToken.loc.end,
								end: token.loc.start,
							},
							messageId: "rejectedClosingSpace",
							/**
							 * Removes the disallowed space before the close paren.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix(fixer) {
								return fixer.removeRange([
									prevToken.range[1],
									token.range[0],
								]);
							},
						});
					}
				});
			},
		};
	},
};

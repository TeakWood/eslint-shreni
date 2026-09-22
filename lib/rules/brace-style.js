/**
 * @fileoverview Rule to flag block statements that do not use the one true brace style
 * @author Ian Christian Myers
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
/** @typedef {import("./utils/types.js").FixFunction} FixFunction */
/** @typedef {import("../shared/types.js").Range} Range */

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
						name: "brace-style",
						url: "https://eslint.style/rules/brace-style",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent brace style for blocks",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/brace-style",
		},

		schema: [
			{
				enum: ["1tbs", "stroustrup", "allman"],
			},
			{
				type: "object",
				properties: {
					allowSingleLine: {
						type: "boolean",
						default: false,
					},
				},
				additionalProperties: false,
			},
		],

		fixable: "whitespace",

		messages: {
			nextLineOpen:
				"Opening curly brace does not appear on the same line as controlling statement.",
			sameLineOpen:
				"Opening curly brace appears on the same line as controlling statement.",
			blockSameLine:
				"Statement inside of curly braces should be on next line.",
			nextLineClose:
				"Closing curly brace does not appear on the same line as the subsequent block.",
			singleLineClose:
				"Closing curly brace should be on the same line as opening curly brace or on the line after the previous block.",
			sameLineClose:
				"Closing curly brace appears on the same line as the subsequent block.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const style = context.options[0] || "1tbs",
			params = context.options[1] || {},
			sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Fixes a place where a newline unexpectedly appears
		 * @param {Token} firstToken The token before the unexpected newline
		 * @param {Token} secondToken The token after the unexpected newline
		 * @returns {FixFunction | null} A fixer function to remove the newlines between the tokens, or `null` when a comment is in the way
		 */
		function removeNewlineBetween(firstToken, secondToken) {
			/** @type {Range} */
			const textRange = [firstToken.range[1], secondToken.range[0]];
			const textBetween = sourceCode.text.slice(
				textRange[0],
				textRange[1],
			);

			// Don't do a fix if there is a comment between the tokens
			if (textBetween.trim()) {
				return null;
			}
			return fixer => fixer.replaceTextRange(textRange, " ");
		}

		/**
		 * Validates a pair of curly brackets based on the user's config
		 * @param {Token} openingCurly The opening curly bracket
		 * @param {Token} closingCurly The closing curly bracket
		 * @returns {void}
		 */
		function validateCurlyPair(openingCurly, closingCurly) {
			/*
			 * A `{` is never the first token of a program and a `}` is never
			 * the last, so each of these three lookups lands on a token.
			 */
			const tokenBeforeOpeningCurly = /** @type {Token} */ (
				sourceCode.getTokenBefore(openingCurly)
			);
			const tokenAfterOpeningCurly = /** @type {Token} */ (
				sourceCode.getTokenAfter(openingCurly)
			);
			const tokenBeforeClosingCurly = /** @type {Token} */ (
				sourceCode.getTokenBefore(closingCurly)
			);
			const singleLineException =
				params.allowSingleLine &&
				astUtils.isTokenOnSameLine(openingCurly, closingCurly);

			if (
				style !== "allman" &&
				!astUtils.isTokenOnSameLine(
					tokenBeforeOpeningCurly,
					openingCurly,
				)
			) {
				context.report({
					node: openingCurly,
					messageId: "nextLineOpen",
					fix: removeNewlineBetween(
						tokenBeforeOpeningCurly,
						openingCurly,
					),
				});
			}

			if (
				style === "allman" &&
				astUtils.isTokenOnSameLine(
					tokenBeforeOpeningCurly,
					openingCurly,
				) &&
				!singleLineException
			) {
				context.report({
					node: openingCurly,
					messageId: "sameLineOpen",
					fix: fixer => fixer.insertTextBefore(openingCurly, "\n"),
				});
			}

			if (
				astUtils.isTokenOnSameLine(
					openingCurly,
					tokenAfterOpeningCurly,
				) &&
				tokenAfterOpeningCurly !== closingCurly &&
				!singleLineException
			) {
				context.report({
					node: openingCurly,
					messageId: "blockSameLine",
					fix: fixer => fixer.insertTextAfter(openingCurly, "\n"),
				});
			}

			if (
				tokenBeforeClosingCurly !== openingCurly &&
				!singleLineException &&
				astUtils.isTokenOnSameLine(
					tokenBeforeClosingCurly,
					closingCurly,
				)
			) {
				context.report({
					node: closingCurly,
					messageId: "singleLineClose",
					fix: fixer => fixer.insertTextBefore(closingCurly, "\n"),
				});
			}
		}

		/**
		 * Validates the location of a token that appears before a keyword (e.g. a newline before `else`)
		 * @param {Token} curlyToken The closing curly token. This is assumed to precede a keyword token (such as `else` or `finally`).
		 * @returns {void}
		 */
		function validateCurlyBeforeKeyword(curlyToken) {
			// The caller only passes a `}` that a keyword follows.
			const keywordToken = /** @type {Token} */ (
				sourceCode.getTokenAfter(curlyToken)
			);

			if (
				style === "1tbs" &&
				!astUtils.isTokenOnSameLine(curlyToken, keywordToken)
			) {
				context.report({
					node: curlyToken,
					messageId: "nextLineClose",
					fix: removeNewlineBetween(curlyToken, keywordToken),
				});
			}

			if (
				style !== "1tbs" &&
				astUtils.isTokenOnSameLine(curlyToken, keywordToken)
			) {
				context.report({
					node: curlyToken,
					messageId: "sameLineClose",
					fix: fixer => fixer.insertTextAfter(curlyToken, "\n"),
				});
			}
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks the braces of a standalone block.
			 * @param {ASTNode} node The `BlockStatement` node.
			 * @returns {void}
			 */
			BlockStatement(node) {
				if (!astUtils.STATEMENT_LIST_PARENTS.has(node.parent.type)) {
					validateCurlyPair(
						/** @type {Token} */ (sourceCode.getFirstToken(node)),
						/** @type {Token} */ (sourceCode.getLastToken(node)),
					);
				}
			},

			/**
			 * Checks the braces of a class static block.
			 * @param {ASTNode} node The `StaticBlock` node.
			 * @returns {void}
			 */
			StaticBlock(node) {
				validateCurlyPair(
					/** @type {Token} */ (
						sourceCode.getFirstToken(node, { skip: 1 })
					), // skip the `static` token
					/** @type {Token} */ (sourceCode.getLastToken(node)),
				);
			},

			/**
			 * Checks the braces of a class body.
			 * @param {ASTNode} node The `ClassBody` node.
			 * @returns {void}
			 */
			ClassBody(node) {
				validateCurlyPair(
					/** @type {Token} */ (sourceCode.getFirstToken(node)),
					/** @type {Token} */ (sourceCode.getLastToken(node)),
				);
			},

			/**
			 * Checks the braces of a switch statement.
			 * @param {ASTNode} node The `SwitchStatement` node.
			 * @returns {void}
			 */
			SwitchStatement(node) {
				const closingCurly = /** @type {Token} */ (
					sourceCode.getLastToken(node)
				);
				const openingCurly = /** @type {Token} */ (
					sourceCode.getTokenBefore(
						node.cases.length ? node.cases[0] : closingCurly,
					)
				);

				validateCurlyPair(openingCurly, closingCurly);
			},

			/**
			 * Checks the `}` that precedes an `else` keyword.
			 * @param {ASTNode} node The `IfStatement` node.
			 * @returns {void}
			 */
			IfStatement(node) {
				if (
					node.consequent.type === "BlockStatement" &&
					node.alternate
				) {
					// Handle the keyword after the `if` block (before `else`)
					validateCurlyBeforeKeyword(
						/** @type {Token} */ (
							sourceCode.getLastToken(node.consequent)
						),
					);
				}
			},

			/**
			 * Checks the `}` that precedes a `catch` or `finally` keyword.
			 * @param {ASTNode} node The `TryStatement` node.
			 * @returns {void}
			 */
			TryStatement(node) {
				// Handle the keyword after the `try` block (before `catch` or `finally`)
				validateCurlyBeforeKeyword(
					/** @type {Token} */ (sourceCode.getLastToken(node.block)),
				);

				if (node.handler && node.finalizer) {
					// Handle the keyword after the `catch` block (before `finally`)
					validateCurlyBeforeKeyword(
						/** @type {Token} */ (
							sourceCode.getLastToken(node.handler.body)
						),
					);
				}
			},
		};
	},
};

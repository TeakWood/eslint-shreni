/**
 * @fileoverview Validates spacing before and after semicolon
 * @author Mathias Schreck
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
						name: "semi-spacing",
						url: "https://eslint.style/rules/semi-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent spacing before and after semicolons",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/semi-spacing",
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
			unexpectedWhitespaceBefore:
				"Unexpected whitespace before semicolon.",
			unexpectedWhitespaceAfter: "Unexpected whitespace after semicolon.",
			missingWhitespaceBefore: "Missing whitespace before semicolon.",
			missingWhitespaceAfter: "Missing whitespace after semicolon.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const config = context.options[0],
			sourceCode = context.sourceCode;
		let requireSpaceBefore = false,
			requireSpaceAfter = true;

		if (typeof config === "object") {
			requireSpaceBefore = config.before;
			requireSpaceAfter = config.after;
		}

		/**
		 * Checks if a given token has leading whitespace.
		 *
		 * The result is `null` rather than `false` when the token starts the
		 * file, because the check short-circuits on the missing token itself.
		 * Every caller reads it in a boolean position, where the two are the
		 * same answer.
		 * @param {Token} token The token to check.
		 * @returns {boolean | null} True if the given token has leading space, false if not.
		 */
		function hasLeadingSpace(token) {
			const tokenBefore = sourceCode.getTokenBefore(token);

			return (
				tokenBefore &&
				astUtils.isTokenOnSameLine(tokenBefore, token) &&
				sourceCode.isSpaceBetween(tokenBefore, token)
			);
		}

		/**
		 * Checks if a given token has trailing whitespace.
		 *
		 * As with `hasLeadingSpace`, the result is `null` rather than `false`
		 * when there is no following token at all.
		 * @param {Token} token The token to check.
		 * @returns {boolean | null} True if the given token has trailing space, false if not.
		 */
		function hasTrailingSpace(token) {
			const tokenAfter = sourceCode.getTokenAfter(token);

			return (
				tokenAfter &&
				astUtils.isTokenOnSameLine(token, tokenAfter) &&
				sourceCode.isSpaceBetween(token, tokenAfter)
			);
		}

		/**
		 * Checks if the given token is the last token in its line.
		 * @param {Token} token The token to check.
		 * @returns {boolean} Whether or not the token is the last in its line.
		 */
		function isLastTokenInCurrentLine(token) {
			const tokenAfter = sourceCode.getTokenAfter(token);

			return !(
				tokenAfter && astUtils.isTokenOnSameLine(token, tokenAfter)
			);
		}

		/**
		 * Checks if the given token is the first token in its line
		 * @param {Token} token The token to check.
		 * @returns {boolean} Whether or not the token is the first in its line.
		 */
		function isFirstTokenInCurrentLine(token) {
			const tokenBefore = sourceCode.getTokenBefore(token);

			return !(
				tokenBefore && astUtils.isTokenOnSameLine(token, tokenBefore)
			);
		}

		/**
		 * Checks if the next token of a given token is a closing parenthesis.
		 * @param {Token} token The token to check.
		 * @returns {boolean} Whether or not the next token of a given token is a closing parenthesis.
		 */
		function isBeforeClosingParen(token) {
			const nextToken = sourceCode.getTokenAfter(token);

			return (
				(nextToken && astUtils.isClosingBraceToken(nextToken)) ||
				/*
				 * The sole caller reaches here only after
				 * `!isLastTokenInCurrentLine(token)`, which is true exactly
				 * when a following token exists on the same line.
				 */
				astUtils.isClosingParenToken(/** @type {Token} */ (nextToken))
			);
		}

		/**
		 * Report location example :
		 *
		 * for unexpected space `before`
		 *
		 * var a = 'b'   ;
		 *            ^^^
		 *
		 * for unexpected space `after`
		 *
		 * var a = 'b';  c = 10;
		 *             ^^
		 *
		 * Reports if the given token has invalid spacing.
		 * @param {Token} token The semicolon token to check.
		 * @param {ASTNode} node The corresponding node of the token.
		 * @returns {void}
		 */
		function checkSemicolonSpacing(token, node) {
			if (astUtils.isSemicolonToken(token)) {
				if (hasLeadingSpace(token)) {
					if (!requireSpaceBefore) {
						/*
						 * `hasLeadingSpace(token)` was truthy, which requires a
						 * preceding token on the same line.
						 */
						const tokenBefore = /** @type {Token} */ (
							sourceCode.getTokenBefore(token)
						);
						const loc = {
							start: tokenBefore.loc.end,
							end: token.loc.start,
						};

						context.report({
							node,
							loc,
							messageId: "unexpectedWhitespaceBefore",
							/**
							 * Removes the whitespace before the semicolon.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix(fixer) {
								return fixer.removeRange([
									tokenBefore.range[1],
									token.range[0],
								]);
							},
						});
					}
				} else {
					if (requireSpaceBefore) {
						const loc = token.loc;

						context.report({
							node,
							loc,
							messageId: "missingWhitespaceBefore",
							/**
							 * Inserts the missing space before the semicolon.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix(fixer) {
								return fixer.insertTextBefore(token, " ");
							},
						});
					}
				}

				if (
					!isFirstTokenInCurrentLine(token) &&
					!isLastTokenInCurrentLine(token) &&
					!isBeforeClosingParen(token)
				) {
					if (hasTrailingSpace(token)) {
						if (!requireSpaceAfter) {
							/*
							 * `hasTrailingSpace(token)` was truthy, which
							 * requires a following token on the same line.
							 */
							const tokenAfter = /** @type {Token} */ (
								sourceCode.getTokenAfter(token)
							);
							const loc = {
								start: token.loc.end,
								end: tokenAfter.loc.start,
							};

							context.report({
								node,
								loc,
								messageId: "unexpectedWhitespaceAfter",
								/**
								 * Removes the whitespace after the semicolon.
								 * @param {RuleFixer} fixer The fixer to use.
								 * @returns {EditInfo} The fix.
								 */
								fix(fixer) {
									return fixer.removeRange([
										token.range[1],
										tokenAfter.range[0],
									]);
								},
							});
						}
					} else {
						if (requireSpaceAfter) {
							const loc = token.loc;

							context.report({
								node,
								loc,
								messageId: "missingWhitespaceAfter",
								/**
								 * Inserts the missing space after the semicolon.
								 * @param {RuleFixer} fixer The fixer to use.
								 * @returns {EditInfo} The fix.
								 */
								fix(fixer) {
									return fixer.insertTextAfter(token, " ");
								},
							});
						}
					}
				}
			}
		}

		/**
		 * Checks the spacing of the semicolon with the assumption that the last token is the semicolon.
		 * @param {ASTNode} node The node to check.
		 * @returns {void}
		 */
		function checkNode(node) {
			// Every node this is registered for spans at least one token.
			const token = /** @type {Token} */ (sourceCode.getLastToken(node));

			checkSemicolonSpacing(token, node);
		}

		return {
			VariableDeclaration: checkNode,
			ExpressionStatement: checkNode,
			BreakStatement: checkNode,
			ContinueStatement: checkNode,
			DebuggerStatement: checkNode,
			DoWhileStatement: checkNode,
			ReturnStatement: checkNode,
			ThrowStatement: checkNode,
			ImportDeclaration: checkNode,
			ExportNamedDeclaration: checkNode,
			ExportAllDeclaration: checkNode,
			ExportDefaultDeclaration: checkNode,
			/**
			 * Checks the spacing of the two semicolons in a `for` header.
			 * @param {ASTNode} node The `ForStatement` node.
			 * @returns {void}
			 */
			ForStatement(node) {
				/*
				 * The `for` grammar puts a `;` after the init clause and
				 * another after the test clause, so whenever either clause is
				 * present a following token exists.
				 */
				if (node.init) {
					checkSemicolonSpacing(
						/** @type {Token} */ (
							sourceCode.getTokenAfter(node.init)
						),
						node,
					);
				}

				if (node.test) {
					checkSemicolonSpacing(
						/** @type {Token} */ (
							sourceCode.getTokenAfter(node.test)
						),
						node,
					);
				}
			},
			PropertyDefinition: checkNode,
		};
	},
};

/**
 * @fileoverview Enforce newlines between operands of ternary expressions
 * @author Kai Cataldo
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
						name: "multiline-ternary",
						url: "https://eslint.style/rules/multiline-ternary",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce newlines between operands of ternary expressions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/multiline-ternary",
		},

		schema: [
			{
				enum: ["always", "always-multiline", "never"],
			},
		],

		messages: {
			expectedTestCons:
				"Expected newline between test and consequent of ternary expression.",
			expectedConsAlt:
				"Expected newline between consequent and alternate of ternary expression.",
			unexpectedTestCons:
				"Unexpected newline between test and consequent of ternary expression.",
			unexpectedConsAlt:
				"Unexpected newline between consequent and alternate of ternary expression.",
		},

		fixable: "whitespace",
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const option = context.options[0];
		const multiline = option !== "never";
		const allowSingleLine = option === "always-multiline";

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks the newlines between the operands of a ternary expression.
			 * @param {ASTNode} node The `ConditionalExpression` node.
			 * @returns {void}
			 */
			ConditionalExpression(node) {
				/*
				 * A `ConditionalExpression` always has a `?` and a `:`, with an
				 * operand on either side of each, so every one of these lookups
				 * is guaranteed to find a token.
				 */
				const questionToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(
						node.test,
						astUtils.isNotClosingParenToken,
					)
				);
				const colonToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(
						node.consequent,
						astUtils.isNotClosingParenToken,
					)
				);

				const firstTokenOfTest = /** @type {Token} */ (
					sourceCode.getFirstToken(node)
				);
				const lastTokenOfTest = /** @type {Token} */ (
					sourceCode.getTokenBefore(questionToken)
				);
				const firstTokenOfConsequent = /** @type {Token} */ (
					sourceCode.getTokenAfter(questionToken)
				);
				const lastTokenOfConsequent = /** @type {Token} */ (
					sourceCode.getTokenBefore(colonToken)
				);
				const firstTokenOfAlternate = /** @type {Token} */ (
					sourceCode.getTokenAfter(colonToken)
				);

				const areTestAndConsequentOnSameLine =
					astUtils.isTokenOnSameLine(
						lastTokenOfTest,
						firstTokenOfConsequent,
					);
				const areConsequentAndAlternateOnSameLine =
					astUtils.isTokenOnSameLine(
						lastTokenOfConsequent,
						firstTokenOfAlternate,
					);

				const hasComments = !!sourceCode.getCommentsInside(node).length;

				if (!multiline) {
					if (!areTestAndConsequentOnSameLine) {
						context.report({
							node: node.test,
							loc: {
								start: firstTokenOfTest.loc.start,
								end: lastTokenOfTest.loc.end,
							},
							messageId: "unexpectedTestCons",
							/**
							 * Joins the test and the consequent onto one line.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {Array<EditInfo> | null} The fixes, or `null` when a comment blocks them.
							 */
							fix(fixer) {
								if (hasComments) {
									return null;
								}
								/** @type {Array<EditInfo>} */
								const fixers = [];
								const areTestAndQuestionOnSameLine =
									astUtils.isTokenOnSameLine(
										lastTokenOfTest,
										questionToken,
									);
								const areQuestionAndConsOnSameLine =
									astUtils.isTokenOnSameLine(
										questionToken,
										firstTokenOfConsequent,
									);

								if (!areTestAndQuestionOnSameLine) {
									fixers.push(
										fixer.removeRange([
											lastTokenOfTest.range[1],
											questionToken.range[0],
										]),
									);
								}
								if (!areQuestionAndConsOnSameLine) {
									fixers.push(
										fixer.removeRange([
											questionToken.range[1],
											firstTokenOfConsequent.range[0],
										]),
									);
								}

								return fixers;
							},
						});
					}

					if (!areConsequentAndAlternateOnSameLine) {
						context.report({
							node: node.consequent,
							loc: {
								start: firstTokenOfConsequent.loc.start,
								end: lastTokenOfConsequent.loc.end,
							},
							messageId: "unexpectedConsAlt",
							/**
							 * Joins the consequent and the alternate onto one line.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {Array<EditInfo> | null} The fixes, or `null` when a comment blocks them.
							 */
							fix(fixer) {
								if (hasComments) {
									return null;
								}
								/** @type {Array<EditInfo>} */
								const fixers = [];
								const areConsAndColonOnSameLine =
									astUtils.isTokenOnSameLine(
										lastTokenOfConsequent,
										colonToken,
									);
								const areColonAndAltOnSameLine =
									astUtils.isTokenOnSameLine(
										colonToken,
										firstTokenOfAlternate,
									);

								if (!areConsAndColonOnSameLine) {
									fixers.push(
										fixer.removeRange([
											lastTokenOfConsequent.range[1],
											colonToken.range[0],
										]),
									);
								}
								if (!areColonAndAltOnSameLine) {
									fixers.push(
										fixer.removeRange([
											colonToken.range[1],
											firstTokenOfAlternate.range[0],
										]),
									);
								}

								return fixers;
							},
						});
					}
				} else {
					if (
						allowSingleLine &&
						node.loc.start.line === node.loc.end.line
					) {
						return;
					}

					if (areTestAndConsequentOnSameLine) {
						context.report({
							node: node.test,
							loc: {
								start: firstTokenOfTest.loc.start,
								end: lastTokenOfTest.loc.end,
							},
							messageId: "expectedTestCons",
							fix: (/** @type {RuleFixer} */ fixer) =>
								hasComments
									? null
									: fixer.replaceTextRange(
											[
												lastTokenOfTest.range[1],
												questionToken.range[0],
											],
											"\n",
										),
						});
					}

					if (areConsequentAndAlternateOnSameLine) {
						context.report({
							node: node.consequent,
							loc: {
								start: firstTokenOfConsequent.loc.start,
								end: lastTokenOfConsequent.loc.end,
							},
							messageId: "expectedConsAlt",
							fix: (/** @type {RuleFixer} */ fixer) =>
								hasComments
									? null
									: fixer.replaceTextRange(
											[
												lastTokenOfConsequent.range[1],
												colonToken.range[0],
											],
											"\n",
										),
						});
					}
				}
			},
		};
	},
};

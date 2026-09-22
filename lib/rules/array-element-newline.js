/**
 * @fileoverview Rule to enforce line breaks after each array element
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
						name: "array-element-newline",
						url: "https://eslint.style/rules/array-element-newline",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce line breaks after each array element",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/array-element-newline",
		},

		fixable: "whitespace",

		schema: {
			definitions: {
				basicConfig: {
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
			},
			type: "array",
			items: [
				{
					oneOf: [
						{
							$ref: "#/definitions/basicConfig",
						},
						{
							type: "object",
							properties: {
								ArrayExpression: {
									$ref: "#/definitions/basicConfig",
								},
								ArrayPattern: {
									$ref: "#/definitions/basicConfig",
								},
							},
							additionalProperties: false,
							minProperties: 1,
						},
					],
				},
			],
		},

		messages: {
			unexpectedLineBreak: "There should be no linebreak here.",
			missingLineBreak: "There should be a linebreak after this element.",
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
		 * @param {any} providedOption An option value to parse.
		 * @returns {NormalizedOption} Normalized option object.
		 */
		function normalizeOptionValue(providedOption) {
			let consistent = false;
			let multiline = false;
			/** @type {number} */
			let minItems;

			const option = providedOption || "always";

			if (!option || option === "always" || option.minItems === 0) {
				minItems = 0;
			} else if (option === "never") {
				minItems = Number.POSITIVE_INFINITY;
			} else if (option === "consistent") {
				consistent = true;
				minItems = Number.POSITIVE_INFINITY;
			} else {
				multiline = Boolean(option.multiline);
				minItems = option.minItems || Number.POSITIVE_INFINITY;
			}

			return { consistent, multiline, minItems };
		}

		/**
		 * Normalizes a given option value.
		 * @param {any} options An option value to parse.
		 * @returns {Record<string, NormalizedOption | undefined>} Normalized option object.
		 */
		function normalizeOptions(options) {
			if (options && (options.ArrayExpression || options.ArrayPattern)) {
				/** @type {NormalizedOption | undefined} */
				let expressionOptions;
				/** @type {NormalizedOption | undefined} */
				let patternOptions;

				if (options.ArrayExpression) {
					expressionOptions = normalizeOptionValue(
						options.ArrayExpression,
					);
				}

				if (options.ArrayPattern) {
					patternOptions = normalizeOptionValue(options.ArrayPattern);
				}

				return {
					ArrayExpression: expressionOptions,
					ArrayPattern: patternOptions,
				};
			}

			const value = normalizeOptionValue(options);

			return { ArrayExpression: value, ArrayPattern: value };
		}

		/**
		 * Reports that there shouldn't be a line break after the first token
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportNoLineBreak(token) {
			// `token` is the first token of an element after a comma.
			const tokenBefore = /** @type {Token} */ (
				sourceCode.getTokenBefore(token, {
					includeComments: true,
				})
			);

			context.report({
				loc: {
					start: tokenBefore.loc.end,
					end: token.loc.start,
				},
				messageId: "unexpectedLineBreak",
				/**
				 * Collapses the line break before the element.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo | null} The fix, or `null` when a comment blocks it.
				 */
				fix(fixer) {
					if (astUtils.isCommentToken(tokenBefore)) {
						return null;
					}

					if (!astUtils.isTokenOnSameLine(tokenBefore, token)) {
						return fixer.replaceTextRange(
							[tokenBefore.range[1], token.range[0]],
							" ",
						);
					}

					/*
					 * This will check if the comma is on the same line as the next element
					 * Following array:
					 * [
					 *     1
					 *     , 2
					 *     , 3
					 * ]
					 *
					 * will be fixed to:
					 * [
					 *     1, 2, 3
					 * ]
					 */
					const twoTokensBefore = /** @type {Token} */ (
						sourceCode.getTokenBefore(tokenBefore, {
							includeComments: true,
						})
					);

					if (astUtils.isCommentToken(twoTokensBefore)) {
						return null;
					}

					return fixer.replaceTextRange(
						[twoTokensBefore.range[1], tokenBefore.range[0]],
						"",
					);
				},
			});
		}

		/**
		 * Reports that there should be a line break after the first token
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportRequiredLineBreak(token) {
			// As in `reportNoLineBreak()` above.
			const tokenBefore = /** @type {Token} */ (
				sourceCode.getTokenBefore(token, {
					includeComments: true,
				})
			);

			context.report({
				loc: {
					start: tokenBefore.loc.end,
					end: token.loc.start,
				},
				messageId: "missingLineBreak",
				/**
				 * Inserts the required line break before the element.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					return fixer.replaceTextRange(
						[tokenBefore.range[1], token.range[0]],
						"\n",
					);
				},
			});
		}

		/**
		 * Reports a given node if it violated this rule.
		 * @param {ASTNode} node A node to check. This is an ObjectExpression node or an ObjectPattern node.
		 * @returns {void}
		 */
		function check(node) {
			const elements = node.elements;
			const normalizedOptions = normalizeOptions(context.options[0]);
			const options = normalizedOptions[node.type];

			if (!options) {
				return;
			}

			let elementBreak = false;

			/*
			 * MULTILINE: true
			 * loop through every element and check
			 * if at least one element has linebreaks inside
			 * this ensures that following is not valid (due to elements are on the same line):
			 *
			 * [
			 *      1,
			 *      2,
			 *      3
			 * ]
			 */
			if (options.multiline) {
				elementBreak = elements
					.filter(
						(/** @type {ASTNode | null} */ element) =>
							element !== null,
					)
					.some(
						(/** @type {ASTNode} */ element) =>
							element.loc.start.line !== element.loc.end.line,
					);
			}

			let linebreaksCount = 0;

			for (let i = 0; i < node.elements.length; i++) {
				const element = node.elements[i];

				const previousElement = elements[i - 1];

				if (i === 0 || element === null || previousElement === null) {
					continue;
				}

				/*
				 * Two adjacent non-hole elements are always separated by a
				 * comma, and that comma always has an element token on each
				 * side, so none of these three lookups can fail.
				 */
				const commaToken = /** @type {Token} */ (
					sourceCode.getFirstTokenBetween(
						previousElement,
						element,
						astUtils.isCommaToken,
					)
				);
				const lastTokenOfPreviousElement = /** @type {Token} */ (
					sourceCode.getTokenBefore(commaToken)
				);
				const firstTokenOfCurrentElement = /** @type {Token} */ (
					sourceCode.getTokenAfter(commaToken)
				);

				if (
					!astUtils.isTokenOnSameLine(
						lastTokenOfPreviousElement,
						firstTokenOfCurrentElement,
					)
				) {
					linebreaksCount++;
				}
			}

			const needsLinebreaks =
				elements.length >= options.minItems ||
				(options.multiline && elementBreak) ||
				(options.consistent &&
					linebreaksCount > 0 &&
					linebreaksCount < node.elements.length);

			elements.forEach(
				(
					/** @type {ASTNode | null} */ element,
					/** @type {number} */ i,
				) => {
					const previousElement = elements[i - 1];

					if (
						i === 0 ||
						element === null ||
						previousElement === null
					) {
						return;
					}

					/*
					 * Two adjacent non-hole elements are always separated by a
					 * comma, and that comma always has an element token on each
					 * side, so none of these three lookups can fail.
					 */
					const commaToken = /** @type {Token} */ (
						sourceCode.getFirstTokenBetween(
							previousElement,
							element,
							astUtils.isCommaToken,
						)
					);
					const lastTokenOfPreviousElement = /** @type {Token} */ (
						sourceCode.getTokenBefore(commaToken)
					);
					const firstTokenOfCurrentElement = /** @type {Token} */ (
						sourceCode.getTokenAfter(commaToken)
					);

					if (needsLinebreaks) {
						if (
							astUtils.isTokenOnSameLine(
								lastTokenOfPreviousElement,
								firstTokenOfCurrentElement,
							)
						) {
							reportRequiredLineBreak(firstTokenOfCurrentElement);
						}
					} else {
						if (
							!astUtils.isTokenOnSameLine(
								lastTokenOfPreviousElement,
								firstTokenOfCurrentElement,
							)
						) {
							reportNoLineBreak(firstTokenOfCurrentElement);
						}
					}
				},
			);
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

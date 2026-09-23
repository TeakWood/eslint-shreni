/**
 * @fileoverview Rule to control spacing within function calls
 * @author Matt DuVall <http://www.mattduvall.com>
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
						name: "function-call-spacing",
						url: "https://eslint.style/rules/function-call-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Require or disallow spacing between function identifiers and their invocations",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/func-call-spacing",
		},

		fixable: "whitespace",

		schema: {
			anyOf: [
				{
					type: "array",
					items: [
						{
							enum: ["never"],
						},
					],
					minItems: 0,
					maxItems: 1,
				},
				{
					type: "array",
					items: [
						{
							enum: ["always"],
						},
						{
							type: "object",
							properties: {
								allowNewlines: {
									type: "boolean",
								},
							},
							additionalProperties: false,
						},
					],
					minItems: 0,
					maxItems: 2,
				},
			],
		},

		messages: {
			unexpectedWhitespace:
				"Unexpected whitespace between function name and paren.",
			unexpectedNewline:
				"Unexpected newline between function name and paren.",
			missing: "Missing space between function name and paren.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const never = context.options[0] !== "always";
		const allowNewlines =
			!never && context.options[1] && context.options[1].allowNewlines;
		const sourceCode = context.sourceCode;
		const text = sourceCode.getText();

		/**
		 * Check if open space is present in a function name
		 * @param {ASTNode} node node to evaluate
		 * @param {Token} leftToken The last token of the callee. This may be the closing parenthesis that encloses the callee.
		 * @param {Token} rightToken The first token of the arguments. this is the opening parenthesis that encloses the arguments.
		 * @returns {void}
		 * @private
		 */
		function checkSpacing(node, leftToken, rightToken) {
			const textBetweenTokens = text
				.slice(leftToken.range[1], rightToken.range[0])
				.replace(/\/\*.*?\*\//gu, "");
			const hasWhitespace = /\s/u.test(textBetweenTokens);
			const hasNewline =
				hasWhitespace &&
				astUtils.LINEBREAK_MATCHER.test(textBetweenTokens);

			/*
			 * never allowNewlines hasWhitespace hasNewline message
			 * F     F             F             F          Missing space between function name and paren.
			 * F     F             F             T          (Invalid `!hasWhitespace && hasNewline`)
			 * F     F             T             T          Unexpected newline between function name and paren.
			 * F     F             T             F          (OK)
			 * F     T             T             F          (OK)
			 * F     T             T             T          (OK)
			 * F     T             F             T          (Invalid `!hasWhitespace && hasNewline`)
			 * F     T             F             F          Missing space between function name and paren.
			 * T     T             F             F          (Invalid `never && allowNewlines`)
			 * T     T             F             T          (Invalid `!hasWhitespace && hasNewline`)
			 * T     T             T             T          (Invalid `never && allowNewlines`)
			 * T     T             T             F          (Invalid `never && allowNewlines`)
			 * T     F             T             F          Unexpected space between function name and paren.
			 * T     F             T             T          Unexpected space between function name and paren.
			 * T     F             F             T          (Invalid `!hasWhitespace && hasNewline`)
			 * T     F             F             F          (OK)
			 *
			 * T                   T                        Unexpected space between function name and paren.
			 * F                   F                        Missing space between function name and paren.
			 * F     F                           T          Unexpected newline between function name and paren.
			 */

			if (never && hasWhitespace) {
				context.report({
					node,
					loc: {
						start: leftToken.loc.end,
						end: {
							line: rightToken.loc.start.line,
							column: rightToken.loc.start.column - 1,
						},
					},
					messageId: "unexpectedWhitespace",
					/**
					 * Removes the unexpected whitespace between the function name and the paren.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo|null} The fix, or `null` if fixing would not be safe.
					 */
					fix(fixer) {
						// Don't remove comments.
						if (
							sourceCode.commentsExistBetween(
								leftToken,
								rightToken,
							)
						) {
							return null;
						}

						// If `?.` exists, it doesn't hide no-unexpected-multiline errors
						if (node.optional) {
							return fixer.replaceTextRange(
								[leftToken.range[1], rightToken.range[0]],
								"?.",
							);
						}

						/*
						 * Only autofix if there is no newline
						 * https://github.com/eslint/eslint/issues/7787
						 */
						if (hasNewline) {
							return null;
						}
						return fixer.removeRange([
							leftToken.range[1],
							rightToken.range[0],
						]);
					},
				});
			} else if (!never && !hasWhitespace) {
				context.report({
					node,
					loc: {
						start: {
							line: leftToken.loc.end.line,
							column: leftToken.loc.end.column - 1,
						},
						end: rightToken.loc.start,
					},
					messageId: "missing",
					/**
					 * Inserts the missing space between the function name and the paren.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo|null} The fix, or `null` if fixing would not be safe.
					 */
					fix(fixer) {
						if (node.optional) {
							return null; // Not sure if inserting a space to either before/after `?.` token.
						}
						return fixer.insertTextBefore(rightToken, " ");
					},
				});
			} else if (!never && !allowNewlines && hasNewline) {
				context.report({
					node,
					loc: {
						start: leftToken.loc.end,
						end: rightToken.loc.start,
					},
					messageId: "unexpectedNewline",
					/**
					 * Replaces the unexpected newline between the function name and the paren.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo|null} The fix, or `null` if fixing would not be safe.
					 */
					fix(fixer) {
						/*
						 * Only autofix if there is no newline
						 * https://github.com/eslint/eslint/issues/7787
						 * But if `?.` exists, it doesn't hide no-unexpected-multiline errors
						 */
						if (!node.optional) {
							return null;
						}

						// Don't remove comments.
						if (
							sourceCode.commentsExistBetween(
								leftToken,
								rightToken,
							)
						) {
							return null;
						}

						/** @type {[number, number]} */
						const range = [leftToken.range[1], rightToken.range[0]];

						// This branch only runs for an optional call, so a `?.` token sits between the two tokens.
						const qdToken = /** @type {Token} */ (
							sourceCode.getTokenAfter(leftToken)
						);

						if (qdToken.range[0] === leftToken.range[1]) {
							return fixer.replaceTextRange(range, "?. ");
						}
						if (qdToken.range[1] === rightToken.range[0]) {
							return fixer.replaceTextRange(range, " ?.");
						}
						return fixer.replaceTextRange(range, " ?. ");
					},
				});
			}
		}

		return {
			/**
			 * Checks the spacing before the arguments of a call or a `new` expression.
			 * @param {ASTNode} node The node to check.
			 * @returns {void}
			 */
			"CallExpression, NewExpression"(node) {
				// Every node spans at least one token, so both lookups find one.
				const lastToken = /** @type {Token} */ (
					sourceCode.getLastToken(node)
				);
				const lastCalleeToken = /** @type {Token} */ (
					sourceCode.getLastToken(node.callee)
				);
				const parenToken = sourceCode.getFirstTokenBetween(
					lastCalleeToken,
					lastToken,
					astUtils.isOpeningParenToken,
				);
				const prevToken =
					parenToken &&
					sourceCode.getTokenBefore(
						parenToken,
						astUtils.isNotQuestionDotToken,
					);

				// Parens in NewExpression are optional
				if (!(parenToken && parenToken.range[1] < node.range[1])) {
					return;
				}

				// The callee ends before its `(`, so a non-`?.` token always precedes that paren.
				checkSpacing(
					node,
					/** @type {Token} */ (prevToken),
					parenToken,
				);
			},

			/**
			 * Checks the spacing before the argument of an `import()` expression.
			 * @param {ASTNode} node The node to check.
			 * @returns {void}
			 */
			ImportExpression(node) {
				// An `ImportExpression` is always `import` followed by `(`.
				const leftToken = /** @type {Token} */ (
					sourceCode.getFirstToken(node)
				);
				const rightToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(leftToken)
				);

				checkSpacing(node, leftToken, rightToken);
			},
		};
	},
};

/**
 * @fileoverview A rule to disallow or enforce spaces inside of single line blocks.
 * @author Toru Nagashima
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

const util = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("../shared/types.js").SourceLocation} SourceLocation */

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
						name: "block-spacing",
						url: "https://eslint.style/rules/block-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Disallow or enforce spaces inside of blocks after opening block and before closing block",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/block-spacing",
		},

		fixable: "whitespace",

		schema: [{ enum: ["always", "never"] }],

		messages: {
			missing: "Requires a space {{location}} '{{token}}'.",
			extra: "Unexpected space(s) {{location}} '{{token}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const always = context.options[0] !== "never",
			messageId = always ? "missing" : "extra",
			sourceCode = context.sourceCode;

		/**
		 * Gets the open brace token from a given node.
		 * @param {ASTNode} node A BlockStatement/StaticBlock/SwitchStatement node to get.
		 * @returns {Token} The token of the open brace.
		 */
		function getOpenBrace(node) {
			/*
			 * Each of these node types is delimited by braces in the grammar,
			 * so the lookup always lands on a token. `checkSpacingInsideBraces`
			 * still re-checks that it is a `{`, because a parser extension can
			 * produce a braceless variant.
			 */
			if (node.type === "SwitchStatement") {
				if (node.cases.length > 0) {
					return /** @type {Token} */ (
						sourceCode.getTokenBefore(node.cases[0])
					);
				}
				return /** @type {Token} */ (sourceCode.getLastToken(node, 1));
			}

			if (node.type === "StaticBlock") {
				return /** @type {Token} */ (
					sourceCode.getFirstToken(node, { skip: 1 })
				); // skip the `static` token
			}

			// "BlockStatement"
			return /** @type {Token} */ (sourceCode.getFirstToken(node));
		}

		/**
		 * Checks whether or not:
		 *   - given tokens are on same line.
		 *   - there is/isn't a space between given tokens.
		 * @param {Token} left A token to check.
		 * @param {Token} right The token which is next to `left`.
		 * @returns {boolean} When the option is `"always"`, `true` if there are one or more spaces between given tokens.
		 *    When the option is `"never"`, `true` if there are not any spaces between given tokens.
		 *    If given tokens are not on same line, it's always `true`.
		 */
		function isValid(left, right) {
			return (
				!util.isTokenOnSameLine(left, right) ||
				sourceCode.isSpaceBetween(left, right) === always
			);
		}

		/**
		 * Checks and reports invalid spacing style inside braces.
		 * @param {ASTNode} node A BlockStatement/StaticBlock/SwitchStatement node to check.
		 * @returns {void}
		 */
		function checkSpacingInsideBraces(node) {
			// Gets braces and the first/last token of content.
			const openBrace = getOpenBrace(node);
			const closeBrace = /** @type {Token} */ (
				sourceCode.getLastToken(node)
			);
			const firstToken = /** @type {Token} */ (
				sourceCode.getTokenAfter(openBrace, {
					includeComments: true,
				})
			);
			const lastToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(closeBrace, {
					includeComments: true,
				})
			);

			// Skip if the node is invalid or empty.
			if (
				openBrace.type !== "Punctuator" ||
				openBrace.value !== "{" ||
				closeBrace.type !== "Punctuator" ||
				closeBrace.value !== "}" ||
				firstToken === closeBrace
			) {
				return;
			}

			// Skip line comments for option never
			if (!always && firstToken.type === "Line") {
				return;
			}

			// Check.
			if (!isValid(openBrace, firstToken)) {
				/** @type {SourceLocation} */
				let loc = openBrace.loc;

				if (messageId === "extra") {
					loc = {
						start: openBrace.loc.end,
						end: firstToken.loc.start,
					};
				}

				context.report({
					node,
					loc,
					messageId,
					data: {
						location: "after",
						token: openBrace.value,
					},
					/**
					 * Corrects the spacing after the open brace.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix(fixer) {
						if (always) {
							return fixer.insertTextBefore(firstToken, " ");
						}

						return fixer.removeRange([
							openBrace.range[1],
							firstToken.range[0],
						]);
					},
				});
			}
			if (!isValid(lastToken, closeBrace)) {
				/** @type {SourceLocation} */
				let loc = closeBrace.loc;

				if (messageId === "extra") {
					loc = {
						start: lastToken.loc.end,
						end: closeBrace.loc.start,
					};
				}
				context.report({
					node,
					loc,
					messageId,
					data: {
						location: "before",
						token: closeBrace.value,
					},
					/**
					 * Corrects the spacing before the close brace.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix(fixer) {
						if (always) {
							return fixer.insertTextAfter(lastToken, " ");
						}

						return fixer.removeRange([
							lastToken.range[1],
							closeBrace.range[0],
						]);
					},
				});
			}
		}

		return {
			BlockStatement: checkSpacingInsideBraces,
			StaticBlock: checkSpacingInsideBraces,
			SwitchStatement: checkSpacingInsideBraces,
		};
	},
};

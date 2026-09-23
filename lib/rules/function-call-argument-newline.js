/**
 * @fileoverview Rule to enforce line breaks between arguments of a function call
 * @author Alexey Gonchar <https://github.com/finico>
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/ast-utils.js").Comment} Comment */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * One of the two directions this rule checks in: the message to report when a
 * pair of adjacent arguments is laid out the wrong way, the test that detects
 * it, and the fix that corrects it.
 * @typedef {Object} Checker
 * @property {string} messageId The ID of the message to report.
 * @property {(prevToken: Token, currentToken: Token) => boolean} check Returns `true` when the two tokens are laid out the wrong way.
 * @property {(token: Token, tokenBefore: Token | Comment) => (fixer: RuleFixer) => EditInfo} createFix Builds the fix that rewrites the whitespace between the two tokens.
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
						name: "function-call-argument-newline",
						url: "https://eslint.style/rules/function-call-argument-newline",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce line breaks between arguments of a function call",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/function-call-argument-newline",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["always", "never", "consistent"],
			},
		],

		messages: {
			unexpectedLineBreak: "There should be no line break here.",
			missingLineBreak:
				"There should be a line break after this argument.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * The checker to use for each of the two directions the rule enforces.
		 * @type {Record<"unexpected" | "missing", Checker>}
		 */
		const checkers = {
			unexpected: {
				messageId: "unexpectedLineBreak",

				/**
				 * Determines whether the two arguments are on different lines.
				 * @param {Token} prevToken The last token of the previous argument.
				 * @param {Token} currentToken The first token of the current argument.
				 * @returns {boolean} `true` if there is a line break between them.
				 */
				check: (prevToken, currentToken) =>
					prevToken.loc.end.line !== currentToken.loc.start.line,

				/**
				 * Builds a fix that collapses the line break into a single space.
				 * @param {Token} token The first token of the current argument.
				 * @param {Token | Comment} tokenBefore The token or comment right before it.
				 * @returns {(fixer: RuleFixer) => EditInfo} The fix function.
				 */
				createFix: (token, tokenBefore) => fixer =>
					fixer.replaceTextRange(
						[tokenBefore.range[1], token.range[0]],
						" ",
					),
			},
			missing: {
				messageId: "missingLineBreak",

				/**
				 * Determines whether the two arguments are on the same line.
				 * @param {Token} prevToken The last token of the previous argument.
				 * @param {Token} currentToken The first token of the current argument.
				 * @returns {boolean} `true` if there is no line break between them.
				 */
				check: (prevToken, currentToken) =>
					prevToken.loc.end.line === currentToken.loc.start.line,

				/**
				 * Builds a fix that replaces the whitespace with a line break.
				 * @param {Token} token The first token of the current argument.
				 * @param {Token | Comment} tokenBefore The token or comment right before it.
				 * @returns {(fixer: RuleFixer) => EditInfo} The fix function.
				 */
				createFix: (token, tokenBefore) => fixer =>
					fixer.replaceTextRange(
						[tokenBefore.range[1], token.range[0]],
						"\n",
					),
			},
		};

		/**
		 * Check all arguments for line breaks in the CallExpression
		 * @param {ASTNode} node node to evaluate
		 * @param {Checker} checker selected checker
		 * @returns {void}
		 * @private
		 */
		function checkArguments(node, checker) {
			for (let i = 1; i < node.arguments.length; i++) {
				// Every argument is an expression, so it spans at least one token.
				const prevArgToken = /** @type {Token} */ (
					sourceCode.getLastToken(node.arguments[i - 1])
				);

				// Every argument is an expression, so it spans at least one token.
				const currentArgToken = /** @type {Token} */ (
					sourceCode.getFirstToken(node.arguments[i])
				);

				if (checker.check(prevArgToken, currentArgToken)) {
					// An argument after the first is always preceded by a comma.
					const tokenBefore = /** @type {Token | Comment} */ (
						sourceCode.getTokenBefore(currentArgToken, {
							includeComments: true,
						})
					);

					const hasLineCommentBefore = tokenBefore.type === "Line";

					context.report({
						node,
						loc: {
							start: tokenBefore.loc.end,
							end: currentArgToken.loc.start,
						},
						messageId: checker.messageId,
						fix: hasLineCommentBefore
							? null
							: checker.createFix(currentArgToken, tokenBefore),
					});
				}
			}
		}

		/**
		 * Check if open space is present in a function name
		 * @param {ASTNode} node node to evaluate
		 * @returns {void}
		 * @private
		 */
		function check(node) {
			if (node.arguments.length < 2) {
				return;
			}

			const option = context.options[0] || "always";

			if (option === "never") {
				checkArguments(node, checkers.unexpected);
			} else if (option === "always") {
				checkArguments(node, checkers.missing);
			} else if (option === "consistent") {
				// There are at least two arguments here, and each spans a token.
				const firstArgToken = /** @type {Token} */ (
					sourceCode.getLastToken(node.arguments[0])
				);

				// There are at least two arguments here, and each spans a token.
				const secondArgToken = /** @type {Token} */ (
					sourceCode.getFirstToken(node.arguments[1])
				);

				if (
					firstArgToken.loc.end.line === secondArgToken.loc.start.line
				) {
					checkArguments(node, checkers.unexpected);
				} else {
					checkArguments(node, checkers.missing);
				}
			}
		}

		return {
			CallExpression: check,
			NewExpression: check,
		};
	},
};

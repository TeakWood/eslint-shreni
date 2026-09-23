/**
 * @fileoverview Rule to check for ambiguous div operator in regexes
 * @author Matt DuVall <http://www.mattduvall.com>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
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
		type: "suggestion",

		docs: {
			description:
				"Disallow equal signs explicitly at the beginning of regular expressions",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-div-regex",
		},

		fixable: "code",

		schema: [],

		messages: {
			unexpected:
				"A regular expression literal can be confused with '/='.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports a regular expression literal that starts with `=`.
			 * @param {ASTNode} node The `Literal` node to check.
			 * @returns {void} No return value.
			 */
			Literal(node) {
				const token = /** @type {Token} */ (
					sourceCode.getFirstToken(node)
				);

				if (
					token.type === "RegularExpression" &&
					token.value[1] === "="
				) {
					context.report({
						node,
						messageId: "unexpected",
						/**
						 * Escapes the leading `=` as a character class.
						 * @param {RuleFixer} fixer The fixer to build the edit with.
						 * @returns {EditInfo} The fix for the ambiguous literal.
						 */
						fix(fixer) {
							return fixer.replaceTextRange(
								[token.range[0] + 1, token.range[0] + 2],
								"[=]",
							);
						},
					});
				}
			},
		};
	},
};

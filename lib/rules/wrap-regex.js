/**
 * @fileoverview Rule to flag when regex literals are not wrapped in parens
 * @author Matt DuVall <http://www.mattduvall.com>
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

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
						name: "wrap-regex",
						url: "https://eslint.style/rules/wrap-regex",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Require parenthesis around regex literals",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/wrap-regex",
		},

		schema: [],
		fixable: "code",

		messages: {
			requireParens:
				"Wrap the regexp literal in parens to disambiguate the slash.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports a regex literal that is the object of a member expression and is not wrapped in parens.
			 * @param {ASTNode} node The `Literal` node to check.
			 * @returns {void}
			 */
			Literal(node) {
				// A `Literal` node is always at least one token long.
				const token = /** @type {Token} */ (
						sourceCode.getFirstToken(node)
					),
					nodeType = token.type;

				if (nodeType === "RegularExpression") {
					const beforeToken = sourceCode.getTokenBefore(node);
					const afterToken = sourceCode.getTokenAfter(node);
					const { parent } = node;

					if (
						parent.type === "MemberExpression" &&
						parent.object === node &&
						!(
							beforeToken &&
							beforeToken.value === "(" &&
							afterToken &&
							afterToken.value === ")"
						)
					) {
						context.report({
							node,
							messageId: "requireParens",
							/**
							 * Wraps the regex literal in parens.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix: fixer =>
								fixer.replaceText(
									node,
									`(${sourceCode.getText(node)})`,
								),
						});
					}
				}
			},
		};
	},
};

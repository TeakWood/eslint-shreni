/**
 * @fileoverview A rule to ensure consistent quotes used in jsx syntax.
 * @author Mathias Schreck <https://github.com/lo1tuma>
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------

const QUOTE_SETTINGS = {
	"prefer-double": {
		quote: '"',
		description: "singlequote",

		/**
		 * Converts the quotes of a raw string literal to double quotes.
		 * @param {string} str The raw text of the string literal.
		 * @returns {string} The converted raw text.
		 */
		convert(str) {
			return str.replace(/'/gu, '"');
		},
	},
	"prefer-single": {
		quote: "'",
		description: "doublequote",

		/**
		 * Converts the quotes of a raw string literal to single quotes.
		 * @param {string} str The raw text of the string literal.
		 * @returns {string} The converted raw text.
		 */
		convert(str) {
			return str.replace(/"/gu, "'");
		},
	},
};

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
						name: "jsx-quotes",
						url: "https://eslint.style/rules/jsx-quotes",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce the consistent use of either double or single quotes in JSX attributes",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/jsx-quotes",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["prefer-single", "prefer-double"],
			},
		],
		messages: {
			unexpected: "Unexpected usage of {{description}}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		// `meta.schema` restricts the option to the keys of `QUOTE_SETTINGS`.
		const quoteOption = /** @type {keyof typeof QUOTE_SETTINGS} */ (
				context.options[0] || "prefer-double"
			),
			setting = QUOTE_SETTINGS[quoteOption];

		/**
		 * Checks if the given string literal node uses the expected quotes
		 * @param {ASTNode} node A string literal node.
		 * @returns {boolean} Whether or not the string literal used the expected quotes.
		 * @public
		 */
		function usesExpectedQuotes(node) {
			return (
				node.value.includes(setting.quote) ||
				astUtils.isSurroundedBy(node.raw, setting.quote)
			);
		}

		return {
			/**
			 * Checks the quotes used by a JSX attribute's value.
			 * @param {ASTNode} node The `JSXAttribute` node.
			 * @returns {void}
			 */
			JSXAttribute(node) {
				const attributeValue = node.value;

				if (
					attributeValue &&
					astUtils.isStringLiteral(attributeValue) &&
					!usesExpectedQuotes(attributeValue)
				) {
					context.report({
						node: attributeValue,
						messageId: "unexpected",
						data: {
							description: setting.description,
						},
						/**
						 * Rewrites the attribute value with the expected quotes.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.replaceText(
								attributeValue,
								setting.convert(attributeValue.raw),
							);
						},
					});
				}
			},
		};
	},
};

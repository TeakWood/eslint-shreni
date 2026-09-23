/**
 * @fileoverview Disallows or enforces spaces inside computed properties.
 * @author Jamund Ferguson
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
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

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
						name: "computed-property-spacing",
						url: "https://eslint.style/rules/computed-property-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent spacing inside computed property brackets",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/computed-property-spacing",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["always", "never"],
			},
			{
				type: "object",
				properties: {
					enforceForClassMembers: {
						type: "boolean",
						default: true,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpectedSpaceBefore:
				"There should be no space before '{{tokenValue}}'.",
			unexpectedSpaceAfter:
				"There should be no space after '{{tokenValue}}'.",

			missingSpaceBefore: "A space is required before '{{tokenValue}}'.",
			missingSpaceAfter: "A space is required after '{{tokenValue}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const propertyNameMustBeSpaced = context.options[0] === "always"; // default is "never"
		const enforceForClassMembers =
			!context.options[1] || context.options[1].enforceForClassMembers;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Reports that there shouldn't be a space after the first token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @param {Token} tokenAfter The token after `token`.
		 * @returns {void}
		 */
		function reportNoBeginningSpace(node, token, tokenAfter) {
			context.report({
				node,
				loc: { start: token.loc.end, end: tokenAfter.loc.start },
				messageId: "unexpectedSpaceAfter",
				data: {
					tokenValue: token.value,
				},
				/**
				 * Removes the space between the two tokens.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The edit that removes the space.
				 */
				fix(fixer) {
					return fixer.removeRange([
						token.range[1],
						tokenAfter.range[0],
					]);
				},
			});
		}

		/**
		 * Reports that there shouldn't be a space before the last token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @param {Token} tokenBefore The token before `token`.
		 * @returns {void}
		 */
		function reportNoEndingSpace(node, token, tokenBefore) {
			context.report({
				node,
				loc: { start: tokenBefore.loc.end, end: token.loc.start },
				messageId: "unexpectedSpaceBefore",
				data: {
					tokenValue: token.value,
				},
				/**
				 * Removes the space between the two tokens.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The edit that removes the space.
				 */
				fix(fixer) {
					return fixer.removeRange([
						tokenBefore.range[1],
						token.range[0],
					]);
				},
			});
		}

		/**
		 * Reports that there should be a space after the first token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportRequiredBeginningSpace(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "missingSpaceAfter",
				data: {
					tokenValue: token.value,
				},
				/**
				 * Inserts the missing space after the token.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The edit that inserts the space.
				 */
				fix(fixer) {
					return fixer.insertTextAfter(token, " ");
				},
			});
		}

		/**
		 * Reports that there should be a space before the last token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportRequiredEndingSpace(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "missingSpaceBefore",
				data: {
					tokenValue: token.value,
				},
				/**
				 * Inserts the missing space before the token.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The edit that inserts the space.
				 */
				fix(fixer) {
					return fixer.insertTextBefore(token, " ");
				},
			});
		}

		/**
		 * Returns a function that checks the spacing of a node on the property name
		 * that was passed in.
		 * @param {string} propertyName The property on the node to check for spacing
		 * @returns {(node: ASTNode) => void} A function that will check spacing on a node
		 */
		function checkSpacing(propertyName) {
			/**
			 * Checks the spacing inside the computed property brackets of a node.
			 * @param {ASTNode} node The node to check.
			 * @returns {void}
			 */
			return function (node) {
				if (!node.computed) {
					return;
				}

				const property = node[propertyName];

				/*
				 * A computed property is always surrounded by brackets, so the
				 * two bracket lookups below always find one, and the lookups
				 * next to them always find the bracket at the very least.
				 * Comments are assignable to `Token`, so `includeComments`
				 * needs no wider type.
				 */
				const before = /** @type {Token} */ (
						sourceCode.getTokenBefore(
							property,
							astUtils.isOpeningBracketToken,
						)
					),
					first = /** @type {Token} */ (
						sourceCode.getTokenAfter(before, {
							includeComments: true,
						})
					),
					after = /** @type {Token} */ (
						sourceCode.getTokenAfter(
							property,
							astUtils.isClosingBracketToken,
						)
					),
					last = /** @type {Token} */ (
						sourceCode.getTokenBefore(after, {
							includeComments: true,
						})
					);

				if (astUtils.isTokenOnSameLine(before, first)) {
					if (propertyNameMustBeSpaced) {
						if (
							!sourceCode.isSpaceBetween(before, first) &&
							astUtils.isTokenOnSameLine(before, first)
						) {
							reportRequiredBeginningSpace(node, before);
						}
					} else {
						if (sourceCode.isSpaceBetween(before, first)) {
							reportNoBeginningSpace(node, before, first);
						}
					}
				}

				if (astUtils.isTokenOnSameLine(last, after)) {
					if (propertyNameMustBeSpaced) {
						if (
							!sourceCode.isSpaceBetween(last, after) &&
							astUtils.isTokenOnSameLine(last, after)
						) {
							reportRequiredEndingSpace(node, after);
						}
					} else {
						if (sourceCode.isSpaceBetween(last, after)) {
							reportNoEndingSpace(node, after, last);
						}
					}
				}
			};
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		/** @type {RuleVisitor} */
		const listeners = {
			Property: checkSpacing("key"),
			MemberExpression: checkSpacing("property"),
		};

		if (enforceForClassMembers) {
			listeners.MethodDefinition = listeners.PropertyDefinition =
				listeners.Property;
		}

		return listeners;
	},
};

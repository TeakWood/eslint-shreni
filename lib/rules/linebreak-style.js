/**
 * @fileoverview Rule to enforce a single linebreak style.
 * @author Erik Mueller
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

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
/** @typedef {import("./utils/types.js").FixFunction} FixFunction */
/** @typedef {import("../shared/types.js").Range} Range */

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
						name: "linebreak-style",
						url: "https://eslint.style/rules/linebreak-style",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent linebreak style",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/linebreak-style",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["unix", "windows"],
			},
		],
		messages: {
			expectedLF: "Expected linebreaks to be 'LF' but found 'CRLF'.",
			expectedCRLF: "Expected linebreaks to be 'CRLF' but found 'LF'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Builds a fix function that replaces text at the specified range in the source text.
		 * @param {Range} range The range to replace
		 * @param {string} text The text to insert.
		 * @returns {FixFunction} Fixer function
		 * @private
		 */
		function createFix(range, text) {
			return function (fixer) {
				return fixer.replaceTextRange(range, text);
			};
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks the whole file for linebreaks that do not match the configured style.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			Program: function checkForLinebreakStyle(node) {
				const linebreakStyle = context.options[0] || "unix",
					expectedLF = linebreakStyle === "unix",
					expectedLFChars = expectedLF ? "\n" : "\r\n",
					source = sourceCode.getText(),
					pattern = astUtils.createGlobalLinebreakMatcher();
				let match;

				let i = 0;

				while ((match = pattern.exec(source)) !== null) {
					i++;
					if (match[0] === expectedLFChars) {
						continue;
					}

					const index = match.index;

					// A hoisted array literal widens to `number[]`, so name the tuple.
					const range = /** @type {Range} */ ([
						index,
						index + match[0].length,
					]);

					context.report({
						node,
						loc: {
							start: {
								line: i,
								column: sourceCode.lines[i - 1].length,
							},
							end: {
								line: i + 1,
								column: 0,
							},
						},
						messageId: expectedLF ? "expectedLF" : "expectedCRLF",
						fix: createFix(range, expectedLFChars),
					});
				}
			},
		};
	},
};

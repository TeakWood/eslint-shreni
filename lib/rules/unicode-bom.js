/**
 * @fileoverview Require or disallow Unicode BOM
 * @author Andrew Johnston <https://github.com/ehjay>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "layout",

		defaultOptions: ["never"],

		docs: {
			description: "Require or disallow Unicode byte order mark (BOM)",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/unicode-bom",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["always", "never"],
			},
		],
		messages: {
			expected: "Expected Unicode BOM (Byte Order Mark).",
			unexpected: "Unexpected Unicode BOM (Byte Order Mark).",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks whether the file's BOM matches the configured option.
			 * @param {ASTNode} node The `Program` node to report against.
			 * @returns {void}
			 */
			Program: function checkUnicodeBOM(node) {
				const sourceCode = context.sourceCode,
					location = { column: 0, line: 1 };
				const [requireBOM] = context.options;

				if (!sourceCode.hasBOM && requireBOM === "always") {
					context.report({
						node,
						loc: location,
						messageId: "expected",
						/**
						 * Inserts the missing BOM.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.insertTextBeforeRange(
								[0, 1],
								"\uFEFF",
							);
						},
					});
				} else if (sourceCode.hasBOM && requireBOM === "never") {
					context.report({
						node,
						loc: location,
						messageId: "unexpected",
						/**
						 * Removes the unexpected BOM.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.removeRange([-1, 0]);
						},
					});
				}
			},
		};
	},
};

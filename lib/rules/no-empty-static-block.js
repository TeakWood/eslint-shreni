/**
 * @fileoverview Rule to disallow empty static blocks.
 * @author Sosuke Suzuki
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("../shared/types.js").Range} Range */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		hasSuggestions: true,
		type: "suggestion",

		docs: {
			description: "Disallow empty static blocks",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-empty-static-block",
		},

		schema: [],

		messages: {
			unexpected: "Unexpected empty static block.",
			suggestComment: "Add comment inside empty static block.",
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
			 * Reports a static block whose body is empty and has no comment.
			 * @param {ASTNode} node The `StaticBlock` node to check.
			 * @returns {void} No return value.
			 */
			StaticBlock(node) {
				if (node.body.length === 0) {
					// a static block is always spelled `static` `{` ... `}`, so skipping the `static` keyword lands on the opening brace and the last token is the closing brace
					const openingBrace = /** @type {Token} */ (
						sourceCode.getFirstToken(node, {
							skip: 1,
						})
					);
					const closingBrace = /** @type {Token} */ (
						sourceCode.getLastToken(node)
					);

					if (
						sourceCode.getCommentsBefore(closingBrace).length === 0
					) {
						context.report({
							loc: {
								start: openingBrace.loc.start,
								end: closingBrace.loc.end,
							},
							messageId: "unexpected",
							suggest: [
								{
									messageId: "suggestComment",
									/**
									 * Inserts an "empty" block comment between the braces.
									 * @param {RuleFixer} fixer The fixer to create the edit with.
									 * @returns {EditInfo} The edit to apply.
									 */
									fix(fixer) {
										const range = /** @type {Range} */ ([
											openingBrace.range[1],
											closingBrace.range[0],
										]);

										return fixer.replaceTextRange(
											range,
											" /* empty */ ",
										);
									},
								},
							],
						});
					}
				}
			},
		};
	},
};

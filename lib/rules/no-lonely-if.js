/**
 * @fileoverview Rule to disallow if as the only statement in an else block
 * @author Brandon Mills
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
				"Disallow `if` statements as the only statement in `else` blocks",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-lonely-if",
		},

		schema: [],
		fixable: "code",

		messages: {
			unexpectedLonelyIf:
				"Unexpected if as the only statement in an else block.",
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
			 * Reports an `if` statement that is the only statement of an `else` block.
			 * @param {ASTNode} node The `IfStatement` node to check.
			 * @returns {void}
			 */
			IfStatement(node) {
				const parent = node.parent,
					grandparent = parent.parent;

				if (
					parent &&
					parent.type === "BlockStatement" &&
					parent.body.length === 1 &&
					!astUtils.areBracesNecessary(parent, sourceCode) &&
					grandparent &&
					grandparent.type === "IfStatement" &&
					parent === grandparent.alternate
				) {
					context.report({
						node,
						messageId: "unexpectedLonelyIf",
						/**
						 * Replaces the `else` block with the lone `if` statement it wraps.
						 * @param {RuleFixer} fixer The fixer to build the edit with.
						 * @returns {EditInfo | null} The edit, or `null` when unwrapping would drop a comment or change semantics via ASI.
						 */
						fix(fixer) {
							/*
							 * `parent` is a `BlockStatement`, so it is delimited by `{` and `}`;
							 * it is the `alternate` of `grandparent`, so the token before its `{`
							 * is the `else` keyword; and `node.consequent` is a statement, so it
							 * has a last token. Only `getTokenAfter` can genuinely return `null`,
							 * at the end of the program, and that case is handled below.
							 */
							const openingElseCurly = /** @type {Token} */ (
								sourceCode.getFirstToken(parent)
							);
							const closingElseCurly = /** @type {Token} */ (
								sourceCode.getLastToken(parent)
							);
							const elseKeyword = /** @type {Token} */ (
								sourceCode.getTokenBefore(openingElseCurly)
							);
							const tokenAfterElseBlock =
								/** @type {Token | null} */ (
									sourceCode.getTokenAfter(closingElseCurly)
								);
							const lastIfToken = /** @type {Token} */ (
								sourceCode.getLastToken(node.consequent)
							);
							const sourceText = sourceCode.getText();

							if (
								sourceText
									.slice(
										openingElseCurly.range[1],
										node.range[0],
									)
									.trim() ||
								sourceText
									.slice(
										node.range[1],
										closingElseCurly.range[0],
									)
									.trim()
							) {
								// Don't fix if there are any non-whitespace characters interfering (e.g. comments)
								return null;
							}

							if (
								node.consequent.type !== "BlockStatement" &&
								lastIfToken.value !== ";" &&
								tokenAfterElseBlock &&
								(node.consequent.loc.end.line ===
									tokenAfterElseBlock.loc.start.line ||
									/^[([/+`-]/u.test(
										tokenAfterElseBlock.value,
									) ||
									lastIfToken.value === "++" ||
									lastIfToken.value === "--")
							) {
								/*
								 * If the `if` statement has no block, and is not followed by a semicolon, make sure that fixing
								 * the issue would not change semantics due to ASI. If this would happen, don't do a fix.
								 */
								return null;
							}

							return fixer.replaceTextRange(
								[
									openingElseCurly.range[0],
									closingElseCurly.range[1],
								],
								(elseKeyword.range[1] ===
								openingElseCurly.range[0]
									? " "
									: "") + sourceCode.getText(node),
							);
						},
					});
				}
			},
		};
	},
};

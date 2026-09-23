/**
 * @fileoverview Rule to flag use of an empty block statement
 * @author Nicholas C. Zakas
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
/** @typedef {import("./utils/ast-utils.js").Range} Range */
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
		hasSuggestions: true,
		type: "suggestion",

		defaultOptions: [
			{
				allowEmptyCatch: false,
			},
		],

		docs: {
			description: "Disallow empty block statements",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-empty",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowEmptyCatch: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpected: "Empty {{type}} statement.",
			suggestComment: "Add comment inside empty {{type}} statement.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ allowEmptyCatch }] = context.options;
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports the given block statement if it is empty and not allowed to be.
			 * @param {ASTNode} node The BlockStatement node to check.
			 * @returns {void}
			 */
			BlockStatement(node) {
				// if the body is not empty, we can just return immediately
				if (node.body.length !== 0) {
					return;
				}

				// a function is generally allowed to be empty
				if (astUtils.isFunction(node.parent)) {
					return;
				}

				if (allowEmptyCatch && node.parent.type === "CatchClause") {
					return;
				}

				// any other block is only allowed to be empty, if it contains a comment
				if (sourceCode.getCommentsInside(node).length > 0) {
					return;
				}

				context.report({
					node,
					messageId: "unexpected",
					data: { type: "block" },
					suggest: [
						{
							messageId: "suggestComment",
							data: { type: "block" },
							/**
							 * Inserts an "empty" placeholder comment between the block's braces.
							 * @param {RuleFixer} fixer The fixer to build the edit with.
							 * @returns {EditInfo} The edit.
							 */
							fix(fixer) {
								// The block's own range starts at `{` and ends after `}`, so trimming one character each side lands inside it.
								const range = /** @type {Range} */ ([
									node.range[0] + 1,
									node.range[1] - 1,
								]);

								return fixer.replaceTextRange(
									range,
									" /* empty */ ",
								);
							},
						},
					],
				});
			},

			/**
			 * Reports the given switch statement if it has no cases.
			 * @param {ASTNode} node The SwitchStatement node to check.
			 * @returns {void}
			 */
			SwitchStatement(node) {
				if (
					typeof node.cases === "undefined" ||
					node.cases.length === 0
				) {
					// A switch statement always has a `{` after its discriminant and a `}` as its last token.
					const openingBrace = /** @type {Token} */ (
						sourceCode.getTokenAfter(
							node.discriminant,
							astUtils.isOpeningBraceToken,
						)
					);
					const closingBrace = /** @type {Token} */ (
						sourceCode.getLastToken(node)
					);

					if (
						sourceCode.commentsExistBetween(
							openingBrace,
							closingBrace,
						)
					) {
						return;
					}

					context.report({
						node,
						loc: {
							start: openingBrace.loc.start,
							end: closingBrace.loc.end,
						},
						messageId: "unexpected",
						data: { type: "switch" },
						suggest: [
							{
								messageId: "suggestComment",
								data: { type: "switch" },
								/**
								 * Inserts an "empty" placeholder comment between the switch's braces.
								 * @param {RuleFixer} fixer The fixer to build the edit with.
								 * @returns {EditInfo} The edit.
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
			},
		};
	},
};

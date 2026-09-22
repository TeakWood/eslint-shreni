/**
 * @fileoverview Rule to check spacing between template tags and their literals
 * @author Jonathan Wilsson
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
						name: "template-tag-spacing",
						url: "https://eslint.style/rules/template-tag-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Require or disallow spacing between template tags and their literals",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/template-tag-spacing",
		},

		fixable: "whitespace",

		schema: [{ enum: ["always", "never"] }],
		messages: {
			unexpected:
				"Unexpected space between template tag and template literal.",
			missing: "Missing space between template tag and template literal.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const never = context.options[0] !== "always";
		const sourceCode = context.sourceCode;

		/**
		 * Check if a space is present between a template tag and its literal
		 * @param {ASTNode} node node to evaluate
		 * @returns {void}
		 * @private
		 */
		function checkSpacing(node) {
			/*
			 * A tagged template expression is `tag` followed by `quasi`, so the
			 * tag's last token always precedes the quasi and the quasi always
			 * begins with a template token.
			 */
			const tagToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(node.quasi)
			);
			const literalToken = /** @type {Token} */ (
				sourceCode.getFirstToken(node.quasi)
			);
			const hasWhitespace = sourceCode.isSpaceBetween(
				tagToken,
				literalToken,
			);

			if (never && hasWhitespace) {
				context.report({
					node,
					loc: {
						start: tagToken.loc.end,
						end: literalToken.loc.start,
					},
					messageId: "unexpected",
					/**
					 * Removes the spacing between the tag and the literal.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo | null} The fix, or `null` when it is not safe to fix.
					 */
					fix(fixer) {
						const comments = sourceCode.getCommentsBefore(
							node.quasi,
						);

						// Don't fix anything if there's a single line comment after the template tag
						if (comments.some(comment => comment.type === "Line")) {
							return null;
						}

						return fixer.replaceTextRange(
							[tagToken.range[1], literalToken.range[0]],
							comments.reduce(
								(text, comment) =>
									text + sourceCode.getText(comment),
								"",
							),
						);
					},
				});
			} else if (!never && !hasWhitespace) {
				context.report({
					node,
					loc: {
						start: node.loc.start,
						end: literalToken.loc.start,
					},
					messageId: "missing",
					/**
					 * Inserts the missing space between the tag and the literal.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix(fixer) {
						return fixer.insertTextAfter(tagToken, " ");
					},
				});
			}
		}

		return {
			TaggedTemplateExpression: checkSpacing,
		};
	},
};

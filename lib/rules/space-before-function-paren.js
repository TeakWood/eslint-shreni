/**
 * @fileoverview Rule to validate spacing before function paren.
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
						name: "space-before-function-paren",
						url: "https://eslint.style/rules/space-before-function-paren",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent spacing before `function` definition opening parenthesis",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/space-before-function-paren",
		},

		fixable: "whitespace",

		schema: [
			{
				oneOf: [
					{
						enum: ["always", "never"],
					},
					{
						type: "object",
						properties: {
							anonymous: {
								enum: ["always", "never", "ignore"],
							},
							named: {
								enum: ["always", "never", "ignore"],
							},
							asyncArrow: {
								enum: ["always", "never", "ignore"],
							},
						},
						additionalProperties: false,
					},
				],
			},
		],

		messages: {
			unexpectedSpace: "Unexpected space before function parentheses.",
			missingSpace: "Missing space before function parentheses.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const baseConfig =
			typeof context.options[0] === "string"
				? context.options[0]
				: "always";
		const overrideConfig =
			typeof context.options[0] === "object" ? context.options[0] : {};

		/**
		 * Determines whether a function has a name.
		 * @param {ASTNode} node The function node.
		 * @returns {boolean} Whether the function has a name.
		 */
		function isNamedFunction(node) {
			if (node.id) {
				return true;
			}

			const parent = node.parent;

			return (
				parent.type === "MethodDefinition" ||
				(parent.type === "Property" &&
					(parent.kind === "get" ||
						parent.kind === "set" ||
						parent.method))
			);
		}

		/**
		 * Gets the config for a given function
		 * @param {ASTNode} node The function node
		 * @returns {string} "always", "never", or "ignore"
		 */
		function getConfigForFunction(node) {
			if (node.type === "ArrowFunctionExpression") {
				// Always ignore non-async functions and arrow functions without parens, e.g. async foo => bar
				if (
					node.async &&
					astUtils.isOpeningParenToken(
						// An async arrow always has a token after `async`.
						/** @type {Token} */ (
							sourceCode.getFirstToken(node, { skip: 1 })
						),
					)
				) {
					return overrideConfig.asyncArrow || baseConfig;
				}
			} else if (isNamedFunction(node)) {
				return overrideConfig.named || baseConfig;

				// `generator-star-spacing` should warn anonymous generators. E.g. `function* () {}`
			} else if (!node.generator) {
				return overrideConfig.anonymous || baseConfig;
			}

			return "ignore";
		}

		/**
		 * Checks the parens of a function node
		 * @param {ASTNode} node A function node
		 * @returns {void}
		 */
		function checkFunction(node) {
			const functionConfig = getConfigForFunction(node);

			if (functionConfig === "ignore") {
				return;
			}

			// Every function reaching here has a parameter list, preceded by at least one token.
			const rightToken = /** @type {Token} */ (
				sourceCode.getFirstToken(node, astUtils.isOpeningParenToken)
			);
			const leftToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(rightToken)
			);
			const hasSpacing = sourceCode.isSpaceBetween(leftToken, rightToken);

			if (hasSpacing && functionConfig === "never") {
				context.report({
					node,
					loc: {
						start: leftToken.loc.end,
						end: rightToken.loc.start,
					},
					messageId: "unexpectedSpace",
					/**
					 * Removes the unexpected space, keeping any block comments.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo | null} The fix, or `null` when a line comment makes it unsafe.
					 */
					fix(fixer) {
						const comments =
							sourceCode.getCommentsBefore(rightToken);

						// Don't fix anything if there's a single line comment between the left and the right token
						if (comments.some(comment => comment.type === "Line")) {
							return null;
						}
						return fixer.replaceTextRange(
							[leftToken.range[1], rightToken.range[0]],
							comments.reduce(
								(text, comment) =>
									text + sourceCode.getText(comment),
								"",
							),
						);
					},
				});
			} else if (!hasSpacing && functionConfig === "always") {
				context.report({
					node,
					loc: rightToken.loc,
					messageId: "missingSpace",
					/**
					 * Inserts the missing space before the parameter list.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix: fixer => fixer.insertTextAfter(leftToken, " "),
				});
			}
		}

		return {
			ArrowFunctionExpression: checkFunction,
			FunctionDeclaration: checkFunction,
			FunctionExpression: checkFunction,
		};
	},
};

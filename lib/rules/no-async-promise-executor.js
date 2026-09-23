/**
 * @fileoverview disallow using an async function as a Promise executor
 * @author Teddy Katz
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

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow using an async function as a Promise executor",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-async-promise-executor",
		},

		fixable: null,
		schema: [],
		messages: {
			async: "Promise executor functions should not be async.",
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
			 * Reports an async function used as a `Promise` executor.
			 * @param {ASTNode} node The `NewExpression` node to check.
			 * @returns {void} No return value.
			 */
			"NewExpression[callee.name='Promise'][arguments.0.async=true]"(
				node,
			) {
				if (!sourceCode.isGlobalReference(node.callee)) {
					return;
				}

				context.report({
					node: /** @type {Token} */ (
						sourceCode.getFirstToken(
							node.arguments[0],
							token => token.value === "async",
						)
					),
					messageId: "async",
				});
			},
		};
	},
};

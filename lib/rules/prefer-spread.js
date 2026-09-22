/**
 * @fileoverview A rule to suggest using of the spread operator instead of `.apply()`.
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").SourceCode} SourceCode */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether or not a node is a `.apply()` for variadic.
 * @param {ASTNode} node A CallExpression node to check.
 * @returns {boolean} Whether or not the node is a `.apply()` for variadic.
 */
function isVariadicApplyCalling(node) {
	return (
		astUtils.isSpecificMemberAccess(node.callee, null, "apply") &&
		node.arguments.length === 2 &&
		node.arguments[1].type !== "ArrayExpression" &&
		node.arguments[1].type !== "SpreadElement"
	);
}

/**
 * Checks whether or not `thisArg` is not changed by `.apply()`.
 * @param {ASTNode | null} expectedThis The node that is the owner of the applied function.
 * @param {ASTNode} thisArg The node that is given to the first argument of the `.apply()`.
 * @param {SourceCode} context The source code object. The parameter keeps its
 * historical name, but the only call site passes `context.sourceCode` and the
 * body forwards it to `astUtils.equalTokens()`, which wants a `SourceCode`.
 * @returns {boolean} Whether or not `thisArg` is not changed by `.apply()`.
 */
function isValidThisArg(expectedThis, thisArg, context) {
	if (!expectedThis) {
		return astUtils.isNullOrUndefined(thisArg);
	}
	return astUtils.equalTokens(expectedThis, thisArg, context);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Require spread operators instead of `.apply()`",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/prefer-spread",
		},

		schema: [],
		fixable: null,

		messages: {
			preferSpread: "Use the spread operator instead of '.apply()'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports a `.apply()` call that could be a spread call.
			 * @param {ASTNode} node The node to check.
			 * @returns {void}
			 */
			CallExpression(node) {
				if (!isVariadicApplyCalling(node)) {
					return;
				}

				const applied = astUtils.skipChainExpression(
					astUtils.skipChainExpression(node.callee).object,
				);
				const expectedThis =
					applied.type === "MemberExpression" ? applied.object : null;
				const thisArg = node.arguments[0];

				if (isValidThisArg(expectedThis, thisArg, sourceCode)) {
					context.report({
						node,
						messageId: "preferSpread",
					});
				}
			},
		};
	},
};

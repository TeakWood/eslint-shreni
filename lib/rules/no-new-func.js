/**
 * @fileoverview Rule to flag when using new Function
 * @author Ilya Volodin
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Reference} Reference */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * The `Function.prototype` methods that call the function they are read from.
 * Typed to admit `null` so that `getStaticPropertyName()`'s result can be
 * looked up directly; a `null` key is never in the set.
 * @type {Set<string | null>}
 */
const callMethods = new Set(["apply", "bind", "call"]);

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types `Reference#identifier` as a bare ESTree `Identifier`: no
 * `parent`, and `range` and `loc` optional. The linter populates all three
 * before any rule runs, so this is the same object a visitor would have
 * received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow `new` operators with the `Function` object",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-new-func",
		},

		schema: [],

		messages: {
			noFunctionConstructor: "The Function constructor is eval.",
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
			 * Reports every call of the global `Function` constructor, whether
			 * made directly or through `apply`, `bind`, or `call`.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);
				const variable = globalScope.set.get("Function");

				if (variable && variable.defs.length === 0) {
					variable.references.forEach(
						(/** @type {Reference} */ ref) => {
							const idNode = asNode(ref.identifier);
							const { parent } = idNode;
							let evalNode;

							if (parent) {
								if (
									idNode === parent.callee &&
									(parent.type === "NewExpression" ||
										parent.type === "CallExpression")
								) {
									evalNode = parent;
								} else if (
									parent.type === "MemberExpression" &&
									idNode === parent.object &&
									callMethods.has(
										astUtils.getStaticPropertyName(parent),
									)
								) {
									const maybeCallee =
										parent.parent.type === "ChainExpression"
											? parent.parent
											: parent;

									if (
										maybeCallee.parent.type ===
											"CallExpression" &&
										maybeCallee.parent.callee ===
											maybeCallee
									) {
										evalNode = maybeCallee.parent;
									}
								}
							}

							if (evalNode) {
								context.report({
									node: evalNode,
									messageId: "noFunctionConstructor",
								});
							}
						},
					);
				}
			},
		};
	},
};

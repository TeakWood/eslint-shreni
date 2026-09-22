/**
 * @fileoverview Rule to disallow use of the new operator with global non-constructor functions
 * @author Sosuke Suzuki
 */

// @ts-check

"use strict";

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

const nonConstructorGlobalFunctionNames = ["Symbol", "BigInt"];

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
		type: "problem",

		docs: {
			description:
				"Disallow `new` operators with global non-constructor functions",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-new-native-nonconstructor",
		},

		schema: [],

		messages: {
			noNewNonconstructor:
				"`{{name}}` cannot be called as a constructor.",
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
			 * Reports every `new` call on a global non-constructor function.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);

				for (const nonConstructorName of nonConstructorGlobalFunctionNames) {
					const variable = globalScope.set.get(nonConstructorName);

					if (variable && variable.defs.length === 0) {
						variable.references.forEach(
							(/** @type {Reference} */ ref) => {
								const idNode = asNode(ref.identifier);
								const parent = idNode.parent;

								if (
									parent &&
									parent.type === "NewExpression" &&
									parent.callee === idNode
								) {
									context.report({
										node: idNode,
										messageId: "noNewNonconstructor",
										data: { name: nonConstructorName },
									});
								}
							},
						);
					}
				}
			},
		};
	},
};

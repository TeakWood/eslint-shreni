/**
 * @fileoverview Rule to disallow use of the new operator with the `Symbol` object
 * @author Alberto Rodríguez
 * @deprecated in ESLint v9.0.0
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
			description: "Disallow `new` operators with the `Symbol` object",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-new-symbol",
		},

		deprecated: {
			message: "The rule was replaced with a more general rule.",
			url: "https://eslint.org/docs/latest/use/migrate-to-9.0.0#eslint-recommended",
			deprecatedSince: "9.0.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					rule: {
						name: "no-new-native-nonconstructor",
						url: "https://eslint.org/docs/latest/rules/no-new-native-nonconstructor",
					},
				},
			],
		},

		schema: [],

		messages: {
			noNewSymbol: "`Symbol` cannot be called as a constructor.",
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
			 * Reports every `new Symbol()` that refers to the global `Symbol`.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);
				const variable = globalScope.set.get("Symbol");

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
									messageId: "noNewSymbol",
								});
							}
						},
					);
				}
			},
		};
	},
};

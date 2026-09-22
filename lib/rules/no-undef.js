/**
 * @fileoverview Rule to flag references to undeclared variables.
 * @author Mark Macdonald
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — here `Reference#identifier` — as a
 * bare ESTree node: no `parent`, and `range` and `loc` optional. The linter
 * populates all three before any rule runs, so this is the same object a
 * visitor would have received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

/**
 * Checks if the given node is the argument of a typeof operator.
 * @param {ASTNode} node The AST node being checked.
 * @returns {boolean} Whether or not the node is the argument of a typeof operator.
 */
function hasTypeOfOperator(node) {
	const parent = node.parent;

	return parent.type === "UnaryExpression" && parent.operator === "typeof";
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				typeof: false,
			},
		],

		docs: {
			description:
				"Disallow the use of undeclared variables unless mentioned in `/*global */` comments",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-undef",
		},

		schema: [
			{
				type: "object",
				properties: {
					typeof: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			undef: "'{{name}}' is not defined.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ typeof: considerTypeOf }] = context.options;
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports every reference that escaped the global scope unresolved.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);

				globalScope.through.forEach(ref => {
					const identifier = asNode(ref.identifier);

					if (!considerTypeOf && hasTypeOfOperator(identifier)) {
						return;
					}

					context.report({
						node: identifier,
						messageId: "undef",
						data: identifier,
					});
				});
			},
		};
	},
};

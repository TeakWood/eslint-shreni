/**
 * @fileoverview Rule to flag variables that are never assigned
 * @author Jacob Bandes-Storch <https://github.com/jtbandes>
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
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow `let` or `var` variables that are read but never assigned",
			dialects: ["JavaScript", "TypeScript"],
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-unassigned-vars",
		},

		schema: [],
		messages: {
			unassigned:
				"'{{name}}' is always 'undefined' because it's never assigned.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		let insideDeclareModule = false;

		return {
			/**
			 * Marks that the traversal is inside an ambient module declaration.
			 * @returns {void}
			 */
			"TSModuleDeclaration[declare=true]"() {
				insideDeclareModule = true;
			},

			/**
			 * Marks that the traversal has left an ambient module declaration.
			 * @returns {void}
			 */
			"TSModuleDeclaration[declare=true]:exit"() {
				insideDeclareModule = false;
			},

			/**
			 * Reports a declarator whose variable is read but never assigned.
			 * @param {ASTNode} node The `VariableDeclarator` node.
			 * @returns {void}
			 */
			VariableDeclarator(node) {
				const declaration = node.parent;
				const shouldSkip =
					node.init ||
					node.id.type !== "Identifier" ||
					declaration.kind === "const" ||
					declaration.declare ||
					insideDeclareModule;
				if (shouldSkip) {
					return;
				}
				const [variable] = sourceCode.getDeclaredVariables(node);
				if (!variable) {
					return;
				}
				let hasRead = false;
				for (const reference of variable.references) {
					if (reference.isWrite()) {
						return;
					}
					if (reference.isRead()) {
						hasRead = true;
					}
				}
				if (!hasRead) {
					// Variables that are never read should be flagged by no-unused-vars instead
					return;
				}
				context.report({
					node,
					messageId: "unassigned",
					data: { name: node.id.name },
				});
			},
		};
	},
};

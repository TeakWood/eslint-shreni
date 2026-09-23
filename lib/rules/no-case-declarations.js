/**
 * @fileoverview Rule to flag use of an lexical declarations inside a case clause
 * @author Erik Arvidsson
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
		type: "suggestion",

		docs: {
			description: "Disallow lexical declarations in case clauses",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-case-declarations",
		},

		hasSuggestions: true,

		schema: [],

		messages: {
			addBrackets: "Add {} brackets around the case block.",
			unexpected: "Unexpected lexical declaration in case block.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		/**
		 * Checks whether or not a node is a lexical declaration.
		 * @param {ASTNode} node A direct child statement of a switch case.
		 * @returns {boolean} Whether or not the node is a lexical declaration.
		 */
		function isLexicalDeclaration(node) {
			switch (node.type) {
				case "FunctionDeclaration":
				case "ClassDeclaration":
					return true;
				case "VariableDeclaration":
					return node.kind !== "var";
				default:
					return false;
			}
		}

		return {
			/**
			 * Reports lexical declarations directly inside a case clause.
			 * @param {ASTNode} node The `SwitchCase` node to check.
			 * @returns {void} No return value.
			 */
			SwitchCase(node) {
				for (let i = 0; i < node.consequent.length; i++) {
					const statement = node.consequent[i];

					if (isLexicalDeclaration(statement)) {
						context.report({
							node: statement,
							messageId: "unexpected",
							suggest: [
								{
									messageId: "addBrackets",
									fix: fixer => [
										fixer.insertTextBefore(
											node.consequent[0],
											"{ ",
										),
										fixer.insertTextAfter(
											node.consequent.at(-1),
											" }",
										),
									],
								},
							],
						});
					}
				}
			},
		};
	},
};

/**
 * @fileoverview A rule to disallow modifying variables that are declared using `const`
 * @author Toru Nagashima
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
/** @typedef {import("eslint-scope").Variable} Variable */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const CONSTANT_BINDINGS = new Set(["const", "using", "await using"]);

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow reassigning `const`, `using`, and `await using` variables",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-const-assign",
		},

		schema: [],

		messages: {
			const: "'{{name}}' is constant.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Finds and reports references that are non initializer and writable.
		 * @param {Variable} variable A variable to check.
		 * @returns {void} No return value.
		 */
		function checkVariable(variable) {
			astUtils
				.getModifyingReferences(variable.references)
				.forEach(reference => {
					context.report({
						node: reference.identifier,
						messageId: "const",
						data: { name: reference.identifier.name },
					});
				});
		}

		return {
			/**
			 * Checks the variables a constant binding declares.
			 * @param {ASTNode} node The `VariableDeclaration` node to check.
			 * @returns {void} No return value.
			 */
			VariableDeclaration(node) {
				if (CONSTANT_BINDINGS.has(node.kind)) {
					sourceCode
						.getDeclaredVariables(node)
						.forEach(checkVariable);
				}
			},
		};
	},
};

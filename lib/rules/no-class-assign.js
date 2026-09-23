/**
 * @fileoverview A rule to disallow modifying variables of class declarations
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
/** @typedef {import("eslint-scope").Variable} Variable */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow reassigning class members",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-class-assign",
		},

		schema: [],

		messages: {
			class: "'{{name}}' is a class.",
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
						messageId: "class",
						data: { name: reference.identifier.name },
					});
				});
		}

		/**
		 * Finds and reports references that are non initializer and writable.
		 * @param {ASTNode} node A ClassDeclaration/ClassExpression node to check.
		 * @returns {void} No return value.
		 */
		function checkForClass(node) {
			sourceCode.getDeclaredVariables(node).forEach(checkVariable);
		}

		return {
			ClassDeclaration: checkForClass,
			ClassExpression: checkForClass,
		};
	},
};

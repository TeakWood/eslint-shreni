/**
 * @fileoverview A rule to disallow modifying variables of class declarations
 * @author Toru Nagashima
 */

"use strict";

const astUtils = require("./utils/ast-utils");

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

	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Finds and reports references that are non initializer and writable.
		 * @param variable A variable to check.
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
		 * @param node A ClassDeclaration/ClassExpression node to check.
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

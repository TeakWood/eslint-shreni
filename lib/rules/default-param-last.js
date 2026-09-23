/**
 * @fileoverview enforce default parameters to be last
 * @author Chiawen Chen
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

/**
 * Checks if node is required: i.e. does not have a default value or ? optional indicator.
 * @param {ASTNode} node the node to be evaluated
 * @returns {boolean} true if the node is required, false if not.
 */
function isRequiredParameter(node) {
	return !(
		node.type === "AssignmentPattern" ||
		node.type === "RestElement" ||
		node.optional
	);
}

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Enforce default parameters to be last",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/default-param-last",
		},

		schema: [],

		messages: {
			shouldBeLast: "Default parameters should be last.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/**
		 * Handler for function contexts.
		 * @param {ASTNode} node function node
		 * @returns {void}
		 */
		function handleFunction(node) {
			let hasSeenRequiredParameter = false;

			for (let i = node.params.length - 1; i >= 0; i -= 1) {
				const current = node.params[i];
				const param =
					current.type === "TSParameterProperty"
						? current.parameter
						: current;

				if (isRequiredParameter(param)) {
					hasSeenRequiredParameter = true;
					continue;
				}

				if (hasSeenRequiredParameter) {
					context.report({
						node: current,
						messageId: "shouldBeLast",
					});
				}
			}
		}

		return {
			FunctionDeclaration: handleFunction,
			FunctionExpression: handleFunction,
			ArrowFunctionExpression: handleFunction,
		};
	},
};

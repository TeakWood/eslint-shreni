/**
 * @fileoverview Rule to enforce description with the `Symbol` object
 * @author Jarek Rencz
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

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Require symbol descriptions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/symbol-description",
		},
		fixable: null,
		schema: [],
		messages: {
			expected: "Expected Symbol to have a description.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Reports if node does not conform the rule in case rule is set to
		 * report missing description
		 * @param {ASTNode} node A CallExpression node to check.
		 * @returns {void}
		 */
		function checkArgument(node) {
			if (node.arguments.length === 0) {
				context.report({
					node,
					messageId: "expected",
				});
			}
		}

		return {
			/**
			 * Checks every reference to the global `Symbol`.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const scope = sourceCode.getScope(node);
				const variable = astUtils.getVariableByName(scope, "Symbol");

				if (variable && variable.defs.length === 0) {
					variable.references.forEach(reference => {
						/*
						 * `Reference#identifier` is typed as a bare ESTree
						 * identifier with no `parent`, but it is the same
						 * object a visitor would have received, so it is
						 * reinterpreted rather than re-checked.
						 */
						const idNode = /** @type {ASTNode} */ (
							/** @type {unknown} */ (reference.identifier)
						);

						if (astUtils.isCallee(idNode)) {
							checkArgument(idNode.parent);
						}
					});
				}
			},
		};
	},
};

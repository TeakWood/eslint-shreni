/**
 * @fileoverview Rule to flag labels that are the same as an identifier
 * @author Ian Christian Myers
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
/** @typedef {import("eslint-scope").Scope} Scope */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow labels that share a name with a variable",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-label-var",
		},

		schema: [],

		messages: {
			identifierClashWithLabel:
				"Found identifier with same name as label.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor the linter runs against the AST.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Check if the identifier is present inside current scope
		 * @param {Scope} scope current scope
		 * @param {string} name To evaluate
		 * @returns {boolean} True if its present
		 * @private
		 */
		function findIdentifier(scope, name) {
			return astUtils.getVariableByName(scope, name) !== null;
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports a labeled statement whose label shares a name with a
			 * variable that is visible where the label is written.
			 * @param {ASTNode} node The `LabeledStatement` node to check.
			 * @returns {void}
			 */
			LabeledStatement(node) {
				// Fetch the innermost scope.
				const scope = sourceCode.getScope(node);

				/*
				 * Recursively find the identifier walking up the scope, starting
				 * with the innermost scope.
				 */
				if (findIdentifier(scope, node.label.name)) {
					context.report({
						node,
						messageId: "identifierClashWithLabel",
					});
				}
			},
		};
	},
};

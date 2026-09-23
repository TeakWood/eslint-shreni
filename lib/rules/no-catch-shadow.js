/**
 * @fileoverview Rule to flag variable leak in CatchClauses in IE 8 and earlier
 * @author Ian Christian Myers
 * @deprecated in ESLint v5.1.0
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
			description:
				"Disallow `catch` clause parameters from shadowing variables in the outer scope",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-catch-shadow",
		},

		deprecated: {
			message: "This rule was renamed.",
			url: "https://eslint.org/blog/2018/07/eslint-v5.1.0-released/",
			deprecatedSince: "5.1.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					rule: {
						name: "no-shadow",
						url: "https://eslint.org/docs/rules/no-shadow",
					},
				},
			],
		},
		schema: [],

		messages: {
			mutable:
				"Value of '{{name}}' may be overwritten in IE 8 and earlier.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Check if the parameters are been shadowed
		 * @param {Scope} scope current scope
		 * @param {string} name parameter name
		 * @returns {boolean} True is its been shadowed
		 */
		function paramIsShadowing(scope, name) {
			return astUtils.getVariableByName(scope, name) !== null;
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports a `catch` parameter that shadows an outer variable.
			 * @param {ASTNode} node The `CatchClause` node to check.
			 * @returns {void} No return value.
			 */
			"CatchClause[param!=null]"(node) {
				let scope = sourceCode.getScope(node);

				/*
				 * When ecmaVersion >= 6, CatchClause creates its own scope
				 * so start from one upper scope to exclude the current node
				 * The catch scope is never the global scope, so `upper` is never `null` here.
				 */
				if (scope.block === node) {
					scope = /** @type {Scope} */ (scope.upper);
				}

				if (paramIsShadowing(scope, node.param.name)) {
					context.report({
						node,
						messageId: "mutable",
						data: { name: node.param.name },
					});
				}
			},
		};
	},
};

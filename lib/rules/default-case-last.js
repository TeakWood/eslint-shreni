/**
 * @fileoverview Rule to enforce `default` clauses in `switch` statements to be last
 * @author Milos Djermanovic
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
			description:
				"Enforce `default` clauses in `switch` statements to be last",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/default-case-last",
		},

		schema: [],

		messages: {
			notLast: "Default clause should be the last clause.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		return {
			/**
			 * Reports the `default` clause when another clause follows it.
			 * @param {ASTNode} node The `SwitchStatement` node to check.
			 * @returns {void}
			 */
			SwitchStatement(node) {
				const cases = /** @type {Array<ASTNode>} */ (node.cases),
					indexOfDefault = cases.findIndex(
						/**
						 * Checks whether a clause is the `default` clause.
						 * @param {ASTNode} c The `SwitchCase` node to check.
						 * @returns {boolean} `true` if the clause is the `default` clause.
						 */
						c => c.test === null,
					);

				if (
					indexOfDefault !== -1 &&
					indexOfDefault !== cases.length - 1
				) {
					const defaultClause = cases[indexOfDefault];

					context.report({
						node: defaultClause,
						messageId: "notLast",
					});
				}
			},
		};
	},
};

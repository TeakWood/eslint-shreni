/**
 * @fileoverview Rule to check use of chained assignment expressions
 * @author Stewart Rand
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

		defaultOptions: [
			{
				ignoreNonDeclaration: false,
			},
		],

		docs: {
			description: "Disallow use of chained assignment expressions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-multi-assign",
		},

		schema: [
			{
				type: "object",
				properties: {
					ignoreNonDeclaration: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpectedChain: "Unexpected chained assignment.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ ignoreNonDeclaration }] = context.options;
		const selectors = [
			"VariableDeclarator > AssignmentExpression.init",
			"PropertyDefinition > AssignmentExpression.value",
		];

		if (!ignoreNonDeclaration) {
			selectors.push("AssignmentExpression > AssignmentExpression.right");
		}

		/*
		 * The linter joins an array used as a visitor key into one comma-separated
		 * selector, but a computed key must be `string`/`number`/`symbol`/`any`.
		 */
		const selectorKey = /** @type {any} */ (selectors);

		return {
			/**
			 * Reports an assignment that is chained onto another assignment.
			 * @param {ASTNode} node The inner `AssignmentExpression` node.
			 * @returns {void}
			 */
			[selectorKey](node) {
				context.report({
					node,
					messageId: "unexpectedChain",
				});
			},
		};
	},
};

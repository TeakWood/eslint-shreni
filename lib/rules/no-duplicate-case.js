/**
 * @fileoverview Rule to disallow a duplicate case label.
 * @author Dieter Oberkofler
 * @author Burak Yigit Kaya
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
		type: "problem",

		docs: {
			description: "Disallow duplicate case labels",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-duplicate-case",
		},

		schema: [],

		messages: {
			unexpected: "Duplicate case label.",
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
		 * Determines whether the two given nodes are considered to be equal.
		 * @param {ASTNode} a First node.
		 * @param {ASTNode} b Second node.
		 * @returns {boolean} `true` if the nodes are considered to be equal.
		 */
		function equal(a, b) {
			if (a.type !== b.type) {
				return false;
			}

			return astUtils.equalTokens(a, b, sourceCode);
		}
		return {
			/**
			 * Reports every case label that duplicates an earlier one.
			 * @param {ASTNode} node The `SwitchStatement` node to check.
			 * @returns {void} No return value.
			 */
			SwitchStatement(node) {
				const previousTests = /** @type {Array<ASTNode>} */ ([]);

				for (const switchCase of node.cases) {
					if (switchCase.test) {
						const test = switchCase.test;

						if (
							previousTests.some(previousTest =>
								equal(previousTest, test),
							)
						) {
							context.report({
								node: switchCase,
								messageId: "unexpected",
							});
						} else {
							previousTests.push(test);
						}
					}
				}
			},
		};
	},
};

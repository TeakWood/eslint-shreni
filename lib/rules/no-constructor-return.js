/**
 * @fileoverview Rule to disallow returning value from constructor.
 * @author Pig Fang <https://github.com/g-plane>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow returning value from constructor",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-constructor-return",
		},

		schema: [],

		fixable: null,

		messages: {
			unexpected: "Unexpected return statement in constructor.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		/** @type {Array<ASTNode>} */
		const stack = [];

		return {
			/**
			 * Tracks the node that starts the new code path.
			 * @param {CodePath} _ The code path that is starting.
			 * @param {ASTNode} node The node that starts the code path.
			 * @returns {void} No return value.
			 */
			onCodePathStart(_, node) {
				stack.push(node);
			},

			/**
			 * Stops tracking the node of the code path that is ending.
			 * @returns {void} No return value.
			 */
			onCodePathEnd() {
				stack.pop();
			},

			/**
			 * Reports a `return` statement with an argument in a constructor.
			 * @param {ASTNode} node The `ReturnStatement` node to check.
			 * @returns {void} No return value.
			 */
			ReturnStatement(node) {
				// A `ReturnStatement` is always inside a code path, so the stack is never empty here.
				const last = /** @type {ASTNode} */ (stack.at(-1));

				if (!last.parent) {
					return;
				}

				if (
					last.parent.type === "MethodDefinition" &&
					last.parent.kind === "constructor" &&
					node.argument
				) {
					context.report({
						node,
						messageId: "unexpected",
					});
				}
			},
		};
	},
};

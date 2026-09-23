/**
 * @fileoverview Rule to disallow uses of await inside of loops.
 * @author Nat Mote (nmote)
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
// Helpers
//------------------------------------------------------------------------------

/**
 * Check whether it should stop traversing ancestors at the given node.
 * @param {ASTNode} node A node to check.
 * @returns {boolean} `true` if it should stop traversing.
 */
function isBoundary(node) {
	const t = node.type;

	return (
		t === "FunctionDeclaration" ||
		t === "FunctionExpression" ||
		t === "ArrowFunctionExpression" ||
		/*
		 * Don't report the await expressions on for-await-of loop since it's
		 * asynchronous iteration intentionally.
		 */
		(t === "ForOfStatement" && node.await === true)
	);
}

/**
 * Check whether the given node is in loop.
 * @param {ASTNode} node A node to check.
 * @param {ASTNode} parent A parent node to check.
 * @returns {boolean} `true` if the node is in loop.
 */
function isLooped(node, parent) {
	switch (parent.type) {
		case "ForStatement":
			return (
				node === parent.test ||
				node === parent.update ||
				node === parent.body
			);

		case "ForOfStatement":
		case "ForInStatement":
			return (
				node === parent.body ||
				(node === parent.left && node.kind === "await using")
			);

		case "WhileStatement":
		case "DoWhileStatement":
			return node === parent.test || node === parent.body;

		default:
			return false;
	}
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow `await` inside of loops",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-await-in-loop",
		},

		schema: [],

		messages: {
			unexpectedAwait: "Unexpected `await` inside a loop.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		/**
		 * Validate an await expression.
		 * @param {ASTNode} awaitNode An AwaitExpression, ForOfStatement, or VariableDeclaration node to validate.
		 * @returns {void} No return value.
		 */
		function validate(awaitNode) {
			if (
				awaitNode.type === "VariableDeclaration" &&
				awaitNode.kind !== "await using"
			) {
				return;
			}

			if (awaitNode.type === "ForOfStatement" && !awaitNode.await) {
				return;
			}

			let node = awaitNode;
			let parent = node.parent;

			while (parent && !isBoundary(parent)) {
				if (isLooped(node, parent)) {
					context.report({
						node: awaitNode,
						messageId: "unexpectedAwait",
					});
					return;
				}
				node = parent;
				parent = parent.parent;
			}
		}

		return {
			AwaitExpression: validate,
			ForOfStatement: validate,
			VariableDeclaration: validate,
		};
	},
};

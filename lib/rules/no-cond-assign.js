/**
 * @fileoverview Rule to flag assignment in a conditional statement's test expression
 * @author Stephen Murray <spmurrayzzz>
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
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const TEST_CONDITION_PARENT_TYPES = new Set([
	"IfStatement",
	"WhileStatement",
	"DoWhileStatement",
	"ForStatement",
	"ConditionalExpression",
]);

/**
 * The human-readable description of each conditional statement type, keyed by
 * the node's `type`.
 * @type {Record<string, string>}
 */
const NODE_DESCRIPTIONS = {
	DoWhileStatement: "a 'do...while' statement",
	ForStatement: "a 'for' statement",
	IfStatement: "an 'if' statement",
	WhileStatement: "a 'while' statement",
};

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: ["except-parens"],

		docs: {
			description:
				"Disallow assignment operators in conditional expressions",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-cond-assign",
		},

		schema: [
			{
				enum: ["except-parens", "always"],
			},
		],

		messages: {
			unexpected: "Unexpected assignment within {{type}}.",

			// must match JSHint's error message
			missing:
				"Expected a conditional expression and instead saw an assignment.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const [prohibitAssign] = context.options;
		const sourceCode = context.sourceCode;

		/**
		 * Check whether an AST node is the test expression for a conditional statement.
		 * @param {ASTNode} node The node to test.
		 * @returns {boolean} `true` if the node is the text expression for a conditional statement; otherwise, `false`.
		 */
		function isConditionalTestExpression(node) {
			return (
				node.parent &&
				TEST_CONDITION_PARENT_TYPES.has(node.parent.type) &&
				node === node.parent.test
			);
		}

		/**
		 * Given an AST node, perform a bottom-up search for the first ancestor that represents a conditional statement.
		 * @param {ASTNode} node The node to use at the start of the search.
		 * @returns {ASTNode | null} The closest ancestor node that represents a conditional statement.
		 */
		function findConditionalAncestor(node) {
			let currentAncestor = node;

			do {
				if (isConditionalTestExpression(currentAncestor)) {
					return currentAncestor.parent;
				}
			} while (
				(currentAncestor = currentAncestor.parent) &&
				!astUtils.isFunction(currentAncestor)
			);

			return null;
		}

		/**
		 * Check whether the code represented by an AST node is enclosed in two sets of parentheses.
		 * @param {ASTNode} node The node to test.
		 * @returns {boolean} `true` if the code is enclosed in two sets of parentheses; otherwise, `false`.
		 */
		function isParenthesisedTwice(node) {
			const previousToken = sourceCode.getTokenBefore(node, 1),
				/*
				 * Once `previousToken` is known to be the outer `(` of a second
				 * set of parentheses around `node`, the matching outer `)` is
				 * guaranteed to follow, so this lookup cannot come back `null`.
				 */
				nextToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(node, 1)
				);

			return (
				astUtils.isParenthesised(sourceCode, node) &&
				previousToken !== null &&
				astUtils.isOpeningParenToken(previousToken) &&
				previousToken.range[1] <= node.range[0] &&
				astUtils.isClosingParenToken(nextToken) &&
				nextToken.range[0] >= node.range[1]
			);
		}

		/**
		 * Check a conditional statement's test expression for top-level assignments that are not enclosed in parentheses.
		 * @param {ASTNode} node The node for the conditional statement.
		 * @returns {void} No return value.
		 */
		function testForAssign(node) {
			if (
				node.test &&
				node.test.type === "AssignmentExpression" &&
				(node.type === "ForStatement"
					? !astUtils.isParenthesised(sourceCode, node.test)
					: !isParenthesisedTwice(node.test))
			) {
				context.report({
					node: node.test,
					messageId: "missing",
				});
			}
		}

		/**
		 * Check whether an assignment expression is descended from a conditional statement's test expression.
		 * @param {ASTNode} node The node for the assignment expression.
		 * @returns {void} No return value.
		 */
		function testForConditionalAncestor(node) {
			const ancestor = findConditionalAncestor(node);

			if (ancestor) {
				context.report({
					node,
					messageId: "unexpected",
					data: {
						type: NODE_DESCRIPTIONS[ancestor.type] || ancestor.type,
					},
				});
			}
		}

		if (prohibitAssign === "always") {
			return {
				AssignmentExpression: testForConditionalAncestor,
			};
		}

		return {
			DoWhileStatement: testForAssign,
			ForStatement: testForAssign,
			IfStatement: testForAssign,
			WhileStatement: testForAssign,
			ConditionalExpression: testForAssign,
		};
	},
};

/**
 * @fileoverview Rule to flag use constant conditions
 * @author Christian Schulz <http://rndm.de>
 */

// @ts-check

"use strict";

const { isConstant } = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [{ checkLoops: "allExceptWhileTrue" }],

		docs: {
			description: "Disallow constant expressions in conditions",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-constant-condition",
		},

		schema: [
			{
				type: "object",
				properties: {
					checkLoops: {
						enum: [
							"all",
							"allExceptWhileTrue",
							"none",
							true,
							false,
						],
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpected: "Unexpected constant condition.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		/** @type {Array<Set<ASTNode>>} */
		const loopSetStack = [];
		const sourceCode = context.sourceCode;
		let [{ checkLoops }] = context.options;

		if (checkLoops === true) {
			checkLoops = "all";
		} else if (checkLoops === false) {
			checkLoops = "none";
		}

		/** @type {Set<ASTNode>} */
		let loopsInCurrentScope = new Set();

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Tracks when the given node contains a constant condition.
		 * @param {ASTNode} node The AST node to check.
		 * @returns {void} No return value.
		 * @private
		 */
		function trackConstantConditionLoop(node) {
			if (
				node.test &&
				isConstant(sourceCode.getScope(node), node.test, true)
			) {
				loopsInCurrentScope.add(node);
			}
		}

		/**
		 * Reports when the set contains the given constant condition node
		 * @param {ASTNode} node The AST node to check.
		 * @returns {void} No return value.
		 * @private
		 */
		function checkConstantConditionLoopInSet(node) {
			if (loopsInCurrentScope.has(node)) {
				loopsInCurrentScope.delete(node);
				context.report({ node: node.test, messageId: "unexpected" });
			}
		}

		/**
		 * Reports when the given node contains a constant condition.
		 * @param {ASTNode} node The AST node to check.
		 * @returns {void} No return value.
		 * @private
		 */
		function reportIfConstant(node) {
			if (
				node.test &&
				isConstant(sourceCode.getScope(node), node.test, true)
			) {
				context.report({ node: node.test, messageId: "unexpected" });
			}
		}

		/**
		 * Stores current set of constant loops in loopSetStack temporarily
		 * and uses a new set to track constant loops
		 * @returns {void} No return value.
		 * @private
		 */
		function enterFunction() {
			loopSetStack.push(loopsInCurrentScope);
			loopsInCurrentScope = new Set();
		}

		/**
		 * Reports when the set still contains stored constant conditions
		 * @returns {void} No return value.
		 * @private
		 */
		function exitFunction() {
			/*
			 * This only runs on the exit of a function whose entry pushed a set
			 * onto the stack, so the stack is never empty here.
			 */
			loopsInCurrentScope = /** @type {Set<ASTNode>} */ (
				loopSetStack.pop()
			);
		}

		/**
		 * Checks node when checkLoops option is enabled
		 * @param {ASTNode} node The AST node to check.
		 * @returns {void} No return value.
		 * @private
		 */
		function checkLoop(node) {
			if (checkLoops === "all" || checkLoops === "allExceptWhileTrue") {
				trackConstantConditionLoop(node);
			}
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			ConditionalExpression: reportIfConstant,
			IfStatement: reportIfConstant,
			/**
			 * Tracks a `while` loop with a constant test, unless it is the
			 * `while (true)` form that the current option allows.
			 * @param {ASTNode} node The `WhileStatement` node to check.
			 * @returns {void} No return value.
			 */
			WhileStatement(node) {
				if (
					node.test.type === "Literal" &&
					node.test.value === true &&
					checkLoops === "allExceptWhileTrue"
				) {
					return;
				}

				checkLoop(node);
			},
			"WhileStatement:exit": checkConstantConditionLoopInSet,
			DoWhileStatement: checkLoop,
			"DoWhileStatement:exit": checkConstantConditionLoopInSet,
			ForStatement: checkLoop,
			/**
			 * Checks the `for` loop that owns the matched test expression.
			 * @param {ASTNode} node The test expression of a `ForStatement`.
			 * @returns {void} No return value.
			 */
			"ForStatement > .test": node => checkLoop(node.parent),
			"ForStatement:exit": checkConstantConditionLoopInSet,
			FunctionDeclaration: enterFunction,
			"FunctionDeclaration:exit": exitFunction,
			FunctionExpression: enterFunction,
			"FunctionExpression:exit": exitFunction,
			/**
			 * Forgets the tracked loops, because a `yield` can make an
			 * otherwise constant loop condition terminate the loop.
			 * @returns {void} No return value.
			 */
			YieldExpression: () => loopsInCurrentScope.clear(),
		};
	},
};

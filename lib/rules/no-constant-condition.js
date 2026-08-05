/**
 * @fileoverview Rule to flag use constant conditions
 * @author Christian Schulz <http://rndm.de>
 */

"use strict";

const { isConstant } = require("./utils/ast-utils");

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

	create(context) {
		const loopSetStack = [];
		const sourceCode = context.sourceCode;
		let [{ checkLoops }] = context.options;

		if (checkLoops === true) {
			checkLoops = "all";
		} else if (checkLoops === false) {
			checkLoops = "none";
		}

		let loopsInCurrentScope = new Set();

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Tracks when the given node contains a constant condition.
		 * @param node The AST node to check.
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
		 * @param node The AST node to check.
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
		 * @param node The AST node to check.
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
		 * @private
		 */
		function enterFunction() {
			loopSetStack.push(loopsInCurrentScope);
			loopsInCurrentScope = new Set();
		}

		/**
		 * Reports when the set still contains stored constant conditions
		 * @private
		 */
		function exitFunction() {
			loopsInCurrentScope = loopSetStack.pop();
		}

		/**
		 * Checks node when checkLoops option is enabled
		 * @param node The AST node to check.
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
			"ForStatement > .test": node => checkLoop(node.parent),
			"ForStatement:exit": checkConstantConditionLoopInSet,
			FunctionDeclaration: enterFunction,
			"FunctionDeclaration:exit": exitFunction,
			FunctionExpression: enterFunction,
			"FunctionExpression:exit": exitFunction,
			YieldExpression: () => loopsInCurrentScope.clear(),
		};
	},
};

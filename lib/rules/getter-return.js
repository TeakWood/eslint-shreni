/**
 * @fileoverview Enforces that a return statement is present in property getters.
 * @author Aladdin-ADD(hh_2013@foxmail.com)
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");
const { isAnySegmentReachable } = require("./utils/code-path-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */

/**
 * What this rule tracks for one code path, i.e. one function, program, class
 * field initializer, or class static block.
 * @typedef {Object} FuncInfo
 * @property {FuncInfo} upper The information for the enclosing code path.
 * @property {CodePath} codePath The code path this information belongs to.
 * @property {boolean} hasReturn Whether a `return` statement has been seen in this code path.
 * @property {boolean} shouldCheck Whether this code path is a getter that has to return a value.
 * @property {ASTNode} node The node this code path belongs to.
 * @property {Set<CodePathSegment>} currentSegments The segments currently being traversed.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const TARGET_NODE_TYPE = /^(?:Arrow)?FunctionExpression$/u;

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				allowImplicit: false,
			},
		],

		docs: {
			description: "Enforce `return` statements in getters",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/getter-return",
		},

		fixable: null,

		schema: [
			{
				type: "object",
				properties: {
					allowImplicit: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			expected: "Expected to return a value in {{name}}.",
			expectedAlways: "Expected {{name}} to always return a value.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ allowImplicit }] = context.options;
		const sourceCode = context.sourceCode;

		/*
		 * The root of the `upper` chain. It stands in for "no enclosing code
		 * path" and is never inspected: every handler that reads `funcInfo`
		 * runs between an `onCodePathStart` and its matching `onCodePathEnd`,
		 * and `upper` is only followed from an entry pushed by
		 * `onCodePathStart`.
		 */
		let funcInfo = /** @type {FuncInfo} */ (
			/** @type {unknown} */ ({
				upper: null,
				codePath: null,
				hasReturn: false,
				shouldCheck: false,
				node: null,
				currentSegments: [],
			})
		);

		/**
		 * Checks whether or not the last code path segment is reachable.
		 * Then reports this function if the segment is reachable.
		 *
		 * If the last code path segment is reachable, there are paths which are not
		 * returned or thrown.
		 * @param {ASTNode} node A node to check.
		 * @returns {void}
		 */
		function checkLastSegment(node) {
			if (
				funcInfo.shouldCheck &&
				isAnySegmentReachable(funcInfo.currentSegments)
			) {
				context.report({
					node,
					loc: astUtils.getFunctionHeadLoc(node, sourceCode),
					messageId: funcInfo.hasReturn
						? "expectedAlways"
						: "expected",
					data: {
						name: astUtils.getFunctionNameWithKind(funcInfo.node),
					},
				});
			}
		}

		/**
		 * Checks whether a node means a getter function.
		 * @param {ASTNode} node a node to check.
		 * @returns {boolean} if node means a getter, return true; else return false.
		 */
		function isGetter(node) {
			const parent = node.parent;

			if (
				TARGET_NODE_TYPE.test(node.type) &&
				node.body.type === "BlockStatement"
			) {
				if (parent.kind === "get") {
					return true;
				}
				if (
					parent.type === "Property" &&
					astUtils.getStaticPropertyName(parent) === "get" &&
					parent.parent.type === "ObjectExpression" &&
					astUtils.isPropertyDescriptor(parent.parent, sourceCode)
				) {
					// Getter in a property descriptor
					return true;
				}
			}
			return false;
		}
		return {
			/**
			 * Stacks this function's information.
			 * @param {CodePath} codePath The code path that started.
			 * @param {ASTNode} node The node the code path starts at.
			 * @returns {void}
			 */
			onCodePathStart(codePath, node) {
				funcInfo = {
					upper: funcInfo,
					codePath,
					hasReturn: false,
					shouldCheck: isGetter(node),
					node,
					currentSegments: new Set(),
				};
			},

			/**
			 * Pops this function's information.
			 * @returns {void}
			 */
			onCodePathEnd() {
				funcInfo = funcInfo.upper;
			},

			/**
			 * Tracks an unreachable segment that has just started.
			 * @param {CodePathSegment} segment The segment that started.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentStart(segment) {
				funcInfo.currentSegments.add(segment);
			},

			/**
			 * Forgets an unreachable segment that has just ended.
			 * @param {CodePathSegment} segment The segment that ended.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentEnd(segment) {
				funcInfo.currentSegments.delete(segment);
			},

			/**
			 * Tracks a segment that has just started.
			 * @param {CodePathSegment} segment The segment that started.
			 * @returns {void}
			 */
			onCodePathSegmentStart(segment) {
				funcInfo.currentSegments.add(segment);
			},

			/**
			 * Forgets a segment that has just ended.
			 * @param {CodePathSegment} segment The segment that ended.
			 * @returns {void}
			 */
			onCodePathSegmentEnd(segment) {
				funcInfo.currentSegments.delete(segment);
			},

			/**
			 * Checks the return statement is valid.
			 * @param {ASTNode} node The return statement to check.
			 * @returns {void}
			 */
			ReturnStatement(node) {
				if (funcInfo.shouldCheck) {
					funcInfo.hasReturn = true;

					// if allowImplicit: false, should also check node.argument
					if (!allowImplicit && !node.argument) {
						context.report({
							node,
							messageId: "expected",
							data: {
								name: astUtils.getFunctionNameWithKind(
									funcInfo.node,
								),
							},
						});
					}
				}
			},

			// Reports a given function if the last path is reachable.
			"FunctionExpression:exit": checkLastSegment,
			"ArrowFunctionExpression:exit": checkLastSegment,
		};
	},
};

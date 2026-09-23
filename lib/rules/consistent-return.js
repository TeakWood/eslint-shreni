/**
 * @fileoverview Rule to flag consistent return values
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");
const { upperCaseFirst } = require("../shared/string-utils");
const { isAnySegmentReachable } = require("./utils/code-path-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * What this rule tracks for one code path, i.e. one program or function.
 * @typedef {Object} FuncInfo
 * @property {FuncInfo} upper The information for the enclosing code path.
 * @property {CodePath} codePath The code path this information belongs to.
 * @property {boolean} hasReturn Whether a `return` statement has been seen in this code path.
 * @property {boolean} hasReturnValue Whether the first `return` statement seen specified a value.
 * @property {string} messageId The message to report for a `return` statement that disagrees with the first one.
 * @property {ASTNode} node The node this code path belongs to.
 * @property {Set<CodePathSegment>} currentSegments The segments currently being traversed.
 * @property {Record<string, any>} [data] The values to interpolate into `messageId`, filled in alongside it.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether a given node is a `constructor` method in an ES6 class
 * @param {ASTNode} node A node to check
 * @returns {boolean} `true` if the node is a `constructor` method
 */
function isClassConstructor(node) {
	return (
		node.type === "FunctionExpression" &&
		node.parent &&
		node.parent.type === "MethodDefinition" &&
		node.parent.kind === "constructor"
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Require `return` statements to either always or never specify values",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/consistent-return",
		},

		schema: [
			{
				type: "object",
				properties: {
					treatUndefinedAsUnspecified: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		defaultOptions: [{ treatUndefinedAsUnspecified: false }],

		messages: {
			missingReturn: "Expected to return a value at the end of {{name}}.",
			missingReturnValue: "{{name}} expected a return value.",
			unexpectedReturnValue: "{{name}} expected no return value.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ treatUndefinedAsUnspecified }] = context.options;

		/*
		 * The root of the `upper` chain. It stands in for "no enclosing code
		 * path" and is never inspected: every handler that reads `funcInfo`
		 * runs between an `onCodePathStart` and its matching `onCodePathEnd`,
		 * and `upper` is only followed from an entry pushed by
		 * `onCodePathStart`.
		 */
		let funcInfo = /** @type {FuncInfo} */ (/** @type {unknown} */ (null));

		/**
		 * Checks whether of not the implicit returning is consistent if the last
		 * code path segment is reachable.
		 * @param {ASTNode} node A program/function node to check.
		 * @returns {void}
		 */
		function checkLastSegment(node) {
			let loc, name;

			/*
			 * Skip if it expected no return value or unreachable.
			 * When unreachable, all paths are returned or thrown.
			 */
			if (
				!funcInfo.hasReturnValue ||
				!isAnySegmentReachable(funcInfo.currentSegments) ||
				astUtils.isES5Constructor(node) ||
				isClassConstructor(node)
			) {
				return;
			}

			// Adjust a location and a message.
			if (node.type === "Program") {
				// The head of program.
				loc = { line: 1, column: 0 };
				name = "program";
			} else if (node.type === "ArrowFunctionExpression") {
				// `=>` token
				loc = /** @type {Token} */ (
					context.sourceCode.getTokenBefore(
						node.body,
						astUtils.isArrowToken,
					)
				).loc;
			} else if (
				node.parent.type === "MethodDefinition" ||
				(node.parent.type === "Property" && node.parent.method)
			) {
				// Method name.
				loc = node.parent.key.loc;
			} else {
				// Function name or `function` keyword.
				loc = (node.id || context.sourceCode.getFirstToken(node)).loc;
			}

			if (!name) {
				name = astUtils.getFunctionNameWithKind(node);
			}

			// Reports.
			context.report({
				node,
				loc,
				messageId: "missingReturn",
				data: { name },
			});
		}

		return {
			// Initializes/Disposes state of each code path.
			/**
			 * Stacks this code path's information.
			 * @param {CodePath} codePath The code path that started.
			 * @param {ASTNode} node The node the code path starts at.
			 * @returns {void}
			 */
			onCodePathStart(codePath, node) {
				funcInfo = {
					upper: funcInfo,
					codePath,
					hasReturn: false,
					hasReturnValue: false,
					messageId: "",
					node,
					currentSegments: new Set(),
				};
			},
			/**
			 * Pops this code path's information.
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

			// Reports a given return statement if it's inconsistent.
			/**
			 * Records the first `return` statement of the code path, and reports
			 * any later one that disagrees with it about returning a value.
			 * @param {ASTNode} node The return statement to check.
			 * @returns {void}
			 */
			ReturnStatement(node) {
				const argument = node.argument;
				let hasReturnValue = Boolean(argument);

				if (treatUndefinedAsUnspecified && hasReturnValue) {
					hasReturnValue =
						!astUtils.isSpecificId(argument, "undefined") &&
						argument.operator !== "void";
				}

				if (!funcInfo.hasReturn) {
					funcInfo.hasReturn = true;
					funcInfo.hasReturnValue = hasReturnValue;
					funcInfo.messageId = hasReturnValue
						? "missingReturnValue"
						: "unexpectedReturnValue";
					funcInfo.data = {
						name:
							funcInfo.node.type === "Program"
								? "Program"
								: upperCaseFirst(
										astUtils.getFunctionNameWithKind(
											funcInfo.node,
										),
									),
					};
				} else if (funcInfo.hasReturnValue !== hasReturnValue) {
					context.report({
						node,
						messageId: funcInfo.messageId,
						data: funcInfo.data,
					});
				}
			},

			// Reports a given program/function if the implicit returning is not consistent.
			"Program:exit": checkLastSegment,
			"FunctionDeclaration:exit": checkLastSegment,
			"FunctionExpression:exit": checkLastSegment,
			"ArrowFunctionExpression:exit": checkLastSegment,
		};
	},
};

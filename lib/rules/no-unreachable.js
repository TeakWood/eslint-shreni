/**
 * @fileoverview Checks for unreachable code due to return, throws, break, and continue.
 * @author Joel Feenstra
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { isAnySegmentReachable } = require("./utils/code-path-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */
/** @typedef {import("./utils/types.js").SourceCode} SourceCode */
/** @typedef {import("./utils/types.js").SourceLocation} SourceLocation */

/**
 * The state the rule keeps for one constructor, so that a nested class's
 * constructor does not lose track of the one that encloses it.
 * @typedef {Object} ConstructorInfo
 * @property {ConstructorInfo | null} upper The info for the enclosing constructor, if any.
 * @property {boolean} hasSuperCall Whether a `super()` call has been seen in this constructor.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether or not a given variable declarator has the initializer.
 * @param {ASTNode} node A VariableDeclarator node to check.
 * @returns {boolean} `true` if the node has the initializer.
 */
function isInitialized(node) {
	return Boolean(node.init);
}

/**
 * The class to distinguish consecutive unreachable statements.
 */
class ConsecutiveRange {
	/**
	 * Creates an empty range.
	 * @param {SourceCode} sourceCode The source code object of the file being linted.
	 */
	constructor(sourceCode) {
		this.sourceCode = sourceCode;
		this.startNode = /** @type {ASTNode | null} */ (null);
		this.endNode = /** @type {ASTNode | null} */ (null);
	}

	/**
	 * The location object of this range.
	 * @returns {SourceLocation} The location spanning the whole range.
	 */
	get location() {
		// Callers check `isEmpty` first, which is exactly the check that both ends are set.
		return {
			start: /** @type {ASTNode} */ (this.startNode).loc.start,
			end: /** @type {ASTNode} */ (this.endNode).loc.end,
		};
	}

	/**
	 * `true` if this range is empty.
	 * @returns {boolean} `true` if either end of this range is unset.
	 */
	get isEmpty() {
		return !(this.startNode && this.endNode);
	}

	/**
	 * Checks whether the given node is inside of this range.
	 *
	 * `isConsecutive()` passes a token rather than a node, so this accepts
	 * either; only `range` is read.
	 * @param {ASTNode | Token} node The node to check.
	 * @returns {boolean} `true` if the node is inside of this range.
	 */
	contains(node) {
		// Callers check `isEmpty` first, which is exactly the check that both ends are set.
		return (
			node.range[0] >= /** @type {ASTNode} */ (this.startNode).range[0] &&
			node.range[1] <= /** @type {ASTNode} */ (this.endNode).range[1]
		);
	}

	/**
	 * Checks whether the given node is consecutive to this range.
	 * @param {ASTNode} node The node to check.
	 * @returns {boolean} `true` if the node is consecutive to this range.
	 */
	isConsecutive(node) {
		// This range is non-empty, so it starts at a statement, which is never the first token of the file.
		const tokenBefore = /** @type {Token} */ (
			this.sourceCode.getTokenBefore(node)
		);

		return this.contains(tokenBefore);
	}

	/**
	 * Merges the given node to this range.
	 * @param {ASTNode} node The node to merge.
	 * @returns {void}
	 */
	merge(node) {
		this.endNode = node;
	}

	/**
	 * Resets this range by the given node or null.
	 * @param {ASTNode | null} node The node to reset, or null.
	 * @returns {void}
	 */
	reset(node) {
		this.startNode = this.endNode = node;
	}
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow unreachable code after `return`, `throw`, `continue`, and `break` statements",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-unreachable",
		},

		schema: [],

		messages: {
			unreachableCode: "Unreachable code.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/** @type {ConstructorInfo | null} */
		let constructorInfo = null;

		const range = new ConsecutiveRange(context.sourceCode);

		/** @type {Array<Set<CodePathSegment>>} */
		const codePathSegments = [];

		/** @type {Set<CodePathSegment>} */
		let currentCodePathSegments = new Set();

		/**
		 * Reports a given node if it's unreachable.
		 * @param {ASTNode} [node] A statement node to report.
		 * @returns {void}
		 */
		function reportIfUnreachable(node) {
			/** @type {ASTNode | null} */
			let nextNode = null;

			if (
				node &&
				(node.type === "PropertyDefinition" ||
					!isAnySegmentReachable(currentCodePathSegments))
			) {
				// Store this statement to distinguish consecutive statements.
				if (range.isEmpty) {
					range.reset(node);
					return;
				}

				// Skip if this statement is inside of the current range.
				if (range.contains(node)) {
					return;
				}

				// Merge if this statement is consecutive to the current range.
				if (range.isConsecutive(node)) {
					range.merge(node);
					return;
				}

				nextNode = node;
			}

			/*
			 * Report the current range since this statement is reachable or is
			 * not consecutive to the current range.
			 */
			if (!range.isEmpty) {
				context.report({
					messageId: "unreachableCode",
					loc: range.location,
					node: /** @type {ASTNode} */ (range.startNode),
				});
			}

			// Update the current range.
			range.reset(nextNode);
		}

		return {
			// Manages the current code path.
			/**
			 * Starts tracking the segments of a new code path.
			 * @returns {void}
			 */
			onCodePathStart() {
				codePathSegments.push(currentCodePathSegments);
				currentCodePathSegments = new Set();
			},

			/**
			 * Restores the segments of the enclosing code path.
			 * @returns {void}
			 */
			onCodePathEnd() {
				// Paired with `onCodePathStart()`, so the stack is never empty here.
				currentCodePathSegments = /** @type {Set<CodePathSegment>} */ (
					codePathSegments.pop()
				);
			},

			/**
			 * Tracks an unreachable segment that has just started.
			 * @param {CodePathSegment} segment The segment that started.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentStart(segment) {
				currentCodePathSegments.add(segment);
			},

			/**
			 * Stops tracking an unreachable segment that has just ended.
			 * @param {CodePathSegment} segment The segment that ended.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentEnd(segment) {
				currentCodePathSegments.delete(segment);
			},

			/**
			 * Stops tracking a segment that has just ended.
			 * @param {CodePathSegment} segment The segment that ended.
			 * @returns {void}
			 */
			onCodePathSegmentEnd(segment) {
				currentCodePathSegments.delete(segment);
			},

			/**
			 * Tracks a segment that has just started.
			 * @param {CodePathSegment} segment The segment that started.
			 * @returns {void}
			 */
			onCodePathSegmentStart(segment) {
				currentCodePathSegments.add(segment);
			},

			// Registers for all statement nodes (excludes FunctionDeclaration).
			BlockStatement: reportIfUnreachable,
			BreakStatement: reportIfUnreachable,
			ClassDeclaration: reportIfUnreachable,
			ContinueStatement: reportIfUnreachable,
			DebuggerStatement: reportIfUnreachable,
			DoWhileStatement: reportIfUnreachable,
			ExpressionStatement: reportIfUnreachable,
			ForInStatement: reportIfUnreachable,
			ForOfStatement: reportIfUnreachable,
			ForStatement: reportIfUnreachable,
			IfStatement: reportIfUnreachable,
			ImportDeclaration: reportIfUnreachable,
			LabeledStatement: reportIfUnreachable,
			ReturnStatement: reportIfUnreachable,
			SwitchStatement: reportIfUnreachable,
			ThrowStatement: reportIfUnreachable,
			TryStatement: reportIfUnreachable,

			/**
			 * Reports a variable declaration if it's unreachable, unless it is
			 * a hoisted `var` with no initializer.
			 * @param {ASTNode} node The `VariableDeclaration` node.
			 * @returns {void}
			 */
			VariableDeclaration(node) {
				if (
					node.kind !== "var" ||
					node.declarations.some(isInitialized)
				) {
					reportIfUnreachable(node);
				}
			},

			WhileStatement: reportIfUnreachable,
			WithStatement: reportIfUnreachable,
			ExportNamedDeclaration: reportIfUnreachable,
			ExportDefaultDeclaration: reportIfUnreachable,
			ExportAllDeclaration: reportIfUnreachable,

			/**
			 * Reports the range left open when the traversal ends.
			 * @returns {void}
			 */
			"Program:exit"() {
				reportIfUnreachable();
			},

			/*
			 * Instance fields defined in a subclass are never created if the constructor of the subclass
			 * doesn't call `super()`, so their definitions are unreachable code.
			 */
			/**
			 * Starts tracking whether the constructor calls `super()`.
			 * @returns {void}
			 */
			"MethodDefinition[kind='constructor']"() {
				constructorInfo = {
					upper: constructorInfo,
					hasSuperCall: false,
				};
			},

			/**
			 * Reports the instance fields of a derived class whose constructor
			 * never calls `super()`.
			 * @param {ASTNode} node The constructor's `MethodDefinition` node.
			 * @returns {void}
			 */
			"MethodDefinition[kind='constructor']:exit"(node) {
				const { hasSuperCall, upper } = /** @type {ConstructorInfo} */ (
					constructorInfo
				);

				constructorInfo = upper;

				// skip typescript constructors without the body
				if (!node.value.body) {
					return;
				}

				const classDefinition = node.parent.parent;

				if (classDefinition.superClass && !hasSuperCall) {
					for (const element of classDefinition.body.body) {
						if (
							element.type === "PropertyDefinition" &&
							!element.static
						) {
							reportIfUnreachable(element);
						}
					}
				}
			},
			/**
			 * Records that the current constructor calls `super()`.
			 * @returns {void}
			 */
			"CallExpression > Super.callee"() {
				if (constructorInfo) {
					constructorInfo.hasSuperCall = true;
				}
			},
		};
	},
};

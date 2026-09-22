/**
 * @fileoverview Rule to disallow loops with a body that allows only one iteration
 * @author Milos Djermanovic
 */

// @ts-check

"use strict";

const { isAnySegmentReachable } = require("./utils/code-path-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const allLoopTypes = [
	"WhileStatement",
	"DoWhileStatement",
	"ForStatement",
	"ForInStatement",
	"ForOfStatement",
];

/**
 * Determines whether the given node is the first node in the code path to which a loop statement
 * 'loops' for the next iteration.
 * @param {ASTNode} node The node to check.
 * @returns {boolean} `true` if the node is a looping target.
 */
function isLoopingTarget(node) {
	const parent = node.parent;

	if (parent) {
		switch (parent.type) {
			case "WhileStatement":
				return node === parent.test;
			case "DoWhileStatement":
				return node === parent.body;
			case "ForStatement":
				return node === (parent.update || parent.test || parent.body);
			case "ForInStatement":
			case "ForOfStatement":
				return node === parent.left;

			// no default
		}
	}

	return false;
}

/**
 * Creates an array with elements from the first given array that are not included in the second given array.
 * @param {Array<string>} arrA The array to compare from.
 * @param {Array<string>} arrB The array to compare against.
 * @returns {Array<string>} a new array that represents `arrA \ arrB`.
 */
function getDifference(arrA, arrB) {
	return arrA.filter(a => !arrB.includes(a));
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [{ ignore: [] }],

		docs: {
			description:
				"Disallow loops with a body that allows only one iteration",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-unreachable-loop",
		},

		schema: [
			{
				type: "object",
				properties: {
					ignore: {
						type: "array",
						items: {
							enum: allLoopTypes,
						},
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			invalid: "Invalid loop. Its body allows only one iteration.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ ignore: ignoredLoopTypes }] = context.options;
		const loopTypesToCheck = getDifference(allLoopTypes, ignoredLoopTypes);
		const loopSelector = loopTypesToCheck.join(",");

		if (!loopSelector) {
			return {};
		}

		/** @type {Map<CodePathSegment, ASTNode>} */
		const loopsByTargetSegments = new Map();

		/** @type {Set<ASTNode>} */
		const loopsToReport = new Set();

		/** @type {Array<Set<CodePathSegment>>} */
		const codePathSegments = [];

		/** @type {Set<CodePathSegment>} */
		let currentCodePathSegments = new Set();

		return {
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
			 * Tracks a segment that has just started, and remembers it if it is
			 * the target a loop jumps back to.
			 * @param {CodePathSegment} segment The segment that started.
			 * @param {ASTNode} node The node the segment starts at.
			 * @returns {void}
			 */
			onCodePathSegmentStart(segment, node) {
				currentCodePathSegments.add(segment);

				if (isLoopingTarget(node)) {
					const loop = node.parent;

					loopsByTargetSegments.set(segment, loop);
				}
			},

			/**
			 * Clears the loop a jump targets, since reaching that target means
			 * a second iteration is possible.
			 * @param {CodePathSegment} _ The segment the jump comes from.
			 * @param {CodePathSegment} toSegment The segment the jump goes to.
			 * @param {ASTNode} node The node that raised the event.
			 * @returns {void}
			 */
			onCodePathSegmentLoop(_, toSegment, node) {
				// A segment that is no loop's target maps to nothing, which `Set#delete` below treats the same as a loop that was never a candidate.
				const loop = /** @type {ASTNode} */ (
					loopsByTargetSegments.get(toSegment)
				);

				/**
				 * The second iteration is reachable, meaning that the loop is valid by the logic of this rule,
				 * only if there is at least one loop event with the appropriate target (which has been already
				 * determined in the `loopsByTargetSegments` map), raised from either:
				 *
				 * - the end of the loop's body (in which case `node === loop`)
				 * - a `continue` statement
				 *
				 * This condition skips loop events raised from `ForInStatement > .right` and `ForOfStatement > .right` nodes.
				 */
				if (node === loop || node.type === "ContinueStatement") {
					// Removes loop if it exists in the set. Otherwise, `Set#delete` has no effect and doesn't throw.
					loopsToReport.delete(loop);
				}
			},

			/**
			 * Records a loop statement as a reporting candidate.
			 * @param {ASTNode} node The loop statement.
			 * @returns {void}
			 */
			[loopSelector](node) {
				/**
				 * Ignore unreachable loop statements to avoid unnecessary complexity in the implementation, or false positives otherwise.
				 * For unreachable segments, the code path analysis does not raise events required for this implementation.
				 */
				if (isAnySegmentReachable(currentCodePathSegments)) {
					loopsToReport.add(node);
				}
			},

			/**
			 * Reports every loop whose second iteration was never reachable.
			 * @returns {void}
			 */
			"Program:exit"() {
				loopsToReport.forEach(node =>
					context.report({ node, messageId: "invalid" }),
				);
			},
		};
	},
};

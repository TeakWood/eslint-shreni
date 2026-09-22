/**
 * @fileoverview disallow assignments that can lead to race conditions due to usage of `await` or `yield`
 * @author Teddy Katz
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */
/** @typedef {import("eslint-scope").Reference} Reference */
/** @typedef {import("eslint-scope").Scope} Scope */
/** @typedef {import("eslint-scope").Variable} Variable */

/** @typedef {Map<ASTNode, Reference>} ReferenceMap */

/**
 * The read state this rule tracks for a single code path segment.
 * @typedef {Object} SegmentReadInfo
 * @property {Set<Variable>} outdatedReadVariables Variables read before an `await`/`yield` on this segment.
 * @property {Set<Variable>} freshReadVariables Variables read since the last `await`/`yield` on this segment.
 */

/**
 * The per-code-path state this rule stacks as the code path analysis walks the
 * file. `upper` links each entry to the one for the enclosing code path.
 * @typedef {Object} StackEntry
 * @property {StackEntry} upper The entry for the enclosing code path.
 * @property {CodePath} codePath The code path this entry was pushed for.
 * @property {ReferenceMap | null} referenceMap The references of a resumable function scope, or `null` when this code path needs no verification.
 * @property {Set<CodePathSegment>} currentSegments The segments currently being traversed.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — `Reference#identifier`,
 * `Reference#writeExpr` and `Scope#block` — as bare ESTree nodes: no `parent`,
 * and `range` and `loc` optional. The linter populates all three before any
 * rule runs, so each of these is the same object a visitor would have received
 * and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

/**
 * Make the map from identifiers to each reference.
 * @param {Scope} scope The scope to get references.
 * @param {ReferenceMap} [outReferenceMap] The map from identifier nodes to each reference object.
 * @returns {ReferenceMap} `referenceMap`.
 */
function createReferenceMap(scope, outReferenceMap = new Map()) {
	for (const reference of scope.references) {
		if (reference.resolved === null) {
			continue;
		}

		outReferenceMap.set(asNode(reference.identifier), reference);
	}
	for (const childScope of scope.childScopes) {
		if (childScope.type !== "function") {
			createReferenceMap(childScope, outReferenceMap);
		}
	}

	return outReferenceMap;
}

/**
 * Get `reference.writeExpr` of a given reference.
 * If it's the read reference of MemberExpression in LHS, returns RHS in order to address `a.b = await a`
 * @param {Reference} reference The reference to get.
 * @returns {ASTNode | null} The `reference.writeExpr`.
 */
function getWriteExpr(reference) {
	if (reference.writeExpr) {
		return asNode(reference.writeExpr);
	}
	let node = asNode(reference.identifier);

	while (node) {
		const t = node.parent.type;

		if (t === "AssignmentExpression" && node.parent.left === node) {
			return node.parent.right;
		}
		if (t === "MemberExpression" && node.parent.object === node) {
			node = node.parent;
			continue;
		}

		break;
	}

	return null;
}

/**
 * Checks if an expression is a variable that can only be observed within the given function.
 * @param {Variable | null} variable The variable to check
 * @param {boolean} isMemberAccess If `true` then this is a member access.
 * @returns {boolean} `true` if the variable is local to the given function, and is never referenced in a closure.
 */
function isLocalVariableWithoutEscape(variable, isMemberAccess) {
	if (!variable) {
		return false; // A global variable which was not defined.
	}

	// If the reference is a property access and the variable is a parameter, it handles the variable is not local.
	if (isMemberAccess && variable.defs.some(d => d.type === "Parameter")) {
		return false;
	}

	const functionScope = variable.scope.variableScope;

	return variable.references.every(
		reference => reference.from.variableScope === functionScope,
	);
}

/**
 * Represents segment information.
 */
class SegmentInfo {
	/**
	 * Creates a new instance with no segment recorded yet.
	 */
	constructor() {
		/** @type {WeakMap<CodePathSegment, SegmentReadInfo>} */
		this.info = new WeakMap();
	}

	/**
	 * Initialize the segment information.
	 * @param {CodePathSegment} segment The segment to initialize.
	 * @returns {void}
	 */
	initialize(segment) {
		/** @type {Set<Variable>} */
		const outdatedReadVariables = new Set();

		/** @type {Set<Variable>} */
		const freshReadVariables = new Set();

		for (const prevSegment of segment.prevSegments) {
			const info = this.info.get(prevSegment);

			if (info) {
				info.outdatedReadVariables.forEach(
					Set.prototype.add,
					outdatedReadVariables,
				);
				info.freshReadVariables.forEach(
					Set.prototype.add,
					freshReadVariables,
				);
			}
		}

		this.info.set(segment, { outdatedReadVariables, freshReadVariables });
	}

	/**
	 * Mark a given variable as read on given segments.
	 * @param {Iterable<CodePathSegment>} segments The segments that it read the variable on.
	 * @param {Variable} variable The variable to be read.
	 * @returns {void}
	 */
	markAsRead(segments, variable) {
		for (const segment of segments) {
			const info = this.info.get(segment);

			if (info) {
				info.freshReadVariables.add(variable);

				// If a variable is freshly read again, then it's no more out-dated.
				info.outdatedReadVariables.delete(variable);
			}
		}
	}

	/**
	 * Move `freshReadVariables` to `outdatedReadVariables`.
	 * @param {Iterable<CodePathSegment>} segments The segments to process.
	 * @returns {void}
	 */
	makeOutdated(segments) {
		for (const segment of segments) {
			const info = this.info.get(segment);

			if (info) {
				info.freshReadVariables.forEach(
					Set.prototype.add,
					info.outdatedReadVariables,
				);
				info.freshReadVariables.clear();
			}
		}
	}

	/**
	 * Check if a given variable is outdated on the current segments.
	 * @param {Iterable<CodePathSegment>} segments The current segments.
	 * @param {Variable} variable The variable to check.
	 * @returns {boolean} `true` if the variable is outdated on the segments.
	 */
	isOutdated(segments, variable) {
		for (const segment of segments) {
			const info = this.info.get(segment);

			if (info && info.outdatedReadVariables.has(variable)) {
				return true;
			}
		}
		return false;
	}
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				allowProperties: false,
			},
		],

		docs: {
			description:
				"Disallow assignments that can lead to race conditions due to usage of `await` or `yield`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/require-atomic-updates",
		},

		fixable: null,

		schema: [
			{
				type: "object",
				properties: {
					allowProperties: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			nonAtomicUpdate:
				"Possible race condition: `{{value}}` might be reassigned based on an outdated value of `{{value}}`.",
			nonAtomicObjectUpdate:
				"Possible race condition: `{{value}}` might be assigned based on an outdated state of `{{object}}`.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ allowProperties }] = context.options;

		const sourceCode = context.sourceCode;

		/** @type {Map<ASTNode, Array<Reference>>} */
		const assignmentReferences = new Map();
		const segmentInfo = new SegmentInfo();

		/*
		 * The root of the `upper` chain. It stands in for "no enclosing code
		 * path" and is never inspected: every handler that reads `stack` runs
		 * between an `onCodePathStart` and its matching `onCodePathEnd`, and
		 * `upper` is only followed from an entry pushed by `onCodePathStart`.
		 */
		let stack = /** @type {StackEntry} */ (/** @type {unknown} */ (null));

		return {
			/**
			 * Pushes this code path's state.
			 * @param {CodePath} codePath The starting code path.
			 * @param {ASTNode} node The node that starts the code path.
			 * @returns {void}
			 */
			onCodePathStart(codePath, node) {
				const scope = sourceCode.getScope(node);

				// A function scope's block is always a function node.
				const block = asNode(scope.block);
				const shouldVerify =
					scope.type === "function" &&
					(block.async || block.generator);

				stack = {
					upper: stack,
					codePath,
					referenceMap: shouldVerify
						? createReferenceMap(scope)
						: null,
					currentSegments: new Set(),
				};
			},
			/**
			 * Pops this code path's state.
			 * @returns {void}
			 */
			onCodePathEnd() {
				stack = stack.upper;
			},

			/**
			 * Initializes the segment information.
			 * @param {CodePathSegment} segment The starting segment.
			 * @returns {void}
			 */
			onCodePathSegmentStart(segment) {
				segmentInfo.initialize(segment);
				stack.currentSegments.add(segment);
			},

			/**
			 * Tracks an unreachable segment as current.
			 * @param {CodePathSegment} segment The starting segment.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentStart(segment) {
				stack.currentSegments.add(segment);
			},

			/**
			 * Stops tracking an unreachable segment as current.
			 * @param {CodePathSegment} segment The ending segment.
			 * @returns {void}
			 */
			onUnreachableCodePathSegmentEnd(segment) {
				stack.currentSegments.delete(segment);
			},

			/**
			 * Stops tracking a segment as current.
			 * @param {CodePathSegment} segment The ending segment.
			 * @returns {void}
			 */
			onCodePathSegmentEnd(segment) {
				stack.currentSegments.delete(segment);
			},

			/**
			 * Handles references to prepare verification.
			 * @param {ASTNode} node The `Identifier` node.
			 * @returns {void}
			 */
			Identifier(node) {
				const { referenceMap } = stack;
				const reference = referenceMap && referenceMap.get(node);

				// Ignore if this is not a valid variable reference.
				if (!reference) {
					return;
				}
				// `createReferenceMap()` only stores references it resolved.
				const variable = /** @type {Variable} */ (reference.resolved);
				const writeExpr = getWriteExpr(reference);
				const isMemberAccess =
					asNode(reference.identifier).parent.type ===
					"MemberExpression";

				// Add a fresh read variable.
				if (
					reference.isRead() &&
					!(writeExpr && writeExpr.parent.operator === "=")
				) {
					segmentInfo.markAsRead(stack.currentSegments, variable);
				}

				/*
				 * Register the variable to verify after ESLint traversed the `writeExpr` node
				 * if this reference is an assignment to a variable which is referred from other closure.
				 */
				if (
					writeExpr &&
					writeExpr.parent.right === writeExpr && // ← exclude variable declarations.
					!isLocalVariableWithoutEscape(variable, isMemberAccess)
				) {
					let refs = assignmentReferences.get(writeExpr);

					if (!refs) {
						refs = [];
						assignmentReferences.set(writeExpr, refs);
					}

					refs.push(reference);
				}
			},

			/**
			 * Verifies assignments.
			 * If the reference exists in `outdatedReadVariables` list, report it.
			 * @param {ASTNode} node The expression node being left.
			 * @returns {void}
			 */
			":expression:exit"(node) {
				// referenceMap exists if this is in a resumable function scope.
				if (!stack.referenceMap) {
					return;
				}

				// Mark the read variables on this code path as outdated.
				if (
					node.type === "AwaitExpression" ||
					node.type === "YieldExpression"
				) {
					segmentInfo.makeOutdated(stack.currentSegments);
				}

				// Verify.
				const references = assignmentReferences.get(node);

				if (references) {
					assignmentReferences.delete(node);

					for (const reference of references) {
						// Only resolved references reach `assignmentReferences`.
						const variable = /** @type {Variable} */ (
							reference.resolved
						);

						if (
							segmentInfo.isOutdated(
								stack.currentSegments,
								variable,
							)
						) {
							if (node.parent.left === reference.identifier) {
								context.report({
									node: node.parent,
									messageId: "nonAtomicUpdate",
									data: {
										value: variable.name,
									},
								});
							} else if (!allowProperties) {
								context.report({
									node: node.parent,
									messageId: "nonAtomicObjectUpdate",
									data: {
										value: sourceCode.getText(
											node.parent.left,
										),
										object: variable.name,
									},
								});
							}
						}
					}
				}
			},
		};
	},
};

/**
 * @fileoverview A rule to disallow unnecessary assignments`.
 * @author Yosuke Ota
 */

// @ts-check

"use strict";

const { findVariable } = require("@eslint-community/eslint-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */
/** @typedef {import("eslint-scope").Scope} Scope */
/** @typedef {import("estree").Identifier} ESTreeIdentifier */

/**
 * An `eslint-scope` variable, together with the flag the linter attaches to it
 * after scope analysis has run. `eslintUsed` is set by `markVariableAsUsed()`
 * and by `* exported *` directives, and is absent otherwise.
 * @typedef {import("eslint-scope").Variable & { eslintUsed?: boolean }} Variable
 */

/**
 * What this rule records about one segment of a code path: the first and the
 * last identifier seen while that segment was being traversed. Both start out
 * `null` and stay that way for a segment that contains no identifiers at all.
 * @typedef {Object} SegmentInfo
 * @property {CodePathSegment} segment The segment this information is about.
 * @property {ASTNode | null} first The first identifier seen in the segment.
 * @property {ASTNode | null} last The last identifier seen in the segment.
 */

/**
 * One assignment to one variable, recorded as the code path is walked so that
 * `verify()` can decide afterwards whether the assigned value was ever read.
 * @typedef {Object} AssignmentInfo
 * @property {Variable} variable The variable being assigned to.
 * @property {ASTNode} identifier The identifier that names the variable on the left-hand side.
 * @property {ASTNode} node The `VariableDeclarator`, `AssignmentExpression` or `UpdateExpression` that performs the assignment.
 * @property {ASTNode | null} expression The assigned expression, or `null` for an `UpdateExpression`.
 * @property {Array<CodePathSegment>} segments The segments that were current when the assignment was seen.
 */

/**
 * A segment reachable from the assignment currently being verified, paired
 * with the assignment that overwrites the variable there, if there is one.
 * @typedef {Object} SubsequentSegmentInfo
 * @property {CodePathSegment} segment The reachable segment.
 * @property {AssignmentInfo} [assignment] The assignment found in that segment, if any.
 */

/**
 * The per-code-path state this rule stacks as the code path analysis walks the
 * file. `upper` links each entry to the one for the enclosing code path.
 * @typedef {Object} ScopeStack
 * @property {ScopeStack} upper The entry for the enclosing code path.
 * @property {CodePath} codePath The code path this entry is about.
 * @property {Scope} scope The scope the code path starts in.
 * @property {Record<string, SegmentInfo>} segments The recorded information for each segment, keyed by segment ID.
 * @property {Set<CodePathSegment>} currentSegments The segments currently being traversed.
 * @property {Map<Variable, Array<AssignmentInfo>>} assignments The assignments seen so far, grouped by variable.
 * @property {Array<ASTNode>} tryStatementBlocks The `try` blocks seen so far in this code path.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — `Reference#identifier` and
 * `Definition#node` — as bare ESTree nodes: no `parent`, and `range` and `loc`
 * optional. The linter populates all three before any rule runs, so each of
 * these is the same object a visitor would have received and is reinterpreted
 * rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

/**
 * Extract identifier from the given pattern node used on the left-hand side of the assignment.
 * @param {ASTNode} pattern The pattern node to extract identifier
 * @yields {ASTNode} The extracted identifier
 * @returns {Generator<ASTNode>} The extracted identifiers
 */
function* extractIdentifiersFromPattern(pattern) {
	switch (pattern.type) {
		case "Identifier":
			yield pattern;
			return;
		case "ObjectPattern":
			for (const property of pattern.properties) {
				yield* extractIdentifiersFromPattern(
					property.type === "Property" ? property.value : property,
				);
			}
			return;
		case "ArrayPattern":
			for (const element of pattern.elements) {
				if (!element) {
					continue;
				}
				yield* extractIdentifiersFromPattern(element);
			}
			return;
		case "RestElement":
			yield* extractIdentifiersFromPattern(pattern.argument);
			return;
		case "AssignmentPattern":
			yield* extractIdentifiersFromPattern(pattern.left);

		// no default
	}
}

/**
 * Checks whether the given identifier node is evaluated after the assignment identifier.
 * @param {AssignmentInfo} assignment The assignment info.
 * @param {ASTNode} identifier The identifier to check.
 * @returns {boolean} `true` if the given identifier node is evaluated after the assignment identifier.
 */
function isIdentifierEvaluatedAfterAssignment(assignment, identifier) {
	if (identifier.range[0] < assignment.identifier.range[1]) {
		return false;
	}
	if (
		assignment.expression &&
		assignment.expression.range[0] <= identifier.range[0] &&
		identifier.range[1] <= assignment.expression.range[1]
	) {
		/*
		 * The identifier node is in an expression that is evaluated before the assignment.
		 * e.g. x = id;
		 *          ^^ identifier to check
		 *      ^      assignment identifier
		 */
		return false;
	}

	/*
	 * e.g.
	 *      x = 42; id;
	 *              ^^ identifier to check
	 *      ^          assignment identifier
	 *      let { x, y = id } = obj;
	 *                   ^^  identifier to check
	 *            ^          assignment identifier
	 */
	return true;
}

/**
 * Checks whether the given identifier node is used between the assigned identifier and the equal sign.
 *
 * e.g. let { x, y = x } = obj;
 *                   ^   identifier to check
 *            ^          assigned identifier
 * @param {AssignmentInfo} assignment The assignment info.
 * @param {ASTNode} identifier The identifier to check.
 * @returns {boolean} `true` if the given identifier node is used between the assigned identifier and the equal sign.
 */
function isIdentifierUsedBetweenAssignedAndEqualSign(assignment, identifier) {
	if (!assignment.expression) {
		return false;
	}
	return (
		assignment.identifier.range[1] <= identifier.range[0] &&
		identifier.range[1] <= assignment.expression.range[0]
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow variable assignments when the value is not used",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-useless-assignment",
		},

		schema: [],

		messages: {
			unnecessaryAssignment:
				"The value assigned to '{{name}}' is not used in subsequent statements.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/*
		 * The root of the `upper` chain. It stands in for "no enclosing code
		 * path" and is never read: every other read happens between an
		 * `onCodePathStart` and its matching `onCodePathEnd`, where an entry
		 * has been pushed, and `upper` is only followed back to this value by
		 * `onCodePathEnd` itself.
		 */
		let scopeStack = /** @type {ScopeStack} */ (
			/** @type {unknown} */ (null)
		);

		/** @type {Set<Scope>} */
		const codePathStartScopes = new Set();

		/**
		 * Gets the scope of code path start from given scope
		 * @param {Scope} scope The initial scope
		 * @returns {Scope | null} The scope of code path start
		 * @throws {Error} Unexpected error
		 */
		function getCodePathStartScope(scope) {
			let target = /** @type {Scope | null} */ (scope);

			while (target) {
				if (codePathStartScopes.has(target)) {
					return target;
				}
				target = target.upper;
			}

			// Should be unreachable
			return null;
		}

		/**
		 * Verify the given scope stack.
		 * @param {ScopeStack} target The scope stack to verify.
		 * @returns {void}
		 */
		function verify(target) {
			/**
			 * Checks whether the given identifier is used in the segment.
			 * @param {CodePathSegment} segment The code path segment.
			 * @param {ASTNode} identifier The identifier to check.
			 * @returns {boolean | null} `true` if the identifier is used in the segment, `null` if the segment holds no identifier at all.
			 */
			function isIdentifierUsedInSegment(segment, identifier) {
				const segmentInfo = target.segments[segment.id];

				return (
					segmentInfo.first &&
					segmentInfo.last &&
					segmentInfo.first.range[0] <= identifier.range[0] &&
					identifier.range[1] <= segmentInfo.last.range[1]
				);
			}

			/**
			 * Verifies whether the given assignment info is an used assignment.
			 * Report if it is an unused assignment.
			 * @param {AssignmentInfo} targetAssignment The assignment info to verify.
			 * @param {Array<AssignmentInfo>} allAssignments The list of all assignment info for variables.
			 * @returns {void}
			 */
			function verifyAssignmentIsUsed(targetAssignment, allAssignments) {
				// Skip assignment if it is in a try block.
				const isAssignmentInTryBlock = target.tryStatementBlocks.some(
					tryBlock =>
						tryBlock.range[0] <=
							targetAssignment.identifier.range[0] &&
						targetAssignment.identifier.range[1] <=
							tryBlock.range[1],
				);

				if (isAssignmentInTryBlock) {
					return;
				}

				/**
				 * Information used in `getSubsequentSegments()`.
				 * To avoid unnecessary iterations, cache information that has already been iterated over,
				 * and if additional iterations are needed, start iterating from the retained position.
				 */
				const subsequentSegmentData = {
					/**
					 * Cache of subsequent segment information list that have already been iterated.
					 * @type {Array<SubsequentSegmentInfo>}
					 */
					results: [],

					/**
					 * Subsequent segments that have already been iterated on. Used to avoid infinite loops.
					 * @type {Set<CodePathSegment>}
					 */
					subsequentSegments: new Set(),

					/**
					 * Unexplored code path segment.
					 * If additional iterations are needed, consume this information and iterate.
					 */
					queueSegments: targetAssignment.segments.flatMap(
						segment => segment.nextSegments,
					),
				};

				/**
				 * Gets the subsequent segments from the segment of
				 * the assignment currently being validated (targetAssignment).
				 * @yields {SubsequentSegmentInfo} The next reachable segment.
				 * @returns {Generator<SubsequentSegmentInfo>} the subsequent segments
				 */
				function* getSubsequentSegments() {
					yield* subsequentSegmentData.results;

					while (subsequentSegmentData.queueSegments.length > 0) {
						// The loop condition guarantees the queue is not empty.
						const nextSegment = /** @type {CodePathSegment} */ (
							subsequentSegmentData.queueSegments.shift()
						);

						if (
							subsequentSegmentData.subsequentSegments.has(
								nextSegment,
							)
						) {
							continue;
						}
						subsequentSegmentData.subsequentSegments.add(
							nextSegment,
						);

						const assignmentInSegment = allAssignments.find(
							otherAssignment =>
								otherAssignment.segments.includes(
									nextSegment,
								) &&
								!isIdentifierUsedBetweenAssignedAndEqualSign(
									otherAssignment,
									targetAssignment.identifier,
								),
						);

						if (!assignmentInSegment) {
							/*
							 * Stores the next segment to explore.
							 * If `assignmentInSegment` exists,
							 * we are guarding it because we don't need to explore the next segment.
							 */
							subsequentSegmentData.queueSegments.push(
								...nextSegment.nextSegments,
							);
						}

						const result = {
							segment: nextSegment,
							assignment: assignmentInSegment,
						};

						subsequentSegmentData.results.push(result);
						yield result;
					}
				}

				if (
					targetAssignment.variable.references.some(ref => {
						const type = ref.identifier.type;
						return (
							type !== "Identifier" && type !== "JSXIdentifier"
						);
					})
				) {
					/**
					 * Skip checking for a variable that has at least one non-identifier reference.
					 * It's generated by plugins and cannot be handled reliably in the core rule.
					 */
					return;
				}

				const readReferences =
					targetAssignment.variable.references.filter(reference =>
						reference.isRead(),
					);

				if (!readReferences.length) {
					/*
					 * It is not just an unnecessary assignment, but an unnecessary (unused) variable
					 * and thus should not be reported by this rule because it is reported by `no-unused-vars`.
					 */
					return;
				}

				/**
				 * Other assignment on the current segment and after current assignment.
				 */
				const otherAssignmentAfterTargetAssignment =
					allAssignments.find(assignment => {
						if (
							assignment === targetAssignment ||
							(assignment.segments.length &&
								assignment.segments.every(
									segment =>
										!targetAssignment.segments.includes(
											segment,
										),
								))
						) {
							return false;
						}
						if (
							isIdentifierEvaluatedAfterAssignment(
								targetAssignment,
								assignment.identifier,
							)
						) {
							return true;
						}
						if (
							assignment.expression &&
							assignment.expression.range[0] <=
								targetAssignment.identifier.range[0] &&
							targetAssignment.identifier.range[1] <=
								assignment.expression.range[1]
						) {
							/*
							 * The target assignment is in an expression that is evaluated before the assignment.
							 * e.g. x=(x=1);
							 *         ^^^ targetAssignment
							 *      ^^^^^^^ assignment
							 */
							return true;
						}

						return false;
					});

				for (const reference of readReferences) {
					const referenceIdentifier = asNode(reference.identifier);

					/*
					 * If the scope of the reference is outside the current code path scope,
					 * we cannot track whether this assignment is not used.
					 * For example, it can also be called asynchronously.
					 */
					if (
						target.scope !== getCodePathStartScope(reference.from)
					) {
						return;
					}

					// Checks if it is used in the same segment as the target assignment.
					if (
						isIdentifierEvaluatedAfterAssignment(
							targetAssignment,
							referenceIdentifier,
						) &&
						(isIdentifierUsedBetweenAssignedAndEqualSign(
							targetAssignment,
							referenceIdentifier,
						) ||
							targetAssignment.segments.some(segment =>
								isIdentifierUsedInSegment(
									segment,
									referenceIdentifier,
								),
							))
					) {
						if (
							otherAssignmentAfterTargetAssignment &&
							isIdentifierEvaluatedAfterAssignment(
								otherAssignmentAfterTargetAssignment,
								referenceIdentifier,
							)
						) {
							// There was another assignment before the reference. Therefore, it has not been used yet.
							continue;
						}

						// Uses in statements after the written identifier.
						return;
					}

					if (otherAssignmentAfterTargetAssignment) {
						/*
						 * The assignment was followed by another assignment in the same segment.
						 * Therefore, there is no need to check the next segment.
						 */
						continue;
					}

					// Check subsequent segments.
					for (const subsequentSegment of getSubsequentSegments()) {
						if (
							isIdentifierUsedInSegment(
								subsequentSegment.segment,
								referenceIdentifier,
							)
						) {
							if (
								subsequentSegment.assignment &&
								isIdentifierEvaluatedAfterAssignment(
									subsequentSegment.assignment,
									referenceIdentifier,
								)
							) {
								// There was another assignment before the reference. Therefore, it has not been used yet.
								continue;
							}

							// It is used
							return;
						}
					}
				}
				context.report({
					node: targetAssignment.identifier,
					messageId: "unnecessaryAssignment",
					data: { name: targetAssignment.identifier.name },
				});
			}

			// Verify that each assignment in the code path is used.
			for (const assignments of target.assignments.values()) {
				assignments.sort(
					(a, b) => a.identifier.range[0] - b.identifier.range[0],
				);
				for (const assignment of assignments) {
					verifyAssignmentIsUsed(assignment, assignments);
				}
			}
		}

		return {
			/**
			 * Pushes the state for a newly started code path.
			 * @param {CodePath} codePath The code path that started.
			 * @param {ASTNode} node The node that starts the code path.
			 * @returns {void}
			 */
			onCodePathStart(codePath, node) {
				const scope = sourceCode.getScope(node);

				scopeStack = {
					upper: scopeStack,
					codePath,
					scope,
					segments: Object.create(null),
					currentSegments: new Set(),
					assignments: new Map(),
					tryStatementBlocks: [],
				};
				codePathStartScopes.add(scopeStack.scope);
			},
			/**
			 * Verifies and pops the state for the code path that just ended.
			 * @returns {void}
			 */
			onCodePathEnd() {
				verify(scopeStack);

				scopeStack = scopeStack.upper;
			},

			/**
			 * Starts recording identifiers for a segment.
			 * @param {CodePathSegment} segment The segment that started.
			 * @returns {void}
			 */
			onCodePathSegmentStart(segment) {
				const segmentInfo = { segment, first: null, last: null };

				scopeStack.segments[segment.id] = segmentInfo;
				scopeStack.currentSegments.add(segment);
			},

			/**
			 * Stops recording identifiers for a segment.
			 * @param {CodePathSegment} segment The segment that ended.
			 * @returns {void}
			 */
			onCodePathSegmentEnd(segment) {
				scopeStack.currentSegments.delete(segment);
			},

			/**
			 * Records a `try` block, whose assignments are never reported.
			 * @param {ASTNode} node The `TryStatement` node.
			 * @returns {void}
			 */
			TryStatement(node) {
				scopeStack.tryStatementBlocks.push(node.block);
			},

			/**
			 * Records the identifier as the first and/or last one in each
			 * segment currently being traversed.
			 * @param {ASTNode} node The identifier node.
			 * @returns {void}
			 */
			"Identifier, JSXIdentifier"(node) {
				for (const segment of scopeStack.currentSegments) {
					const segmentInfo = scopeStack.segments[segment.id];

					if (!segmentInfo.first) {
						segmentInfo.first = node;
					}
					segmentInfo.last = node;
				}
			},

			/**
			 * Records an assignment so that `verify()` can decide later
			 * whether the assigned value is ever read.
			 * @param {ASTNode} node The node that performs the assignment.
			 * @returns {void}
			 */
			"VariableDeclarator[init!=null], AssignmentExpression, UpdateExpression:exit"(
				node,
			) {
				if (scopeStack.currentSegments.size === 0) {
					// Ignore unreachable segments
					return;
				}

				const assignments = scopeStack.assignments;

				let pattern;
				let expression = null;

				if (node.type === "VariableDeclarator") {
					pattern = node.id;
					expression = node.init;
				} else if (node.type === "AssignmentExpression") {
					pattern = node.left;
					expression = node.right;
				} else {
					// UpdateExpression
					pattern = node.argument;
				}

				for (const identifier of extractIdentifiersFromPattern(
					pattern,
				)) {
					const scope = sourceCode.getScope(identifier);

					/*
					 * `findVariable()` is declared against bare ESTree, where
					 * `Identifier#type` is the literal `"Identifier"` rather
					 * than the rules layer's `string`, and it hands back an
					 * `eslint-scope` variable through the `eslint` package's
					 * own types.
					 */
					const variable = /** @type {Variable | null} */ (
						findVariable(
							scope,
							/** @type {ESTreeIdentifier} */ (
								/** @type {unknown} */ (identifier)
							),
						)
					);

					if (!variable) {
						continue;
					}

					// We don't know where global variables are used.
					if (
						variable.scope.type === "global" &&
						variable.defs.length === 0
					) {
						continue;
					}

					/*
					 * If the scope of the variable is outside the current code path scope,
					 * we cannot track whether this assignment is not used.
					 */
					if (
						scopeStack.scope !==
						getCodePathStartScope(variable.scope)
					) {
						continue;
					}

					// Variables marked by `markVariableAsUsed()` or
					// exported by "exported" block comment.
					if (variable.eslintUsed) {
						continue;
					}

					// Variables exported by ESM export syntax
					if (variable.scope.type === "module") {
						if (
							variable.defs.some(
								def =>
									(def.type === "Variable" &&
										asNode(def.parent).parent.type ===
											"ExportNamedDeclaration") ||
									(def.type === "FunctionName" &&
										(asNode(def.node).parent.type ===
											"ExportNamedDeclaration" ||
											asNode(def.node).parent.type ===
												"ExportDefaultDeclaration")) ||
									(def.type === "ClassName" &&
										(asNode(def.node).parent.type ===
											"ExportNamedDeclaration" ||
											asNode(def.node).parent.type ===
												"ExportDefaultDeclaration")),
							)
						) {
							continue;
						}
						if (
							variable.references.some(
								reference =>
									asNode(reference.identifier).parent.type ===
									"ExportSpecifier",
							)
						) {
							// It have `export { ... }` reference.
							continue;
						}
					}

					let list = assignments.get(variable);

					if (!list) {
						list = [];
						assignments.set(variable, list);
					}
					list.push({
						variable,
						identifier,
						node,
						expression,
						segments: [...scopeStack.currentSegments],
					});
				}
			},
		};
	},
};

// @ts-check
/**
 * @fileoverview A class of the code path analyzer.
 * @author Toru Nagashima
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("../../shared/assert"),
	{ breakableTypePattern } = require("../../shared/ast-utils"),
	CodePath = require("./code-path"),
	CodePathSegment = require("./code-path-segment"),
	IdGenerator = require("./id-generator"),
	debug = require("./debug-helpers");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @import { ASTNode } from "../../types/core.js" */

/** @import { ChoiceKind, LoopContextType } from "./code-path-state.js" */

/**
 * @typedef {InstanceType<typeof import("./code-path-state.js")>} CodePathState
 */

/**
 * The event names this analyzer emits, in the order the wrapped generator
 * receives them.
 * @typedef {"onCodePathStart" | "onCodePathEnd" | "onCodePathSegmentStart" | "onCodePathSegmentEnd" | "onUnreachableCodePathSegmentStart" | "onUnreachableCodePathSegmentEnd" | "onCodePathSegmentLoop"} CodePathEvent
 */

/**
 * The event generator this analyzer wraps.
 *
 * `SourceCodeVisitor` is the only implementation, but it lives above this
 * directory: `lib/languages/js/source-code/source-code.js` is what pairs the
 * two. Describing the surface structurally is what keeps this subtree
 * depending on nothing but `lib/shared` — see the note on the class below.
 * @typedef {Object} EventGenerator
 * @property {(node: ASTNode) => void} enterNode Called when a node is entered.
 * @property {(node: ASTNode) => void} leaveNode Called when a node is left.
 * @property {(eventName: CodePathEvent, args: unknown[]) => void} emit Emits an event.
 */

/**
 * A node, as this module sees one.
 *
 * ESCAPE HATCH. The AST vocabulary settled on by the phase-0 spike is a closed
 * union of ~89 node interfaces; `lib/types/core.d.ts` carries only its agreed
 * base (`ASTNode`, with `type`, `range`, `loc` and `parent`), and the union is
 * authored by a later bead. `Node` is that base intersected with the members
 * this module reads — the same interim widening `lib/rules/utils/ast-utils.js`
 * documents at its own `Node` typedef, and deliberately not a second
 * vocabulary: every signature below still speaks `ASTNode`.
 *
 * It buys no narrowing. The six `switch` ladders here all discriminate on
 * `node.type` or `parent.type`, and `ASTNode.type` is a bare `string`, so each
 * `case` widens nothing — every member a `case` arm reaches has to be declared
 * unconditionally.
 *
 * RETIREMENT: when the node union lands, delete `Node` and `NodeMembers` and
 * replace every `Node` below with `ASTNode`. The signatures do not change, the
 * `case` arms start narrowing, and the two casts marked "interim view" go away.
 * @typedef {ASTNode & NodeMembers} Node
 */

/**
 * The per-node members this module reads. See `Node`.
 *
 * `parent` is declared non-`null` while `ASTNode` declares it `ASTNode | null`.
 * That overstates the runtime — `Program.parent` really is `null` — and it is
 * declared this way for the reason `ast-utils.js` gives at its own
 * `NodeMembers`: the alternative is an assertion at every `node.parent` read in
 * a file that does little else. The one caller that can reach the root,
 * `CodePathAnalyzer#enterNode`, still tests `node.parent` at runtime before
 * calling `preprocess`, and that guard is load-bearing: do not remove it
 * because the type says it cannot fire.
 *
 * Every other member is declared non-optional for the same reason ast-utils
 * gives: an interim view that cannot discriminate can only offer per-kind
 * members unconditionally or make all of them `| undefined`, and the second
 * buys no safety — it just moves the assertion to every read. Nullability the
 * runtime really does express through a member's VALUE (`id`, `test`,
 * `alternate`, `label`, `handler`, `finalizer`, `update`) is kept.
 * @typedef {Object} NodeMembers
 * @property {Node} parent The node's parent. See above.
 * @property {Node | null} id `Identifier` naming a function, class or variable declarator.
 * @property {string} name The name of an `Identifier`.
 * @property {Node} value The value half of a `Property`, `PropertyDefinition` or `MethodDefinition`.
 * @property {string} operator The operator of a logical or assignment form.
 * @property {Node | null} test The test of a conditional, a loop or a `SwitchCase`. `null` for `default:`.
 * @property {Node} key The key of a `Property`, `PropertyDefinition` or `MethodDefinition`.
 * @property {boolean} computed Whether a key is computed.
 * @property {boolean} shorthand Whether a `Property` uses shorthand syntax.
 * @property {boolean} optional Whether a call or member access is optional (`?.`).
 * @property {Node[]} arguments `CallExpression` arguments.
 * @property {Node} property `MemberExpression#property`.
 * @property {Node} left The left operand of an assignment or `for-in`/`for-of` head.
 * @property {Node} right The right operand of a logical, assignment or `for-in`/`for-of` form.
 * @property {Node} body The body of a loop or a `LabeledStatement`.
 * @property {Node | null} update `ForStatement#update`.
 * @property {Node} consequent The branch of a conditional. `SwitchCase#consequent` is a statement LIST — see the two casts below.
 * @property {Node | null} alternate The `else` branch of a conditional.
 * @property {Node} discriminant `SwitchStatement#discriminant`.
 * @property {Node[]} cases `SwitchStatement#cases`.
 * @property {Node | null} handler `TryStatement#handler`.
 * @property {Node | null} finalizer `TryStatement#finalizer`.
 * @property {Node | null} label The label of a `LabeledStatement`, `BreakStatement` or `ContinueStatement`.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether or not a given node is a `case` node (not `default` node).
 * @param {Node} node A `SwitchCase` node to check.
 * @returns {boolean} `true` if the node is a `case` node (not `default` node).
 */
function isCaseNode(node) {
	return Boolean(node.test);
}

/**
 * Checks if a given node appears as the value of a PropertyDefinition node.
 * @param {Node} node The node to check.
 * @returns {boolean} `true` if the node is a PropertyDefinition value,
 *      false if not.
 */
function isPropertyDefinitionValue(node) {
	const parent = node.parent;

	return (
		parent && parent.type === "PropertyDefinition" && parent.value === node
	);
}

/**
 * Checks whether the given logical operator is taken into account for the code
 * path analysis.
 * @param {string} operator The operator found in the LogicalExpression node
 * @returns {operator is "&&" | "||" | "??"} `true` if the operator is "&&" or "||" or "??"
 */
function isHandledLogicalOperator(operator) {
	return operator === "&&" || operator === "||" || operator === "??";
}

/**
 * Checks whether the given assignment operator is a logical assignment operator.
 * Logical assignments are taken into account for the code path analysis
 * because of their short-circuiting semantics.
 * @param {string} operator The operator found in the AssignmentExpression node
 * @returns {operator is "&&=" | "||=" | "??="} `true` if the operator is "&&=" or "||=" or "??="
 */
function isLogicalAssignmentOperator(operator) {
	return operator === "&&=" || operator === "||=" || operator === "??=";
}

/**
 * Gets the label if the parent node of a given node is a LabeledStatement.
 * @param {Node} node A node to get.
 * @returns {string | null} The label or `null`.
 */
function getLabel(node) {
	if (node.parent.type === "LabeledStatement") {
		/*
		 * `label` is declared nullable because `break`/`continue` really can
		 * omit it; a `LabeledStatement` always has one. The `type` test above
		 * is what guarantees it, and the interim view cannot narrow on it.
		 */
		return /** @type {Node} */ (node.parent.label).name;
	}
	return null;
}

/**
 * Checks whether a given logical expression node takes different paths for the
 * `true` and `false` cases.
 * @param {Node} node A node to check.
 * @returns {boolean} `true` if the node is a test of a choice statement.
 */
function isForkingByTrueOrFalse(node) {
	const parent = node.parent;

	switch (parent.type) {
		case "ConditionalExpression":
		case "IfStatement":
		case "WhileStatement":
		case "DoWhileStatement":
		case "ForStatement":
			return parent.test === node;

		case "LogicalExpression":
			return isHandledLogicalOperator(parent.operator);

		case "AssignmentExpression":
			return isLogicalAssignmentOperator(parent.operator);

		default:
			return false;
	}
}

/**
 * Gets the boolean value of a given literal node.
 *
 * This is used to detect infinite loops (e.g. `while (true) {}`).
 * Statements preceded by an infinite loop are unreachable if the loop didn't
 * have any `break` statement.
 * @param {Node} node A node to get.
 * @returns {boolean | undefined} a boolean value if the node is a Literal node,
 *   otherwise `undefined`.
 */
function getBooleanValueIfSimpleConstant(node) {
	if (node.type === "Literal") {
		return Boolean(node.value);
	}
	return void 0;
}

/**
 * Checks that a given identifier node is a reference or not.
 *
 * This is used to detect the first throwable node in a `try` block.
 * @param {Node} node An Identifier node to check.
 * @returns {boolean} `true` if the node is a reference.
 */
function isIdentifierReference(node) {
	const parent = node.parent;

	switch (parent.type) {
		case "LabeledStatement":
		case "BreakStatement":
		case "ContinueStatement":
		case "ArrayPattern":
		case "RestElement":
		case "ImportSpecifier":
		case "ImportDefaultSpecifier":
		case "ImportNamespaceSpecifier":
		case "CatchClause":
			return false;

		case "FunctionDeclaration":
		case "FunctionExpression":
		case "ArrowFunctionExpression":
		case "ClassDeclaration":
		case "ClassExpression":
		case "VariableDeclarator":
			return parent.id !== node;

		case "Property":
		case "PropertyDefinition":
		case "MethodDefinition":
			return parent.key !== node || parent.computed || parent.shorthand;

		case "AssignmentPattern":
			return parent.key !== node;

		default:
			return true;
	}
}

/**
 * Updates the current segment with the head segment.
 * This is similar to local branches and tracking branches of git.
 *
 * To separate the current and the head is in order to not make useless segments.
 *
 * In this process, both "onCodePathSegmentStart" and "onCodePathSegmentEnd"
 * events are fired.
 * @param {CodePathAnalyzer} analyzer The instance.
 * @param {Node} node The current AST node.
 * @returns {void}
 */
function forwardCurrentToHead(analyzer, node) {
	/*
	 * ESCAPE HATCH: `analyzer.codePath` is `null` only before the `Program`
	 * node has started the first path and after the last one has ended, and
	 * this function is only reached in between. A runtime helper would be a
	 * call per node visit on the linter's hottest path; the assertion costs
	 * nothing.
	 */
	const codePath = /** @type {CodePath} */ (analyzer.codePath);
	const state = CodePath.getState(codePath);
	const currentSegments = state.currentSegments;
	const headSegments = state.headSegments;
	const end = Math.max(currentSegments.length, headSegments.length);
	let i, currentSegment, headSegment;

	// Fires leaving events.
	for (i = 0; i < end; ++i) {
		currentSegment = currentSegments[i];
		headSegment = headSegments[i];

		if (currentSegment !== headSegment && currentSegment) {
			const eventName = currentSegment.reachable
				? "onCodePathSegmentEnd"
				: "onUnreachableCodePathSegmentEnd";

			debug.dump(`${eventName} ${currentSegment.id}`);

			analyzer.emit(eventName, [currentSegment, node]);
		}
	}

	// Update state.
	state.currentSegments = headSegments;

	// Fires entering events.
	for (i = 0; i < end; ++i) {
		currentSegment = currentSegments[i];
		headSegment = headSegments[i];

		if (currentSegment !== headSegment && headSegment) {
			const eventName = headSegment.reachable
				? "onCodePathSegmentStart"
				: "onUnreachableCodePathSegmentStart";

			debug.dump(`${eventName} ${headSegment.id}`);
			CodePathSegment.markUsed(headSegment);
			analyzer.emit(eventName, [headSegment, node]);
		}
	}
}

/**
 * Updates the current segment with an empty array.
 * This is called when a code path ends.
 * @param {CodePathAnalyzer} analyzer The instance.
 * @param {Node} node The current AST node.
 * @returns {void}
 */
function leaveFromCurrentSegment(analyzer, node) {
	// ESCAPE HATCH: see `forwardCurrentToHead`.
	const state = CodePath.getState(
		/** @type {CodePath} */ (analyzer.codePath),
	);
	const currentSegments = state.currentSegments;

	for (let i = 0; i < currentSegments.length; ++i) {
		const currentSegment = currentSegments[i];
		const eventName = currentSegment.reachable
			? "onCodePathSegmentEnd"
			: "onUnreachableCodePathSegmentEnd";

		debug.dump(`${eventName} ${currentSegment.id}`);

		analyzer.emit(eventName, [currentSegment, node]);
	}

	state.currentSegments = [];
}

/**
 * Updates the code path due to the position of a given node in the parent node
 * thereof.
 *
 * For example, if the node is `parent.consequent`, this creates a fork from the
 * current path.
 * @param {CodePathAnalyzer} analyzer The instance.
 * @param {Node} node The current AST node.
 * @returns {void}
 */
function preprocess(analyzer, node) {
	// ESCAPE HATCH: see `forwardCurrentToHead`.
	const codePath = /** @type {CodePath} */ (analyzer.codePath);

	const state = CodePath.getState(codePath);
	const parent = node.parent;

	switch (parent.type) {
		// The `arguments.length == 0` case is in `postprocess` function.
		case "CallExpression":
			if (
				parent.optional === true &&
				parent.arguments.length >= 1 &&
				parent.arguments[0] === node
			) {
				state.makeOptionalRight();
			}
			break;
		case "MemberExpression":
			if (parent.optional === true && parent.property === node) {
				state.makeOptionalRight();
			}
			break;

		case "LogicalExpression":
			if (
				parent.right === node &&
				isHandledLogicalOperator(parent.operator)
			) {
				state.makeLogicalRight();
			}
			break;

		case "AssignmentExpression":
			if (
				parent.right === node &&
				isLogicalAssignmentOperator(parent.operator)
			) {
				state.makeLogicalRight();
			}
			break;

		case "ConditionalExpression":
		case "IfStatement":
			/*
			 * Fork if this node is at `consequent`/`alternate`.
			 * `popForkContext()` exists at `IfStatement:exit` and
			 * `ConditionalExpression:exit`.
			 */
			if (parent.consequent === node) {
				state.makeIfConsequent();
			} else if (parent.alternate === node) {
				state.makeIfAlternate();
			}
			break;

		case "SwitchCase":
			/*
			 * ESCAPE HATCH, interim view: `consequent` is a statement LIST on
			 * `SwitchCase` and a single node on the conditional forms, and the
			 * `case` above cannot narrow between them while `type` is a bare
			 * `string`.
			 */
			if (
				/** @type {Node[]} */ (
					/** @type {unknown} */ (parent.consequent)
				)[0] === node
			) {
				state.makeSwitchCaseBody(false, !parent.test);
			}
			break;

		case "TryStatement":
			if (parent.handler === node) {
				state.makeCatchBlock();
			} else if (parent.finalizer === node) {
				state.makeFinallyBlock();
			}
			break;

		case "WhileStatement":
			if (parent.test === node) {
				state.makeWhileTest(getBooleanValueIfSimpleConstant(node));
			} else {
				assert(parent.body === node);
				state.makeWhileBody();
			}
			break;

		case "DoWhileStatement":
			if (parent.body === node) {
				state.makeDoWhileBody();
			} else {
				assert(parent.test === node);
				state.makeDoWhileTest(getBooleanValueIfSimpleConstant(node));
			}
			break;

		case "ForStatement":
			if (parent.test === node) {
				state.makeForTest(getBooleanValueIfSimpleConstant(node));
			} else if (parent.update === node) {
				state.makeForUpdate();
			} else if (parent.body === node) {
				state.makeForBody();
			}
			break;

		case "ForInStatement":
		case "ForOfStatement":
			if (parent.left === node) {
				state.makeForInOfLeft();
			} else if (parent.right === node) {
				state.makeForInOfRight();
			} else {
				assert(parent.body === node);
				state.makeForInOfBody();
			}
			break;

		case "AssignmentPattern":
			/*
			 * Fork if this node is at `right`.
			 * `left` is executed always, so it uses the current path.
			 * `popForkContext()` exists at `AssignmentPattern:exit`.
			 */
			if (parent.right === node) {
				state.pushForkContext();
				state.forkBypassPath();
				state.forkPath();
			}
			break;

		default:
			break;
	}
}

/**
 * Updates the code path due to the type of a given node in entering.
 * @param {CodePathAnalyzer} analyzer The instance.
 * @param {Node} node The current AST node.
 * @returns {void}
 */
function processCodePathToEnter(analyzer, node) {
	let codePath = analyzer.codePath;

	/*
	 * ESCAPE HATCH: `state` is genuinely unset for the very first node, which
	 * is always `Program` — and the `Program` arm below calls `startCodePath`,
	 * which assigns it, before anything reads it. Declaring it nullable instead
	 * would put an assertion on each of the twelve `state.*` calls below.
	 */
	let state = /** @type {CodePathState} */ (
		codePath && CodePath.getState(codePath)
	);
	const parent = node.parent;

	/**
	 * Creates a new code path and trigger the onCodePathStart event
	 * based on the currently selected node.
	 * @param {import("./code-path.js").CodePathOrigin} origin The reason the code path was started.
	 * @returns {void}
	 */
	function startCodePath(origin) {
		if (codePath) {
			// Emits onCodePathSegmentStart events if updated.
			forwardCurrentToHead(analyzer, node);
			debug.dumpState(node, state, false);
		}

		// Create the code path of this scope.
		codePath = analyzer.codePath = new CodePath({
			id: analyzer.idGenerator.next(),
			origin,
			upper: codePath,
			onLooped: analyzer.onLooped,
		});
		state = CodePath.getState(codePath);

		// Emits onCodePathStart events.
		debug.dump(`onCodePathStart ${codePath.id}`);
		analyzer.emit("onCodePathStart", [codePath, node]);
	}

	/*
	 * Special case: The right side of class field initializer is considered
	 * to be its own function, so we need to start a new code path in this
	 * case.
	 */
	if (isPropertyDefinitionValue(node)) {
		startCodePath("class-field-initializer");

		/*
		 * Intentional fall through because `node` needs to also be
		 * processed by the code below. For example, if we have:
		 *
		 * class Foo {
		 *     a = () => {}
		 * }
		 *
		 * In this case, we also need start a second code path.
		 */
	}

	switch (node.type) {
		case "Program":
			startCodePath("program");
			break;

		case "FunctionDeclaration":
		case "FunctionExpression":
		case "ArrowFunctionExpression":
			startCodePath("function");
			break;

		case "StaticBlock":
			startCodePath("class-static-block");
			break;

		case "ChainExpression":
			state.pushChainContext();
			break;
		case "CallExpression":
			if (node.optional === true) {
				state.makeOptionalNode();
			}
			break;
		case "MemberExpression":
			if (node.optional === true) {
				state.makeOptionalNode();
			}
			break;

		case "LogicalExpression":
			if (isHandledLogicalOperator(node.operator)) {
				state.pushChoiceContext(
					node.operator,
					isForkingByTrueOrFalse(node),
				);
			}
			break;

		case "AssignmentExpression":
			if (isLogicalAssignmentOperator(node.operator)) {
				state.pushChoiceContext(
					/*
					 * ESCAPE HATCH: the guard above establishes one of the
					 * three logical assignment operators, but `String#slice`
					 * returns a bare `string`, so the choice kind has to be
					 * restated.
					 */
					/** @type {ChoiceKind} */ (node.operator.slice(0, -1)), // removes `=` from the end
					isForkingByTrueOrFalse(node),
				);
			}
			break;

		case "ConditionalExpression":
		case "IfStatement":
			state.pushChoiceContext("test", false);
			break;

		case "SwitchStatement":
			state.pushSwitchContext(
				node.cases.some(isCaseNode),
				getLabel(node),
			);
			break;

		case "TryStatement":
			state.pushTryContext(Boolean(node.finalizer));
			break;

		case "SwitchCase":
			/*
			 * Fork if this node is after the 1st node in `cases`.
			 * It's similar to `else` blocks.
			 * The next `test` node is processed in this path.
			 */
			if (parent.discriminant !== node && parent.cases[0] !== node) {
				state.forkPath();
			}
			break;

		case "WhileStatement":
		case "DoWhileStatement":
		case "ForStatement":
		case "ForInStatement":
		case "ForOfStatement":
			state.pushLoopContext(
				/*
				 * ESCAPE HATCH, interim view: the five `case` labels above have
				 * established which loop statement this is, but `Node["type"]`
				 * is a bare `string` until the closed node union lands, so no
				 * `case` arm narrows it. Retire the cast with the rest of the
				 * interim view.
				 */
				/** @type {LoopContextType} */ (node.type),
				getLabel(node),
			);
			break;

		case "LabeledStatement":
			if (!breakableTypePattern.test(node.body.type)) {
				/*
				 * ESCAPE HATCH, interim view: `label` is declared nullable
				 * because `break`/`continue` really can omit it; a
				 * `LabeledStatement` always has one.
				 */
				state.pushBreakContext(
					false,
					/** @type {Node} */ (node.label).name,
				);
			}
			break;

		default:
			break;
	}

	// Emits onCodePathSegmentStart events if updated.
	forwardCurrentToHead(analyzer, node);
	debug.dumpState(node, state, false);
}

/**
 * Updates the code path due to the type of a given node in leaving.
 * @param {CodePathAnalyzer} analyzer The instance.
 * @param {Node} node The current AST node.
 * @returns {void}
 */
function processCodePathToExit(analyzer, node) {
	// ESCAPE HATCH: see `forwardCurrentToHead`.
	const codePath = /** @type {CodePath} */ (analyzer.codePath);
	const state = CodePath.getState(codePath);
	let dontForward = false;

	switch (node.type) {
		case "ChainExpression":
			state.popChainContext();
			break;

		case "IfStatement":
		case "ConditionalExpression":
			state.popChoiceContext();
			break;

		case "LogicalExpression":
			if (isHandledLogicalOperator(node.operator)) {
				state.popChoiceContext();
			}
			break;

		case "AssignmentExpression":
			if (isLogicalAssignmentOperator(node.operator)) {
				state.popChoiceContext();
			}
			break;

		case "SwitchStatement":
			state.popSwitchContext();
			break;

		case "SwitchCase":
			/*
			 * This is the same as the process at the 1st `consequent` node in
			 * `preprocess` function.
			 * Must do if this `consequent` is empty.
			 */
			// ESCAPE HATCH, interim view: see `preprocess`'s `SwitchCase` arm.
			if (
				/** @type {Node[]} */ (/** @type {unknown} */ (node.consequent))
					.length === 0
			) {
				state.makeSwitchCaseBody(true, !node.test);
			}
			if (state.forkContext.reachable) {
				dontForward = true;
			}
			break;

		case "TryStatement":
			state.popTryContext();
			break;

		case "BreakStatement":
			forwardCurrentToHead(analyzer, node);
			state.makeBreak(node.label && node.label.name);
			dontForward = true;
			break;

		case "ContinueStatement":
			forwardCurrentToHead(analyzer, node);
			state.makeContinue(node.label && node.label.name);
			dontForward = true;
			break;

		case "ReturnStatement":
			forwardCurrentToHead(analyzer, node);
			state.makeReturn();
			dontForward = true;
			break;

		case "ThrowStatement":
			forwardCurrentToHead(analyzer, node);
			state.makeThrow();
			dontForward = true;
			break;

		case "Identifier":
			if (isIdentifierReference(node)) {
				state.makeFirstThrowablePathInTryOrCatchBlock();
				dontForward = true;
			}
			break;

		case "CallExpression":
		case "ImportExpression":
		case "MemberExpression":
		case "NewExpression":
			state.makeFirstThrowablePathInTryOrCatchBlock();
			break;

		case "YieldExpression":
			state.makeYield();
			break;

		case "WhileStatement":
		case "DoWhileStatement":
		case "ForStatement":
		case "ForInStatement":
		case "ForOfStatement":
			state.popLoopContext();
			break;

		case "AssignmentPattern":
			state.popForkContext();
			break;

		case "LabeledStatement":
			if (!breakableTypePattern.test(node.body.type)) {
				state.popBreakContext();
			}
			break;

		default:
			break;
	}

	// Emits onCodePathSegmentStart events if updated.
	if (!dontForward) {
		forwardCurrentToHead(analyzer, node);
	}
	debug.dumpState(node, state, true);
}

/**
 * Updates the code path to finalize the current code path.
 * @param {CodePathAnalyzer} analyzer The instance.
 * @param {Node} node The current AST node.
 * @returns {void}
 */
function postprocess(analyzer, node) {
	/**
	 * Ends the code path for the current node.
	 * @returns {void}
	 */
	function endCodePath() {
		/**
		 * ESCAPE HATCH: see `forwardCurrentToHead`. Nullable here because the
		 * walk up to `upper` at the end of this function reaches `null` on the
		 * outermost path, which the `if` below is testing for.
		 * @type {CodePath | null}
		 */
		let codePath = /** @type {CodePath} */ (analyzer.codePath);

		// Mark the current path as the final node.
		CodePath.getState(codePath).makeFinal();

		// Emits onCodePathSegmentEnd event of the current segments.
		leaveFromCurrentSegment(analyzer, node);

		// Emits onCodePathEnd event of this code path.
		debug.dump(`onCodePathEnd ${codePath.id}`);
		analyzer.emit("onCodePathEnd", [codePath, node]);
		debug.dumpDot(codePath);

		// ESCAPE HATCH: see `forwardCurrentToHead`.
		codePath = analyzer.codePath = /** @type {CodePath} */ (
			analyzer.codePath
		).upper;
		if (codePath) {
			debug.dumpState(node, CodePath.getState(codePath), true);
		}
	}

	switch (node.type) {
		case "Program":
		case "FunctionDeclaration":
		case "FunctionExpression":
		case "ArrowFunctionExpression":
		case "StaticBlock": {
			endCodePath();
			break;
		}

		// The `arguments.length >= 1` case is in `preprocess` function.
		case "CallExpression":
			if (node.optional === true && node.arguments.length === 0) {
				// ESCAPE HATCH: see `forwardCurrentToHead`.
				CodePath.getState(
					/** @type {CodePath} */ (analyzer.codePath),
				).makeOptionalRight();
			}
			break;

		default:
			break;
	}

	/*
	 * Special case: The right side of class field initializer is considered
	 * to be its own function, so we need to end a code path in this
	 * case.
	 *
	 * We need to check after the other checks in order to close the
	 * code paths in the correct order for code like this:
	 *
	 *
	 * class Foo {
	 *     a = () => {}
	 * }
	 *
	 * In this case, the ArrowFunctionExpression code path is closed first,
	 * and then we need to close the code path for the PropertyDefinition
	 * value.
	 */
	if (isPropertyDefinitionValue(node)) {
		endCodePath();
	}
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The class to analyze code paths.
 * This class implements the EventGenerator interface.
 *
 * The wrapped generator is typed structurally (`EventGenerator` above) rather
 * than as the `SourceCodeVisitor` class that actually supplies it. Naming that
 * class would put a type edge from this subtree into `lib/languages/`, and this
 * subtree depending on nothing but `lib/shared` is what makes it safe for
 * `lib/languages/js/source-code/source-code.js` to reach down into it.
 */
class CodePathAnalyzer {
	/**
	 * @param {EventGenerator} eventGenerator An event generator to wrap.
	 */
	constructor(eventGenerator) {
		this.original = eventGenerator;
		this.emit = eventGenerator.emit;

		/**
		 * The code path currently being analyzed. `null` before the `Program`
		 * node opens the first one and after the last one has been closed.
		 * @type {CodePath | null}
		 */
		this.codePath = null;

		this.idGenerator = new IdGenerator("s");

		/**
		 * The node being entered or left, or `null` between visits.
		 * @type {Node | null}
		 */
		this.currentNode = null;

		this.onLooped = this.onLooped.bind(this);
	}

	/**
	 * Does the process to enter a given AST node.
	 * This updates state of analysis and calls `enterNode` of the wrapped.
	 * @param {Node} node A node which is entering.
	 * @returns {void}
	 */
	enterNode(node) {
		this.currentNode = node;

		// Updates the code path due to node's position in its parent node.
		if (node.parent) {
			preprocess(this, node);
		}

		/*
		 * Updates the code path.
		 * And emits onCodePathStart/onCodePathSegmentStart events.
		 */
		processCodePathToEnter(this, node);

		// Emits node events.
		this.original.enterNode(node);

		this.currentNode = null;
	}

	/**
	 * Does the process to leave a given AST node.
	 * This updates state of analysis and calls `leaveNode` of the wrapped.
	 * @param {Node} node A node which is leaving.
	 * @returns {void}
	 */
	leaveNode(node) {
		this.currentNode = node;

		/*
		 * Updates the code path.
		 * And emits onCodePathStart/onCodePathSegmentStart events.
		 */
		processCodePathToExit(this, node);

		// Emits node events.
		this.original.leaveNode(node);

		// Emits the last onCodePathStart/onCodePathSegmentStart events.
		postprocess(this, node);

		this.currentNode = null;
	}

	/**
	 * This is called on a code path looped.
	 * Then this raises a looped event.
	 * @param {CodePathSegment} fromSegment A segment of prev.
	 * @param {CodePathSegment} toSegment A segment of next.
	 * @returns {void}
	 */
	onLooped(fromSegment, toSegment) {
		if (fromSegment.reachable && toSegment.reachable) {
			debug.dump(
				`onCodePathSegmentLoop ${fromSegment.id} -> ${toSegment.id}`,
			);
			this.emit("onCodePathSegmentLoop", [
				fromSegment,
				toSegment,
				this.currentNode,
			]);
		}
	}
}

module.exports = CodePathAnalyzer;

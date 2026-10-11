/**
 * @fileoverview Type-level tests for the `lib/linter/code-path-analysis/`
 * annotations.
 *
 * The code path analyzer is a state machine whose invariants live in the order
 * the traversal visits nodes, not in its types, so a good share of its
 * annotations are asserted casts. These tests pin the parts that are not: the
 * public shapes rules and `SourceCode` depend on, and the handful of places
 * where a contract was deliberately left narrow or deliberately widened. Each
 * one type-checks a probe module through the real `tsconfig.json`, so it fails
 * if a later change loosens a shape.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert;

const {
	formatDiagnostics,
	typeCheckProbe,
} = require("../../../_utils/type-probe");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/*
 * The probe sits inside `lib/linter/code-path-analysis/`, so it reaches the
 * modules under test through the same relative paths they use on each other.
 * It never touches the source tree: `typeCheckProbe()` serves it from memory.
 */
const PROBE_PATH = "lib/linter/code-path-analysis/__type-probe__.js";

/**
 * Type-checks a probe module as if it sat in `lib/linter/code-path-analysis/`.
 * @param {string[]} lines The probe's lines, joined with newlines.
 * @returns {readonly import("typescript").Diagnostic[]} The probe's diagnostics.
 */
function checkProbe(lines) {
	return typeCheckProbe(['"use strict";', ...lines].join("\n"), PROBE_PATH);
}

/**
 * Asserts that a probe type-checks cleanly.
 * @param {string[]} lines The probe's lines.
 * @param {string} message The assertion message.
 * @returns {void}
 */
function assertAccepts(lines, message) {
	const diagnostics = checkProbe(lines);

	assert.strictEqual(
		diagnostics.length,
		0,
		`${message}:\n${formatDiagnostics(diagnostics)}`,
	);
}

/**
 * Asserts that a probe is rejected, and for a reason of its own.
 *
 * A probe that declares a stand-in with `let` rather than `declared()` is
 * rejected for being read before assignment, which would make any negative
 * assertion pass without testing anything.
 * @param {string[]} lines The probe's lines.
 * @param {string} message The assertion message.
 * @returns {void}
 */
function assertRejects(lines, message) {
	const diagnostics = checkProbe(lines);

	assert.isNotEmpty(diagnostics, message);
	assert.notInclude(
		diagnostics.map(diagnostic => diagnostic.code),
		2454,
		`${message}, not for an unassigned stand-in:\n${formatDiagnostics(diagnostics)}`,
	);
}

/*
 * Every probe needs values to work on, and building a real code path means
 * running the analyzer over a parsed program. This stands in for one: it is
 * only ever type-checked, never run.
 */
const DECLARE_STAND_IN = [
	"/**",
	" * Stands in for a value the probe never evaluates.",
	" * @returns {any} Nothing; a type-level probe is not run.",
	" */",
	"function declared() {",
	'	throw new Error("type-level only");',
	"}",
];

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("code path analysis types", () => {
	describe("CodePathAnalyzer", () => {
		it("should satisfy the traversal analyzer shape it is substituted into", () => {
			/*
			 * `SourceCode#traverse()` builds a step collector, wraps it in a
			 * `CodePathAnalyzer` and then keeps calling it through the same
			 * binding, so the analyzer has to satisfy the shape it consumes.
			 * If it stops doing so, this fails here rather than inside
			 * `lib/languages/`.
			 */
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'const CodePathAnalyzer = require("./code-path-analyzer.js");',
					"",
					'/** @type {import("../../languages/js/source-code/source-code.js").TraversalAnalyzer} */',
					"let analyzer = declared();",
					"",
					"analyzer = new CodePathAnalyzer(analyzer);",
				],
				"a CodePathAnalyzer should be usable wherever the generator it wraps is",
			);
		});

		it("should reject an event generator that cannot emit code path events", () => {
			assertRejects(
				[
					'const CodePathAnalyzer = require("./code-path-analyzer.js");',
					"",
					"new CodePathAnalyzer({",
					"	enterNode() {},",
					"	leaveNode() {},",
					"});",
				],
				"an event generator without `emit` should be rejected",
			);
		});
	});

	describe("CodePath", () => {
		it("should accept a bare traversal callback", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"codePath.traverseSegments((segment, controller) => {",
					"	if (segment.reachable) {",
					"		controller.skip();",
					"	} else {",
					"		controller.break();",
					"	}",
					"});",
				],
				"the single-argument form should type the segment and the controller",
			);
		});

		it("should accept first and last segments alongside a callback", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"codePath.traverseSegments(",
					"	{ first: codePath.initialSegment, last: codePath.finalSegments[0] },",
					"	segment => {",
					"		String(segment.id);",
					"	},",
					");",
				],
				"the two-argument form should accept segments for `first` and `last`",
			);
		});

		it("should reject a misspelled traversal option", () => {
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"codePath.traverseSegments(",
					"	{ fist: codePath.initialSegment },",
					"	() => {},",
					");",
				],
				"an unknown option key should be rejected",
			);
		});

		it("should reject a controller method the traversal does not offer", () => {
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"codePath.traverseSegments((segment, controller) => {",
					"	controller.stop();",
					"});",
				],
				"only `skip()` and `break()` should be reachable on the controller",
			);
		});

		it("should close the set of code path origins", () => {
			/*
			 * Rules branch on `codePath.origin`, so the union is part of the
			 * contract rather than a convenience.
			 */
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					'/** @type {"module"} */',
					"const origin = codePath.origin;",
				],
				'"module" should not be one of the origins',
			);
		});

		it("should keep the state off the public shape, behind getState()", () => {
			/*
			 * The state is installed with `Object.defineProperty()` precisely
			 * so that it does not show up as a property; `CodePath.getState()`
			 * is the supported way in, and the view cast behind it must not
			 * leak into the class.
			 */
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"codePath.internal.makeFinal();",
				],
				"`internal` should not be reachable as a property of the code path",
			);
		});

		it("should hand back the state from getState()", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'const CodePath = require("./code-path.js");',
					"",
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"CodePath.getState(codePath).makeFinal();",
				],
				"getState() should expose the state's methods",
			);
		});

		it("should expose the final segment lists as plain arrays", () => {
			/*
			 * `CodePathState` bolts an `add()` method onto its two final
			 * segment lists so they can stand in for a fork context. That is
			 * internal plumbing: a rule reading `returnedSegments` should see
			 * an array it cannot push paths into.
			 */
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"codePath.returnedSegments.add([]);",
					"codePath.thrownSegments.add([]);",
				],
				"`add()` should not be part of the public segment lists",
			);
		});
	});

	describe("CodePathSegment", () => {
		it("should keep the internal slot off the public shape", () => {
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path-segment.js")} */',
					"const segment = declared();",
					"",
					"String(segment.internal.used);",
				],
				"`internal` should not be reachable as a property of a segment",
			);
		});

		it("should expose the segment graph as segment arrays", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path-segment.js")} */',
					"const segment = declared();",
					"",
					"for (const prev of segment.allPrevSegments) {",
					"	if (segment.isLoopedPrevSegment(prev)) {",
					"		String(prev.id);",
					"	}",
					"}",
				],
				"the neighbour lists should be typed as segments",
			);
		});

		it("should reject a non-segment as a previous segment", () => {
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path-segment.js")} */',
					"const segment = declared();",
					"",
					'segment.isLoopedPrevSegment("s1");',
				],
				"a segment id should not stand in for a segment",
			);
		});
	});

	describe("ForkContext", () => {
		it("should accept makeUnreachable() with no indexes, as popTryContext() calls it", () => {
			/*
			 * `CodePathState#popTryContext()` relies on the no-argument form:
			 * it leaves the new segments with no previous segments at all,
			 * which is what makes them unreachable. Only this factory is
			 * declared that way.
			 */
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./fork-context.js")} */',
					"const forkContext = declared();",
					"",
					"forkContext.makeUnreachable();",
				],
				"makeUnreachable() should take no arguments",
			);
		});

		it("should still require indexes for makeNext()", () => {
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./fork-context.js")} */',
					"const forkContext = declared();",
					"",
					"forkContext.makeNext();",
				],
				"makeNext() should not inherit makeUnreachable()'s loosened signature",
			);
		});

		it("should accept newEmpty() without the finally flag", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'const ForkContext = require("./fork-context.js");',
					"",
					'/** @type {import("./fork-context.js")} */',
					"const forkContext = declared();",
					"",
					"ForkContext.newEmpty(forkContext);",
					"ForkContext.newEmpty(forkContext, true);",
				],
				"the `shouldForkLeavingPath` argument should be optional",
			);
		});

		it("should hand back a segment array from the head, with no null case", () => {
			/*
			 * `head` returns an empty array rather than `null` when the
			 * context has no segments yet, and the whole state machine reads
			 * it without a guard.
			 */
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./fork-context.js")} */',
					"const forkContext = declared();",
					"",
					"String(forkContext.head.length);",
				],
				"`head` should never be nullable",
			);
		});
	});

	describe("CodePathState", () => {
		it("should accept a raw node type for pushLoopContext()", () => {
			/*
			 * The analyzer passes `node.type` straight through, and the
			 * method's own `default` branch is what rejects anything that is
			 * not a loop. Narrowing the parameter to the five loop types would
			 * make that branch unreachable at the one call site there is.
			 */
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path-state.js")} */',
					"const state = declared();",
					"",
					"/** @type {string} */",
					'const nodeType = "WhileStatement";',
					"",
					"state.pushLoopContext(nodeType, null);",
				],
				"pushLoopContext() should accept the node's raw `type`",
			);
		});

		it("should accept a constant-test argument or none at all", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path-state.js")} */',
					"const state = declared();",
					"",
					"state.makeWhileTest(true);",
					"state.makeWhileTest();",
					"state.makeForTest(false);",
					"state.makeForTest();",
				],
				"the `test` argument should be optional, as a non-literal test leaves it undefined",
			);
		});

		it("should reject a non-boolean constant test", () => {
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'/** @type {import("./code-path-state.js")} */',
					"const state = declared();",
					"",
					'state.makeWhileTest("true");',
				],
				"only a boolean should stand for a hardcoded loop condition",
			);
		});
	});

	describe("debug helpers", () => {
		it("should type dumpState() by its dumping signature, not by the debug logger", () => {
			/*
			 * `dumpState` is a conditional between `debug` and the dumping
			 * function, so without the `@type` tag its arguments would check
			 * against a logger that accepts anything. Dropping the tag makes
			 * this probe pass and the next one pass too.
			 */
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'const debug = require("./debug-helpers.js");',
					"",
					'/** @type {import("./code-path-state.js")} */',
					"const state = declared();",
					"",
					'debug.dumpState({ type: "Identifier" }, state, false);',
				],
				"dumpState() should accept a node, a state and the leaving flag",
			);
		});

		it("should reject a dumpState() call that is missing the leaving flag", () => {
			assertRejects(
				[
					...DECLARE_STAND_IN,
					'const debug = require("./debug-helpers.js");',
					"",
					'/** @type {import("./code-path-state.js")} */',
					"const state = declared();",
					"",
					'debug.dumpState({ type: "Identifier" }, state);',
				],
				"dumpState() should not fall back to the logger's variadic signature",
			);
		});

		it("should hand back DOT source as a string from makeDotArrows()", () => {
			assertAccepts(
				[
					...DECLARE_STAND_IN,
					'const debug = require("./debug-helpers.js");',
					"",
					'/** @type {import("./code-path.js")} */',
					"const codePath = declared();",
					"",
					"String(debug.makeDotArrows(codePath).length);",
				],
				"makeDotArrows() should return a string and take an optional trace map",
			);
		});
	});

	describe("IdGenerator", () => {
		it("should generate string ids", () => {
			assertAccepts(
				[
					'const IdGenerator = require("./id-generator.js");',
					"",
					'const generator = new IdGenerator("s");',
					"",
					"String(generator.next().length);",
				],
				"next() should return a string",
			);
		});
	});
});

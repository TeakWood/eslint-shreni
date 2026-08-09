// @ts-check
/**
 * @fileoverview A class of the code path.
 * @author Toru Nagashima
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const CodePathState = require("./code-path-state");
const IdGenerator = require("./id-generator");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/**
 * @typedef {InstanceType<typeof import("./code-path-segment.js")>} CodePathSegment
 */

/**
 * The reason a code path was started.
 *
 * These are the four values `code-path-analyzer.js` passes to the constructor.
 * @typedef {"program" | "function" | "class-field-initializer" | "class-static-block"} CodePathOrigin
 */

/**
 * Notifies that a segment has looped back to an earlier one.
 * @typedef {(fromSegment: CodePathSegment, toSegment: CodePathSegment) => void} LoopedCallback
 */

/**
 * Bounds for `traverseSegments`.
 * @typedef {Object} TraverseSegmentsOptions
 * @property {CodePathSegment} [first] The first segment to traverse.
 * @property {CodePathSegment} [last] The last segment to traverse.
 */

/**
 * Controls a `traverseSegments` walk from inside the callback.
 * @typedef {Object} TraverseSegmentsController
 * @property {() => void} skip Skips the following segments in this branch.
 * @property {() => void} break Skips all following segments in the traversal.
 */

/**
 * The callback `traverseSegments` invokes for each visited segment.
 * @typedef {(this: CodePath, segment: CodePathSegment, controller: TraverseSegmentsController) => void} TraverseSegmentsCallback
 */

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * A code path.
 */
class CodePath {
	/**
	 * Creates a new instance.
	 * @param {Object} options Options for the function (see below).
	 * @param {string} options.id An identifier.
	 * @param {CodePathOrigin} options.origin The type of code path origin.
	 * @param {CodePath | null} options.upper The code path of the upper function scope.
	 * @param {LoopedCallback} options.onLooped A callback function to notify looping.
	 */
	constructor({ id, origin, upper, onLooped }) {
		/**
		 * The identifier of this code path.
		 * Rules use it to store additional information of each rule.
		 */
		this.id = id;

		/**
		 * The reason that this code path was started. May be "program",
		 * "function", "class-field-initializer", or "class-static-block".
		 */
		this.origin = origin;

		/**
		 * The code path of the upper function scope.
		 */
		this.upper = upper;

		/**
		 * The code paths of nested function scopes.
		 * @type {CodePath[]}
		 */
		this.childCodePaths = [];

		/**
		 * The state of this code path.
		 *
		 * Declaration only — the `Object.defineProperty` call below is what
		 * installs it, and TypeScript does not read `defineProperty` on `this`
		 * as a property declaration. The slot is deliberately non-enumerable,
		 * so there is no assignment for inference to work from either. Writing
		 * it as a plain assignment and re-describing it afterwards would change
		 * the descriptor (`writable` and `configurable` would both stay true),
		 * so the declaration is kept separate from the installation.
		 * @type {CodePathState}
		 */
		// eslint-disable-next-line no-unused-expressions -- Declares the type of the hidden slot installed just below; evaluates to `undefined` and does nothing.
		this.internal;

		// Initializes internal state.
		Object.defineProperty(this, "internal", {
			value: new CodePathState(new IdGenerator(`${id}_`), onLooped),
		});

		// Adds this into `childCodePaths` of `upper`.
		if (upper) {
			upper.childCodePaths.push(this);
		}
	}

	/**
	 * Gets the state of a given code path.
	 * @param {CodePath} codePath A code path to get.
	 * @returns {CodePathState} The state of the code path.
	 */
	static getState(codePath) {
		return codePath.internal;
	}

	/**
	 * The initial code path segment. This is the segment that is at the head
	 * of the code path.
	 * This is a passthrough to the underlying `CodePathState`.
	 * @returns {CodePathSegment} The initial segment.
	 */
	get initialSegment() {
		return this.internal.initialSegment;
	}

	/**
	 * Final code path segments. These are the terminal (tail) segments in the
	 * code path, which is the combination of `returnedSegments` and `thrownSegments`.
	 * All segments in this array are reachable.
	 * This is a passthrough to the underlying `CodePathState`.
	 * @returns {CodePathSegment[]} The final segments.
	 */
	get finalSegments() {
		return this.internal.finalSegments;
	}

	/**
	 * Final code path segments that represent normal completion of the code path.
	 * For functions, this means both explicit `return` statements and implicit returns,
	 * such as the last reachable segment in a function that does not have an
	 * explicit `return` as this implicitly returns `undefined`, as well as
	 * return-like exits from suspended `yield` expressions. For scripts, modules,
	 * class field initializers, and class static blocks, this means all lines of
	 * code have been executed.
	 * These segments are also present in `finalSegments`.
	 * This is a passthrough to the underlying `CodePathState`.
	 * @returns {CodePathSegment[]} The returned segments.
	 */
	get returnedSegments() {
		return this.internal.returnedForkContext;
	}

	/**
	 * Final code path segments that represent `throw` statements and throw-like
	 * exits from suspended `yield` expressions.
	 * This is a passthrough to the underlying `CodePathState`.
	 * These segments are also present in `finalSegments`.
	 * @returns {CodePathSegment[]} The thrown segments.
	 */
	get thrownSegments() {
		return this.internal.thrownForkContext;
	}

	/**
	 * Traverses all segments in this code path.
	 *
	 *     codePath.traverseSegments((segment, controller) => {
	 *         // do something.
	 *     });
	 *
	 * This method enumerates segments in order from the head.
	 *
	 * The `controller` argument has two methods:
	 *
	 * - `skip()` - skips the following segments in this branch
	 * - `break()` - skips all following segments in the traversal
	 *
	 * A note on the parameters: the `options` argument is optional. This means
	 * the first argument might be an options object or the callback function.
	 * @param {TraverseSegmentsOptions | TraverseSegmentsCallback} [optionsOrCallback] Optional first and last segments to traverse.
	 * @param {TraverseSegmentsCallback} [callback] A callback function.
	 * @returns {void}
	 */
	traverseSegments(optionsOrCallback, callback) {
		// normalize the arguments into a callback and options
		/** @type {TraverseSegmentsOptions} */
		let resolvedOptions;

		/** @type {TraverseSegmentsCallback} */
		let resolvedCallback;

		if (typeof optionsOrCallback === "function") {
			resolvedCallback = optionsOrCallback;
			resolvedOptions = {};
		} else {
			resolvedOptions = optionsOrCallback || {};

			/*
			 * ESCAPE HATCH: the overload this method really has — options plus
			 * a callback, or a callback alone — is not expressible on a single
			 * JSDoc signature, so `callback` has to be declared optional even
			 * though it is required on the branch that reaches here.
			 */
			resolvedCallback = /** @type {TraverseSegmentsCallback} */ (
				callback
			);
		}

		// determine where to start traversing from based on the options
		const startSegment =
			resolvedOptions.first || this.internal.initialSegment;
		const lastSegment = resolvedOptions.last;

		// set up initial location information
		/** @type {[CodePathSegment, number]} */
		let record;
		let index;
		let end;

		/**
		 * The segment being visited. `null` only before the walk starts.
		 * @type {CodePathSegment | null}
		 */
		let segment = null;

		// segments that have already been visited during traversal
		/** @type {Set<CodePathSegment>} */
		const visited = new Set();

		// tracks the traversal steps
		/** @type {[CodePathSegment, number][]} */
		const stack = [[startSegment, 0]];

		// segments that have been skipped during traversal
		/** @type {Set<CodePathSegment>} */
		const skipped = new Set();

		// indicates if we exited early from the traversal
		let broken = false;

		/**
		 * Maintains traversal state.
		 */
		const controller = {
			/**
			 * Skip the following segments in this branch.
			 */
			skip() {
				// ESCAPE HATCH: see the note above `isVisited`.
				skipped.add(/** @type {CodePathSegment} */ (segment));
			},

			/**
			 * Stop traversal completely - do not traverse to any
			 * other segments.
			 */
			break() {
				broken = true;
			},
		};

		/*
		 * ESCAPE HATCH, used by both predicates below: `segment` is captured
		 * from the enclosing scope, and a closure does not carry the narrowing
		 * the loop body has. Both are only ever passed to `Array#every` from
		 * inside the loop, where `segment` has already been read off the stack.
		 */

		/**
		 * Checks if a given previous segment has been visited.
		 * @param {CodePathSegment} prevSegment A previous segment to check.
		 * @returns {boolean} `true` if the segment has been visited.
		 */
		function isVisited(prevSegment) {
			return (
				visited.has(prevSegment) ||
				/** @type {CodePathSegment} */ (segment).isLoopedPrevSegment(
					prevSegment,
				)
			);
		}

		/**
		 * Checks if a given previous segment has been skipped.
		 * @param {CodePathSegment} prevSegment A previous segment to check.
		 * @returns {boolean} `true` if the segment has been skipped.
		 */
		function isSkipped(prevSegment) {
			return (
				skipped.has(prevSegment) ||
				/** @type {CodePathSegment} */ (segment).isLoopedPrevSegment(
					prevSegment,
				)
			);
		}

		// the traversal
		while (stack.length > 0) {
			/*
			 * This isn't a pure stack. We use the top record all the time
			 * but don't always pop it off. The record is popped only if
			 * one of the following is true:
			 *
			 * 1) We have already visited the segment.
			 * 2) We have not visited *all* of the previous segments.
			 * 3) We have traversed past the available next segments.
			 *
			 * Otherwise, we just read the value and sometimes modify the
			 * record as we traverse.
			 */
			// The loop condition is what makes the `at(-1)` read safe.
			record = /** @type {[CodePathSegment, number]} */ (stack.at(-1));
			segment = record[0];
			index = record[1];

			if (index === 0) {
				// Skip if this segment has been visited already.
				if (visited.has(segment)) {
					stack.pop();
					continue;
				}

				// Skip if all previous segments have not been visited.
				if (
					segment !== startSegment &&
					segment.prevSegments.length > 0 &&
					!segment.prevSegments.every(isVisited)
				) {
					stack.pop();
					continue;
				}

				visited.add(segment);

				// Skips the segment if all previous segments have been skipped.
				const shouldSkip =
					skipped.size > 0 &&
					segment.prevSegments.length > 0 &&
					segment.prevSegments.every(isSkipped);

				/*
				 * If the most recent segment hasn't been skipped, then we call
				 * the callback, passing in the segment and the controller.
				 */
				if (!shouldSkip) {
					resolvedCallback.call(this, segment, controller);

					// exit if we're at the last segment
					if (segment === lastSegment) {
						controller.skip();
					}

					/*
					 * If the previous statement was executed, or if the callback
					 * called a method on the controller, we might need to exit the
					 * loop, so check for that and break accordingly.
					 */
					if (broken) {
						break;
					}
				} else {
					// If the most recent segment has been skipped, then mark it as skipped.
					skipped.add(segment);
				}
			}

			// Update the stack.
			end = segment.nextSegments.length - 1;
			if (index < end) {
				/*
				 * If we haven't yet visited all of the next segments, update
				 * the current top record on the stack to the next index to visit
				 * and then push a record for the current segment on top.
				 *
				 * Setting the current top record's index lets us know how many
				 * times we've been here and ensures that the segment won't be
				 * reprocessed (because we only process segments with an index
				 * of 0).
				 */
				record[1] += 1;
				stack.push([segment.nextSegments[index], 0]);
			} else if (index === end) {
				/*
				 * If we are at the last next segment, then reset the top record
				 * in the stack to next segment and set its index to 0 so it will
				 * be processed next.
				 */
				record[0] = segment.nextSegments[index];
				record[1] = 0;
			} else {
				/*
				 * If index > end, that means we have no more segments that need
				 * processing. So, we pop that record off of the stack in order to
				 * continue traversing at the next level up.
				 */
				stack.pop();
			}
		}
	}
}

module.exports = CodePath;

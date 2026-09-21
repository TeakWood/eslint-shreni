/**
 * @fileoverview A class of the code path.
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const CodePathState = require("./code-path-state");
const IdGenerator = require("./id-generator");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("./code-path-segment.js")} CodePathSegment */
/** @typedef {import("./code-path-state.js").FinalSegments} FinalSegments */
/** @typedef {import("./code-path-state.js").LoopedCallback} LoopedCallback */

/**
 * The reason a code path was started.
 * @typedef {"program" | "function" | "class-field-initializer" | "class-static-block"} CodePathOrigin
 */

/**
 * The object handed to a `traverseSegments()` callback to steer the traversal.
 * @typedef {Object} TraverseController
 * @property {() => void} skip Skips the following segments in this branch.
 * @property {() => void} break Skips all following segments in the traversal.
 */

/**
 * A callback invoked once per visited segment.
 * @typedef {(this: CodePath, segment: CodePathSegment, controller: TraverseController) => void} TraverseCallback
 */

/**
 * The bounds of a `traverseSegments()` traversal.
 * @typedef {Object} TraverseOptions
 * @property {CodePathSegment} [first] The first segment to traverse.
 * @property {CodePathSegment} [last] The last segment to traverse.
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
		 * @type {string}
		 */
		this.id = id;

		/**
		 * The reason that this code path was started. May be "program",
		 * "function", "class-field-initializer", or "class-static-block".
		 * @type {CodePathOrigin}
		 */
		this.origin = origin;

		/**
		 * The code path of the upper function scope.
		 * @type {CodePath | null}
		 */
		this.upper = upper;

		/**
		 * The code paths of nested function scopes.
		 * @type {Array<CodePath>}
		 */
		this.childCodePaths = [];

		/*
		 * `Object.defineProperty()` below is invisible to TypeScript, so the
		 * property is declared with this annotated no-op read. Declaring it as
		 * a class field instead would create an enumerable, writable own
		 * property and change how a code path serializes.
		 */
		/**
		 * The state backing this code path.
		 * @type {CodePathState}
		 */
		// eslint-disable-next-line no-unused-expressions -- Type declaration only; see above.
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
	 * @returns {Array<CodePathSegment>} The final segments.
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
	 * @returns {FinalSegments} The returned segments.
	 */
	get returnedSegments() {
		return this.internal.returnedForkContext;
	}

	/**
	 * Final code path segments that represent `throw` statements and throw-like
	 * exits from suspended `yield` expressions.
	 * This is a passthrough to the underlying `CodePathState`.
	 * These segments are also present in `finalSegments`.
	 * @returns {FinalSegments} The thrown segments.
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
	 * @param {TraverseOptions | TraverseCallback} [optionsOrCallback] Optional first and last segments to traverse.
	 * @param {TraverseCallback} [callback] A callback function.
	 * @returns {void}
	 */
	traverseSegments(optionsOrCallback, callback) {
		// normalize the arguments into a callback and options
		/** @type {TraverseOptions} */
		let resolvedOptions;

		/** @type {TraverseCallback} */
		let resolvedCallback;

		if (typeof optionsOrCallback === "function") {
			resolvedCallback = optionsOrCallback;
			resolvedOptions = {};
		} else {
			resolvedOptions = optionsOrCallback || {};
			resolvedCallback = /** @type {TraverseCallback} */ (callback);
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

		/** @type {CodePathSegment | null} */
		let segment = null;

		// segments that have already been visited during traversal
		/** @type {Set<CodePathSegment>} */
		const visited = new Set();

		// tracks the traversal steps
		/** @type {Array<[CodePathSegment, number]>} */
		const stack = [[startSegment, 0]];

		// segments that have been skipped during traversal
		/** @type {Set<CodePathSegment>} */
		const skipped = new Set();

		// indicates if we exited early from the traversal
		let broken = false;

		/**
		 * Maintains traversal state.
		 */
		/** @type {TraverseController} */
		const controller = {
			/**
			 * Skip the following segments in this branch.
			 * @returns {void}
			 */
			skip() {
				skipped.add(/** @type {CodePathSegment} */ (segment));
			},

			/**
			 * Stop traversal completely - do not traverse to any
			 * other segments.
			 * @returns {void}
			 */
			break() {
				broken = true;
			},
		};

		/*
		 * `segment` is `null` only until the traversal loop below assigns it.
		 * The three helpers here — `controller.skip()`, `isVisited()`, and
		 * `isSkipped()` — are reached only from inside that loop, so the value
		 * is always a segment by the time they run.
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
			// The loop condition guarantees the stack is non-empty.
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

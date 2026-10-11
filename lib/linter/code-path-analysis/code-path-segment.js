// @ts-check
/**
 * @fileoverview The CodePathSegment class.
 * @author Toru Nagashima
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const debug = require("./debug-helpers");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/**
 * The bookkeeping each segment carries that is not part of its public shape.
 *
 * It is installed with `Object.defineProperty()` so that it stays off
 * enumeration — rules walk segments and dump them — which also means tsc does
 * not see it as a property of the class. Reads of it therefore go through the
 * `SegmentWithInternal` view below.
 * @typedef {Object} CodePathSegmentInternal
 * @property {boolean} used Indicates the segment has been attached to the code path.
 * @property {CodePathSegment[]} loopedPrevSegments Previous segments coming from the end of a loop.
 * @property {string[]} [nodes] Descriptions of the nodes dumped into this segment. Only present when debug dumping is enabled.
 */

/**
 * A segment viewed with its non-enumerable `internal` slot exposed.
 *
 * `lib/linter/code-path-analysis/debug-helpers.js` uses this too, which is why
 * it is a named typedef rather than an inline cast.
 * @typedef {CodePathSegment & { internal: CodePathSegmentInternal }} SegmentWithInternal
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether or not a given segment is reachable.
 * @param {CodePathSegment} segment A segment to check.
 * @returns {boolean} `true` if the segment is reachable.
 */
function isReachable(segment) {
	return segment.reachable;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * A code path segment.
 *
 * Each segment is arranged in a series of linked lists (implemented by arrays)
 * that keep track of the previous and next segments in a code path. In this way,
 * you can navigate between all segments in any code path so long as you have a
 * reference to any segment in that code path.
 *
 * When first created, the segment is in a detached state, meaning that it knows the
 * segments that came before it but those segments don't know that this new segment
 * follows it. Only when `CodePathSegment#markUsed()` is called on a segment does it
 * officially become part of the code path by updating the previous segments to know
 * that this new segment follows.
 */
class CodePathSegment {
	/**
	 * Creates a new instance.
	 * @param {string} id An identifier.
	 * @param {CodePathSegment[]} allPrevSegments An array of the previous segments.
	 *   This array includes unreachable segments.
	 * @param {boolean} reachable A flag which shows this is reachable.
	 */
	constructor(id, allPrevSegments, reachable) {
		/**
		 * The identifier of this code path.
		 * Rules use it to store additional information of each rule.
		 * @type {string}
		 */
		this.id = id;

		/**
		 * An array of the next reachable segments.
		 * @type {CodePathSegment[]}
		 */
		this.nextSegments = [];

		/**
		 * An array of the previous reachable segments.
		 * @type {CodePathSegment[]}
		 */
		this.prevSegments = allPrevSegments.filter(isReachable);

		/**
		 * An array of all next segments including reachable and unreachable.
		 * @type {CodePathSegment[]}
		 */
		this.allNextSegments = [];

		/**
		 * An array of all previous segments including reachable and unreachable.
		 * @type {CodePathSegment[]}
		 */
		this.allPrevSegments = allPrevSegments;

		/**
		 * A flag which shows this is reachable.
		 * @type {boolean}
		 */
		this.reachable = reachable;

		/** @type {CodePathSegmentInternal} */
		const internal = {
			// determines if the segment has been attached to the code path
			used: false,

			// array of previous segments coming from the end of a loop
			loopedPrevSegments: [],
		};

		// Internal data.
		Object.defineProperty(this, "internal", { value: internal });

		/* c8 ignore start */
		if (debug.enabled) {
			internal.nodes = [];
		} /* c8 ignore stop */
	}

	/**
	 * Checks a given previous segment is coming from the end of a loop.
	 * @param {CodePathSegment} segment A previous segment to check.
	 * @returns {boolean} `true` if the segment is coming from the end of a loop.
	 */
	isLoopedPrevSegment(segment) {
		/*
		 * The view cast needs a plain `CodePathSegment` rather than the
		 * polymorphic `this`, which tsc will not narrow to a subtype.
		 */
		/** @type {CodePathSegment} */
		const self = this;

		return /** @type {SegmentWithInternal} */ (
			self
		).internal.loopedPrevSegments.includes(segment);
	}

	/**
	 * Creates the root segment.
	 * @param {string} id An identifier.
	 * @returns {CodePathSegment} The created segment.
	 */
	static newRoot(id) {
		return new CodePathSegment(id, [], true);
	}

	/**
	 * Creates a new segment and appends it after the given segments.
	 * @param {string} id An identifier.
	 * @param {CodePathSegment[]} allPrevSegments An array of the previous segments
	 *      to append to.
	 * @returns {CodePathSegment} The created segment.
	 */
	static newNext(id, allPrevSegments) {
		return new CodePathSegment(
			id,
			CodePathSegment.flattenUnusedSegments(allPrevSegments),
			allPrevSegments.some(isReachable),
		);
	}

	/**
	 * Creates an unreachable segment and appends it after the given segments.
	 * @param {string} id An identifier.
	 * @param {CodePathSegment[]} allPrevSegments An array of the previous segments.
	 * @returns {CodePathSegment} The created segment.
	 */
	static newUnreachable(id, allPrevSegments) {
		const segment = new CodePathSegment(
			id,
			CodePathSegment.flattenUnusedSegments(allPrevSegments),
			false,
		);

		/*
		 * In `if (a) return a; foo();` case, the unreachable segment preceded by
		 * the return statement is not used but must not be removed.
		 */
		CodePathSegment.markUsed(segment);

		return segment;
	}

	/**
	 * Creates a segment that follows given segments.
	 * This factory method does not connect with `allPrevSegments`.
	 * But this inherits `reachable` flag.
	 * @param {string} id An identifier.
	 * @param {CodePathSegment[]} allPrevSegments An array of the previous segments.
	 * @returns {CodePathSegment} The created segment.
	 */
	static newDisconnected(id, allPrevSegments) {
		return new CodePathSegment(id, [], allPrevSegments.some(isReachable));
	}

	/**
	 * Marks a given segment as used.
	 *
	 * And this function registers the segment into the previous segments as a next.
	 * @param {CodePathSegment} segment A segment to mark.
	 * @returns {void}
	 */
	static markUsed(segment) {
		const internal = /** @type {SegmentWithInternal} */ (segment).internal;

		if (internal.used) {
			return;
		}
		internal.used = true;

		let i;

		if (segment.reachable) {
			/*
			 * If the segment is reachable, then it's officially part of the
			 * code path. This loops through all previous segments to update
			 * their list of next segments. Because the segment is reachable,
			 * it's added to both `nextSegments` and `allNextSegments`.
			 */
			for (i = 0; i < segment.allPrevSegments.length; ++i) {
				const prevSegment = segment.allPrevSegments[i];

				prevSegment.allNextSegments.push(segment);
				prevSegment.nextSegments.push(segment);
			}
		} else {
			/*
			 * If the segment is not reachable, then it's not officially part of the
			 * code path. This loops through all previous segments to update
			 * their list of next segments. Because the segment is not reachable,
			 * it's added only to `allNextSegments`.
			 */
			for (i = 0; i < segment.allPrevSegments.length; ++i) {
				segment.allPrevSegments[i].allNextSegments.push(segment);
			}
		}
	}

	/**
	 * Marks a previous segment as looped.
	 * @param {CodePathSegment} segment A segment.
	 * @param {CodePathSegment} prevSegment A previous segment to mark.
	 * @returns {void}
	 */
	static markPrevSegmentAsLooped(segment, prevSegment) {
		/** @type {SegmentWithInternal} */ (
			segment
		).internal.loopedPrevSegments.push(prevSegment);
	}

	/**
	 * Creates a new array based on an array of segments. If any segment in the
	 * array is unused, then it is replaced by all of its previous segments.
	 * All used segments are returned as-is without replacement.
	 * @param {CodePathSegment[]} segments The array of segments to flatten.
	 * @returns {CodePathSegment[]} The flattened array.
	 */
	static flattenUnusedSegments(segments) {
		/** @type {Set<CodePathSegment>} */
		const done = new Set();

		for (let i = 0; i < segments.length; ++i) {
			const segment = segments[i];

			// Ignores duplicated.
			if (done.has(segment)) {
				continue;
			}

			// Use previous segments if unused.
			if (!(/** @type {SegmentWithInternal} */ (segment).internal.used)) {
				for (let j = 0; j < segment.allPrevSegments.length; ++j) {
					const prevSegment = segment.allPrevSegments[j];

					if (!done.has(prevSegment)) {
						done.add(prevSegment);
					}
				}
			} else {
				done.add(segment);
			}
		}

		return [...done];
	}
}

module.exports = CodePathSegment;

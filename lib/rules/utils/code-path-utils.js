/**
 * @fileoverview Code path related utilities.
 */

// @ts-check

"use strict";

/**
 * A segment of a code path, as produced by the code path analyzer.
 * @typedef {import("../../linter/code-path-analysis/code-path-segment.js")} CodePathSegment
 */

/**
 * Checks all segments in a set and returns true if any are reachable.
 * @param {Iterable<CodePathSegment>} segments The segments to check.
 * @returns {boolean} `true` if any segment is reachable; `false` otherwise.
 */
function isAnySegmentReachable(segments) {
	for (const segment of segments) {
		if (segment.reachable) {
			return true;
		}
	}

	return false;
}

module.exports = { isAnySegmentReachable };

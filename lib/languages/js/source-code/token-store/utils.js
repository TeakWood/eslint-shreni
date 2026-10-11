// @ts-check
/**
 * @fileoverview Define utility functions for token store.
 * @author Toru Nagashima
 */
"use strict";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/*
 * The token store's two shared shapes live in this module because it is the
 * leaf of the store's dependency graph: every cursor and `./index.js` already
 * reach it, so they can all reference these without a new import cycle.
 */

/**
 * A token or comment as the token store handles it.
 *
 * The store only ever reads `range`, and it has to work with whatever tokens a
 * custom parser produced, so the shape stays open rather than being pinned to
 * ESTree's `Token`/`Comment` unions — both of which make `range` optional,
 * which every comparison here would then have to narrow. This is the same
 * reasoning as `TraversableNode` in `lib/shared/traverser.js`.
 * @typedef {{ type: string, range: [number, number], [key: string]: any }} Token
 */

/**
 * The map from a source text location to the index in `tokens` of the token at
 * that location, as built by `createIndexMap()` in `./index.js`.
 * @typedef {{ [location: number]: number }} IndexMap
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Finds the index of the first token which is after the given location.
 * If it was not found, this returns `tokens.length`.
 * @param {Token[]} tokens It searches the token in this list.
 * @param {number} location The location to search.
 * @returns {number} The found index or `tokens.length`.
 */
function search(tokens, location) {
	for (
		let minIndex = 0, maxIndex = tokens.length - 1;
		minIndex <= maxIndex;
	) {
		/*
		 * Calculate the index in the middle between minIndex and maxIndex.
		 * `| 0` is used to round a fractional value down to the nearest integer: this is similar to
		 * using `Math.trunc()` or `Math.floor()`, but performance tests have shown this method to
		 * be faster.
		 */
		const index = ((minIndex + maxIndex) / 2) | 0;
		const token = tokens[index];
		const tokenStartLocation = token.range[0];

		if (location <= tokenStartLocation) {
			if (index === minIndex) {
				return index;
			}
			maxIndex = index;
		} else {
			minIndex = index + 1;
		}
	}
	return tokens.length;
}

/**
 * Gets the index of the `startLoc` in `tokens`.
 * `startLoc` can be the value of `node.range[1]`, so this checks about `startLoc - 1` as well.
 * @param {Token[]} tokens The tokens to find an index.
 * @param {IndexMap} indexMap The map from locations to indices.
 * @param {number} startLoc The location to get an index.
 * @returns {number} The index.
 */
function getFirstIndex(tokens, indexMap, startLoc) {
	if (startLoc === -1) {
		return 0;
	}
	if (startLoc in indexMap) {
		return indexMap[startLoc];
	}
	if (startLoc - 1 in indexMap) {
		const index = indexMap[startLoc - 1];
		const token = tokens[index];

		// If the mapped index is out of bounds, the returned cursor index will point after the end of the tokens array.
		if (!token) {
			return tokens.length;
		}

		/*
		 * For the map of "comment's location -> token's index", it points the next token of a comment.
		 * In that case, +1 is unnecessary.
		 */
		if (token.range[0] >= startLoc) {
			return index;
		}
		return index + 1;
	}

	// Program node that doesn't start/end with a token or comment
	if (startLoc === 0) {
		return 0;
	}
	return tokens.length;
}
/**
 * Gets the index of the `endLoc` in `tokens`.
 * The information of end locations are recorded at `endLoc - 1` in `indexMap`, so this checks about `endLoc - 1` as well.
 * @param {Token[]} tokens The tokens to find an index.
 * @param {IndexMap} indexMap The map from locations to indices.
 * @param {number} endLoc The location to get an index.
 * @returns {number} The index.
 */
function getLastIndex(tokens, indexMap, endLoc) {
	if (endLoc === -1) {
		return tokens.length - 1;
	}
	if (endLoc in indexMap) {
		return indexMap[endLoc] - 1;
	}
	if (endLoc - 1 in indexMap) {
		const index = indexMap[endLoc - 1];
		const token = tokens[index];

		// If the mapped index is out of bounds, the returned cursor index will point before the end of the tokens array.
		if (!token) {
			return tokens.length - 1;
		}

		/*
		 * For the map of "comment's location -> token's index", it points the next token of a comment.
		 * In that case, -1 is necessary.
		 */
		if (token.range[1] > endLoc) {
			return index - 1;
		}
		return index;
	}

	// Program node that doesn't start/end with a token or comment
	if (endLoc === 0) {
		return -1;
	}
	return tokens.length - 1;
}

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

module.exports = { search, getFirstIndex, getLastIndex };

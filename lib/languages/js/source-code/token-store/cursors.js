/**
 * @fileoverview Define 2 token factories; forward and backward.
 * @author Toru Nagashima
 */
// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const BackwardTokenCommentCursor = require("./backward-token-comment-cursor");
const BackwardTokenCursor = require("./backward-token-cursor");
const FilterCursor = require("./filter-cursor");
const ForwardTokenCommentCursor = require("./forward-token-comment-cursor");
const ForwardTokenCursor = require("./forward-token-cursor");
const LimitCursor = require("./limit-cursor");
const SkipCursor = require("./skip-cursor");

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/** @typedef {import("../../../../shared/types.js").Token} Token */
/** @typedef {import("../../../../shared/types.js").Comment} Comment */
/** @typedef {import("./utils.js").IndexMap} IndexMap */
/** @typedef {import("./cursor.js")} Cursor */
/** @typedef {import("./filter-cursor.js").TokenPredicate} TokenPredicate */

/**
 * The constructor of a base cursor.
 *
 * The two base cursors a factory is built from are distinct classes, so the
 * parameters are typed by the signature they share rather than by a union of
 * the classes themselves — `new` on a union of constructors is not callable.
 * @typedef {new (tokens: Array<Token>, comments: Array<Comment>, indexMap: IndexMap, startLoc: number, endLoc: number) => Cursor} BaseCursorConstructor
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * The cursor factory.
 * @private
 */
class CursorFactory {
	/**
	 * Initializes this cursor.
	 * @param {BaseCursorConstructor} TokenCursor The class of the cursor which iterates tokens only.
	 * @param {BaseCursorConstructor} TokenCommentCursor The class of the cursor which iterates the mix of tokens and comments.
	 */
	constructor(TokenCursor, TokenCommentCursor) {
		this.TokenCursor = TokenCursor;
		this.TokenCommentCursor = TokenCommentCursor;
	}

	/**
	 * Creates a base cursor instance that can be decorated by createCursor.
	 * @param {Array<Token>} tokens The array of tokens.
	 * @param {Array<Comment>} comments The array of comments.
	 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
	 * @param {number} startLoc The start location of the iteration range.
	 * @param {number} endLoc The end location of the iteration range.
	 * @param {boolean} [includeComments] The flag to iterate comments as well.
	 * @returns {Cursor} The created base cursor.
	 */
	createBaseCursor(
		tokens,
		comments,
		indexMap,
		startLoc,
		endLoc,
		includeComments,
	) {
		const Cursor = includeComments
			? this.TokenCommentCursor
			: this.TokenCursor;

		return new Cursor(tokens, comments, indexMap, startLoc, endLoc);
	}

	/**
	 * Creates a cursor that iterates tokens with normalized options.
	 * @param {Array<Token>} tokens The array of tokens.
	 * @param {Array<Comment>} comments The array of comments.
	 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
	 * @param {number} startLoc The start location of the iteration range.
	 * @param {number} endLoc The end location of the iteration range.
	 * @param {boolean} includeComments The flag to iterate comments as well.
	 * @param {TokenPredicate | null} filter The predicate function to choose tokens.
	 * @param {number} skip The count of tokens the cursor skips.
	 * @param {number} count The maximum count of tokens the cursor iterates. Zero is no iteration for backward compatibility.
	 * @returns {Cursor} The created cursor.
	 */
	createCursor(
		tokens,
		comments,
		indexMap,
		startLoc,
		endLoc,
		includeComments,
		filter,
		skip,
		count,
	) {
		let cursor = this.createBaseCursor(
			tokens,
			comments,
			indexMap,
			startLoc,
			endLoc,
			includeComments,
		);

		if (filter) {
			cursor = new FilterCursor(cursor, filter);
		}
		if (skip >= 1) {
			cursor = new SkipCursor(cursor, skip);
		}
		if (count >= 0) {
			cursor = new LimitCursor(cursor, count);
		}

		return cursor;
	}
}

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

module.exports = {
	forward: new CursorFactory(ForwardTokenCursor, ForwardTokenCommentCursor),
	backward: new CursorFactory(
		BackwardTokenCursor,
		BackwardTokenCommentCursor,
	),
};

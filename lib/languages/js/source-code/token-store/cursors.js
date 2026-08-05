/**
 * @fileoverview Define 2 token factories; forward and backward.
 * @author Toru Nagashima
 */
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
// Helpers
//------------------------------------------------------------------------------

/**
 * The cursor factory.
 * @private
 */
class CursorFactory {
	/**
	 * Initializes this cursor.
	 * @param TokenCursor The class of the cursor which iterates tokens only.
	 * @param TokenCommentCursor The class of the cursor which iterates the mix of tokens and comments.
	 */
	constructor(TokenCursor, TokenCommentCursor) {
		this.TokenCursor = TokenCursor;
		this.TokenCommentCursor = TokenCommentCursor;
	}

	/**
	 * Creates a base cursor instance that can be decorated by createCursor.
	 * @param tokens The array of tokens.
	 * @param comments The array of comments.
	 * @param indexMap The map from locations to indices in `tokens`.
	 * @param startLoc The start location of the iteration range.
	 * @param endLoc The end location of the iteration range.
	 * @param includeComments The flag to iterate comments as well.
	 * @returns The created base cursor.
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
	 * @param tokens The array of tokens.
	 * @param comments The array of comments.
	 * @param indexMap The map from locations to indices in `tokens`.
	 * @param startLoc The start location of the iteration range.
	 * @param endLoc The end location of the iteration range.
	 * @param includeComments The flag to iterate comments as well.
	 * @param filter The predicate function to choose tokens.
	 * @param skip The count of tokens the cursor skips.
	 * @param count The maximum count of tokens the cursor iterates. Zero is no iteration for backward compatibility.
	 * @returns The created cursor.
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

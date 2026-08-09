// @ts-check
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
// Types
//------------------------------------------------------------------------------

/** @import { Comment, Token, TokenFilter } from "../../../../types/core.js" */

/** @import { IndexMap } from "./utils.js" */

/** @typedef {InstanceType<typeof import("./cursor.js")>} Cursor */

/**
 * The class of a cursor that iterates a token range directly, rather than by
 * decorating another cursor.
 *
 * This module is typed against the SHARED CURSOR INTERFACE — `cursor.js`, which
 * every concrete cursor reaches through `extends` — and not against the union of
 * the concrete classes, for two reasons.
 *
 * First, the union would be dishonest about what this module knows. A factory
 * holds its two base classes as INSTANCE FIELDS, so `createBaseCursor` picks its
 * constructor from a runtime value; `createCursor` then wraps that result in
 * `FilterCursor`, `SkipCursor` and `LimitCursor` under three independent flags.
 * The declared result would be a six-way union whose member is decided by four
 * runtime values the compiler cannot see, so no caller could narrow it anyway.
 *
 * Second, the union would be useless to the callers. `token-store/index.js`
 * consumes nothing but `current` / `moveNext()` / `getOneToken()` /
 * `getAllTokens()`, which is exactly the base class's surface — the whole point
 * of the protocol `cursor.js` describes.
 * @typedef {new (tokens: Token[], comments: Comment[], indexMap: IndexMap, startLoc: number, endLoc: number) => Cursor} BaseCursorClass
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
	 * @param {BaseCursorClass} TokenCursor The class of the cursor which iterates tokens only.
	 * @param {BaseCursorClass} TokenCommentCursor The class of the cursor which iterates the mix of tokens and comments.
	 */
	constructor(TokenCursor, TokenCommentCursor) {
		this.TokenCursor = TokenCursor;
		this.TokenCommentCursor = TokenCommentCursor;
	}

	/**
	 * Creates a base cursor instance that can be decorated by createCursor.
	 * @param {Token[]} tokens The array of tokens.
	 * @param {Comment[]} comments The array of comments.
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
	 *
	 * The result is a `Cursor` and nothing narrower. Three independent runtime
	 * flags each add a decorator, so the concrete class is one of six — and
	 * every one of those six is a `Cursor`, which is the only thing a caller
	 * can act on.
	 * @param {Token[]} tokens The array of tokens.
	 * @param {Comment[]} comments The array of comments.
	 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
	 * @param {number} startLoc The start location of the iteration range.
	 * @param {number} endLoc The end location of the iteration range.
	 * @param {boolean} includeComments The flag to iterate comments as well.
	 * @param {TokenFilter | null} filter The predicate function to choose tokens.
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

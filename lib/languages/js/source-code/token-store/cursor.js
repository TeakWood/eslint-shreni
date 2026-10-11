// @ts-check
/**
 * @fileoverview Define the abstract class about cursors which iterate tokens.
 * @author Toru Nagashima
 */
"use strict";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("./utils.js").Token} Token */

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * The abstract class about cursors which iterate tokens.
 *
 * This class has 2 abstract methods.
 *
 * - `current: Token | Comment | null` ... The current token.
 * - `moveNext(): boolean` ... Moves this cursor to the next token. If the next token didn't exist, it returns `false`.
 *
 * This is similar to ES2015 Iterators.
 * However, Iterators were slow (at 2017-01), so I created this class as similar to C# IEnumerable.
 *
 * There are the following known sub classes.
 *
 * - ForwardTokenCursor .......... The cursor which iterates tokens only.
 * - BackwardTokenCursor ......... The cursor which iterates tokens only in reverse.
 * - ForwardTokenCommentCursor ... The cursor which iterates tokens and comments.
 * - BackwardTokenCommentCursor .. The cursor which iterates tokens and comments in reverse.
 * - DecorativeCursor
 *     - FilterCursor ............ The cursor which ignores the specified tokens.
 *     - SkipCursor .............. The cursor which ignores the first few tokens.
 *     - LimitCursor ............. The cursor which limits the count of tokens.
 *
 */
module.exports = class Cursor {
	/**
	 * Initializes this cursor.
	 */
	constructor() {
		/**
		 * The token the cursor is currently positioned on, or `null` before the
		 * first `moveNext()` and after the last one.
		 * @type {Token | null}
		 */
		this.current = null;
	}

	/**
	 * Gets the first token.
	 * This consumes this cursor.
	 * @returns {Token | null} The first token or null.
	 */
	getOneToken() {
		return this.moveNext() ? this.current : null;
	}

	/**
	 * Gets the first tokens.
	 * This consumes this cursor.
	 * @returns {Token[]} All tokens.
	 */
	getAllTokens() {
		/** @type {Token[]} */
		const tokens = [];

		while (this.moveNext()) {
			/*
			 * Every `moveNext()` in the hierarchy sets `current` to a token
			 * before returning `true`, so the cast records an invariant the
			 * return value cannot express.
			 */
			tokens.push(/** @type {Token} */ (this.current));
		}

		return tokens;
	}

	/**
	 * Moves this cursor to the next token.
	 * @returns {boolean} `true` if the next token exists.
	 * @abstract
	 */
	/* c8 ignore next */
	// eslint-disable-next-line class-methods-use-this -- Unused
	moveNext() {
		throw new Error("Not implemented.");
	}
};

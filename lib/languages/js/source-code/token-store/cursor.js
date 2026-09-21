/**
 * @fileoverview Define the abstract class about cursors which iterate tokens.
 * @author Toru Nagashima
 */
// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/** @typedef {import("../../../../shared/types.js").Token} Token */
/** @typedef {import("../../../../shared/types.js").Comment} Comment */

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
		/** @type {Token | Comment | null} */
		this.current = null;
	}

	/**
	 * Gets the first token.
	 * This consumes this cursor.
	 * @returns {Token | Comment | null} The first token or null.
	 */
	getOneToken() {
		return this.moveNext() ? this.current : null;
	}

	/**
	 * Gets the first tokens.
	 * This consumes this cursor.
	 * @returns {Array<Token | Comment>} All tokens.
	 */
	getAllTokens() {
		/** @type {Array<Token | Comment>} */
		const tokens = [];

		while (this.moveNext()) {
			/*
			 * `moveNext()` returning `true` is the contract that `current` now
			 * holds a token; the cast records that, since tsc cannot follow an
			 * invariant carried across a method call on a mutable property.
			 */
			tokens.push(/** @type {Token | Comment} */ (this.current));
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

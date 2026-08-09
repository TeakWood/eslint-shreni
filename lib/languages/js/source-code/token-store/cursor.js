// @ts-check
/**
 * @fileoverview Define the abstract class about cursors which iterate tokens.
 * @author Toru Nagashima
 */
"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @import { Comment, Token } from "../../../../types/core.js" */

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
 * Every one of those subclasses reaches this class through `extends`, so this
 * IS the declared cursor interface — `token-store/index.js` types every cursor
 * it builds as a `Cursor`, never as the structural union of the concrete
 * classes, and the two shorthands below are what a subclass overrides to
 * narrow its own result.
 */
module.exports = class Cursor {
	/**
	 * Initializes this cursor.
	 */
	constructor() {
		/**
		 * The token or comment the cursor is currently on, or `null` before the
		 * first `moveNext()` and after the last one. Annotated explicitly
		 * because inference from the `null` initializer alone would type it
		 * `null` and reject every assignment the subclasses make.
		 * @type {Token | Comment | null}
		 */
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
	 * @returns {(Token | Comment)[]} All tokens.
	 */
	getAllTokens() {
		/** @type {(Token | Comment)[]} */
		const tokens = [];

		while (this.moveNext()) {
			/*
			 * ESCAPE HATCH: `current` is `Token | Comment | null` and the
			 * compiler cannot see that `moveNext()` returning `true` is this
			 * protocol's guarantee that it has been set. The `while` condition
			 * is what makes the assertion safe — it is load-bearing, not
			 * decorative.
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

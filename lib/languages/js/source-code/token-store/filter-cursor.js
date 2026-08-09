// @ts-check
/**
 * @fileoverview Define the cursor which ignores specified tokens.
 * @author Toru Nagashima
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const DecorativeCursor = require("./decorative-cursor");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @import { Comment, Token, TokenFilter } from "../../../../types/core.js" */

/** @typedef {InstanceType<typeof import("./cursor.js")>} Cursor */

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * The decorative cursor which ignores specified tokens.
 */
module.exports = class FilterCursor extends DecorativeCursor {
	/**
	 * Initializes this cursor.
	 * @param {Cursor} cursor The cursor to be decorated.
	 * @param {TokenFilter} predicate The predicate function to decide tokens this cursor iterates.
	 */
	constructor(cursor, predicate) {
		super(cursor);
		this.predicate = predicate;
	}

	/**
	 * @inheritdoc
	 * @returns {boolean} `true` if the next token exists.
	 */
	moveNext() {
		const predicate = this.predicate;

		while (super.moveNext()) {
			/*
			 * ESCAPE HATCH: `current` is `Token | Comment | null`, and the
			 * compiler cannot see that `moveNext()` returning `true` means the
			 * decorated cursor has set it. The `while` condition is what makes
			 * the assertion safe — it is load-bearing, not decorative.
			 */
			if (predicate(/** @type {Token | Comment} */ (this.current))) {
				return true;
			}
		}
		return false;
	}
};

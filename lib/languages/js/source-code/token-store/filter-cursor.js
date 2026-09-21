/**
 * @fileoverview Define the cursor which ignores specified tokens.
 * @author Toru Nagashima
 */
// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const DecorativeCursor = require("./decorative-cursor");

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/** @typedef {import("../../../../shared/types.js").Token} Token */
/** @typedef {import("../../../../shared/types.js").Comment} Comment */
/** @typedef {import("./cursor.js")} Cursor */

/**
 * A predicate deciding whether a cursor yields a given token.
 * @typedef {(token: Token | Comment) => boolean} TokenPredicate
 */

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
	 * @param {TokenPredicate} predicate The predicate function to decide tokens this cursor iterates.
	 */
	constructor(cursor, predicate) {
		super(cursor);
		this.predicate = predicate;
	}

	/** @inheritdoc */
	moveNext() {
		const predicate = this.predicate;

		while (super.moveNext()) {
			// `super.moveNext()` returning `true` guarantees `current` is set.
			if (predicate(/** @type {Token | Comment} */ (this.current))) {
				return true;
			}
		}
		return false;
	}
};

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
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("./utils.js").Token} Token */

/**
 * Decides whether the cursor iterates a token.
 * @typedef {(token: Token) => boolean} TokenPredicate
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
	 * @param {import("./cursor.js")} cursor The cursor to be decorated.
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
			// `super.moveNext()` returning `true` guarantees a current token.
			if (predicate(/** @type {Token} */ (this.current))) {
				return true;
			}
		}
		return false;
	}
};

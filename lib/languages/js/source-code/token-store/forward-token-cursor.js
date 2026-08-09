// @ts-check
/**
 * @fileoverview Define the cursor which iterates tokens only.
 * @author Toru Nagashima
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const Cursor = require("./cursor");
const { getFirstIndex, getLastIndex } = require("./utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @import { Comment, Token } from "../../../../types/core.js" */

/** @import { IndexMap } from "./utils.js" */

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * The cursor which iterates tokens only.
 */
module.exports = class ForwardTokenCursor extends Cursor {
	/**
	 * Initializes this cursor.
	 * @param {Token[]} tokens The array of tokens.
	 * @param {Comment[]} comments The array of comments.
	 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
	 * @param {number} startLoc The start location of the iteration range.
	 * @param {number} endLoc The end location of the iteration range.
	 */
	constructor(tokens, comments, indexMap, startLoc, endLoc) {
		super();
		this.tokens = tokens;
		this.index = getFirstIndex(tokens, indexMap, startLoc);
		this.indexEnd = getLastIndex(tokens, indexMap, endLoc);
	}

	/**
	 * @inheritdoc
	 * @returns {boolean} `true` if the next token exists.
	 */
	moveNext() {
		if (this.index <= this.indexEnd) {
			this.current = this.tokens[this.index];
			this.index += 1;
			return true;
		}
		return false;
	}

	/*
	 *
	 * Shorthand for performance.
	 *
	 */

	/**
	 * @inheritdoc
	 * @returns {Token | null} The first token or null.
	 */
	getOneToken() {
		return this.index <= this.indexEnd ? this.tokens[this.index] : null;
	}

	/**
	 * @inheritdoc
	 * @returns {Token[]} All tokens.
	 */
	getAllTokens() {
		return this.tokens.slice(this.index, this.indexEnd + 1);
	}
};

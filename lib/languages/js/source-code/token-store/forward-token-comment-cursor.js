/**
 * @fileoverview Define the cursor which iterates tokens and comments.
 * @author Toru Nagashima
 */
// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const Cursor = require("./cursor");
const { getFirstIndex, search } = require("./utils");

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/** @typedef {import("../../../../shared/types.js").Token} Token */
/** @typedef {import("../../../../shared/types.js").Comment} Comment */
/** @typedef {import("./utils.js").IndexMap} IndexMap */

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * The cursor which iterates tokens and comments.
 */
module.exports = class ForwardTokenCommentCursor extends Cursor {
	/**
	 * Initializes this cursor.
	 * @param {Array<Token>} tokens The array of tokens.
	 * @param {Array<Comment>} comments The array of comments.
	 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
	 * @param {number} startLoc The start location of the iteration range.
	 * @param {number} endLoc The end location of the iteration range.
	 */
	constructor(tokens, comments, indexMap, startLoc, endLoc) {
		super();
		this.tokens = tokens;
		this.comments = comments;
		this.tokenIndex = getFirstIndex(tokens, indexMap, startLoc);
		this.commentIndex = search(comments, startLoc);
		this.border = endLoc;
	}

	/** @inheritdoc */
	moveNext() {
		const token =
			this.tokenIndex < this.tokens.length
				? this.tokens[this.tokenIndex]
				: null;
		const comment =
			this.commentIndex < this.comments.length
				? this.comments[this.commentIndex]
				: null;

		if (token && (!comment || token.range[0] < comment.range[0])) {
			this.current = token;
			this.tokenIndex += 1;
		} else if (comment) {
			this.current = comment;
			this.commentIndex += 1;
		} else {
			this.current = null;
		}

		/*
		 * `Boolean()` does not narrow a mutable property, so the read below
		 * is cast rather than restructured: the branch only runs when
		 * `this.current` is one of the two values assigned just above.
		 */
		return (
			Boolean(this.current) &&
			(this.border === -1 ||
				/** @type {Token | Comment} */ (this.current).range[1] <=
					this.border)
		);
	}
};

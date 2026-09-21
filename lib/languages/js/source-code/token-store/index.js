/**
 * @fileoverview Object to handle access and retrieval of tokens.
 * @author Brandon Mills
 */
// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { isCommentToken } = require("@eslint-community/eslint-utils");
const assert = require("../../../../shared/assert");
const cursors = require("./cursors");
const ForwardTokenCursor = require("./forward-token-cursor");
const PaddedTokenCursor = require("./padded-token-cursor");
const utils = require("./utils");

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/** @typedef {import("../../../../shared/types.js").Comment} Comment */
/** @typedef {import("../../../../shared/types.js").NodeOrToken} NodeOrToken */
/** @typedef {import("../../../../shared/types.js").Range} Range */
/** @typedef {import("../../../../shared/types.js").Token} Token */
/** @typedef {import("./cursor.js")} Cursor */
/** @typedef {import("./filter-cursor.js").TokenPredicate} TokenPredicate */
/** @typedef {import("./utils.js").IndexMap} IndexMap */

/** @typedef {typeof cursors.forward} CursorFactory */

/**
 * The option object accepted by the public token-getting methods.
 *
 * Each method documents which subset it honours; the shape is shared because
 * the `skip` and `count` variants are otherwise identical.
 * @typedef {Object} CursorOptions
 * @property {boolean} [includeComments] The flag to iterate comments as well.
 * @property {TokenPredicate | null} [filter] The predicate function to choose tokens.
 * @property {number} [skip] The count of tokens the cursor skips.
 * @property {number} [count] The maximum count of tokens the cursor iterates.
 */

/**
 * The `options` argument of the public token-getting methods, which accept a
 * bare number or a bare predicate in place of the option object.
 * @typedef {number | TokenPredicate | CursorOptions} CursorOptionsArgument
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const TOKENS = Symbol("tokens");
const COMMENTS = Symbol("comments");
const INDEX_MAP = Symbol("indexMap");

/**
 * Creates the map from locations to indices in `tokens`.
 *
 * The first/last location of tokens is mapped to the index of the token.
 * The first/last location of comments is mapped to the index of the next token of each comment.
 * @param {Array<Token>} tokens The array of tokens.
 * @param {Array<Comment>} comments The array of comments.
 * @returns {IndexMap} The map from locations to indices in `tokens`.
 * @private
 */
function createIndexMap(tokens, comments) {
	/** @type {IndexMap} */
	const map = Object.create(null);
	let tokenIndex = 0;
	let commentIndex = 0;
	/** @type {number} */
	let nextStart;
	/** @type {Range} */
	let range;

	while (tokenIndex < tokens.length || commentIndex < comments.length) {
		nextStart =
			commentIndex < comments.length
				? comments[commentIndex].range[0]
				: Number.MAX_SAFE_INTEGER;
		while (
			tokenIndex < tokens.length &&
			(range = tokens[tokenIndex].range)[0] < nextStart
		) {
			map[range[0]] = tokenIndex;
			map[range[1] - 1] = tokenIndex;
			tokenIndex += 1;
		}

		nextStart =
			tokenIndex < tokens.length
				? tokens[tokenIndex].range[0]
				: Number.MAX_SAFE_INTEGER;
		while (
			commentIndex < comments.length &&
			(range = comments[commentIndex].range)[0] < nextStart
		) {
			map[range[0]] = tokenIndex;
			map[range[1] - 1] = tokenIndex;
			commentIndex += 1;
		}
	}

	return map;
}

/**
 * Creates the cursor iterates tokens with options.
 * @param {CursorFactory} factory The cursor factory to initialize cursor.
 * @param {Array<Token>} tokens The array of tokens.
 * @param {Array<Comment>} comments The array of comments.
 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
 * @param {number} startLoc The start location of the iteration range.
 * @param {number} endLoc The end location of the iteration range.
 * @param {CursorOptionsArgument} [opts=0] The option object. If this is a number then it's `opts.skip`. If this is a function then it's `opts.filter`.
 * @returns {Cursor} The created cursor.
 * @private
 */
function createCursorWithSkip(
	factory,
	tokens,
	comments,
	indexMap,
	startLoc,
	endLoc,
	opts,
) {
	let includeComments = false;
	let skip = 0;
	/** @type {TokenPredicate | null} */
	let filter = null;

	if (typeof opts === "number") {
		skip = opts | 0;
	} else if (typeof opts === "function") {
		filter = opts;
	} else if (opts) {
		includeComments = !!opts.includeComments;

		// A missing `skip` is what `| 0` turns into 0; see NUMERIC_OPTION above.
		skip = /** @type {number} */ (opts.skip) | 0;
		filter = opts.filter || null;
	}
	assert(skip >= 0, "options.skip should be zero or a positive integer.");
	assert(
		!filter || typeof filter === "function",
		"options.filter should be a function.",
	);

	return factory.createCursor(
		tokens,
		comments,
		indexMap,
		startLoc,
		endLoc,
		includeComments,
		filter,
		skip,
		-1,
	);
}

/**
 * Creates the cursor iterates tokens with options.
 * @param {CursorFactory} factory The cursor factory to initialize cursor.
 * @param {Array<Token>} tokens The array of tokens.
 * @param {Array<Comment>} comments The array of comments.
 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
 * @param {number} startLoc The start location of the iteration range.
 * @param {number} endLoc The end location of the iteration range.
 * @param {CursorOptionsArgument} [opts=0] The option object. If this is a number then it's `opts.count`. If this is a function then it's `opts.filter`.
 * @returns {Cursor} The created cursor.
 * @private
 */
function createCursorWithCount(
	factory,
	tokens,
	comments,
	indexMap,
	startLoc,
	endLoc,
	opts,
) {
	let includeComments = false;
	let count = 0;
	let countExists = false;
	/** @type {TokenPredicate | null} */
	let filter = null;

	if (typeof opts === "number") {
		count = opts | 0;
		countExists = true;
	} else if (typeof opts === "function") {
		filter = opts;
	} else if (opts) {
		includeComments = !!opts.includeComments;

		// A missing `count` is what `| 0` turns into 0; see NUMERIC_OPTION above.
		count = /** @type {number} */ (opts.count) | 0;
		countExists = typeof opts.count === "number";
		filter = opts.filter || null;
	}
	assert(count >= 0, "options.count should be zero or a positive integer.");
	assert(
		!filter || typeof filter === "function",
		"options.filter should be a function.",
	);

	return factory.createCursor(
		tokens,
		comments,
		indexMap,
		startLoc,
		endLoc,
		includeComments,
		filter,
		0,
		countExists ? count : -1,
	);
}

/**
 * Creates the cursor iterates tokens with options.
 *
 * `beforeCount` carries the overload: a number (or nothing) pads the range by
 * that many tokens on each side, while an option object is forwarded to
 * `createCursorWithCount` and `afterCount` is ignored.
 * @param {Array<Token>} tokens The array of tokens.
 * @param {Array<Comment>} comments The array of comments.
 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
 * @param {number} startLoc The start location of the iteration range.
 * @param {number} endLoc The end location of the iteration range.
 * @param {CursorOptionsArgument} [beforeCount=0] The number of tokens before the node to retrieve, or the option object.
 * @param {CursorOptionsArgument} [afterCount=0] The number of tokens after the node to retrieve. `getTokensBetween()` passes the same padding argument for both, so this is typed as widely as `beforeCount` even though only the number form is read.
 * @returns {Cursor} The created cursor.
 * @private
 */
function createCursorWithPadding(
	tokens,
	comments,
	indexMap,
	startLoc,
	endLoc,
	beforeCount,
	afterCount,
) {
	if (
		typeof beforeCount === "undefined" &&
		typeof afterCount === "undefined"
	) {
		return new ForwardTokenCursor(
			tokens,
			comments,
			indexMap,
			startLoc,
			endLoc,
		);
	}
	if (typeof beforeCount === "number" || typeof beforeCount === "undefined") {
		return new PaddedTokenCursor(
			tokens,
			comments,
			indexMap,
			startLoc,
			endLoc,
			/*
			 * Both counts are a number or absent on this branch, and `| 0` is
			 * what turns an absent one into 0.
			 */
			/** @type {number} */ (beforeCount) | 0,
			/** @type {number} */ (afterCount) | 0,
		);
	}
	return createCursorWithCount(
		cursors.forward,
		tokens,
		comments,
		indexMap,
		startLoc,
		endLoc,
		beforeCount,
	);
}

/**
 * Gets comment tokens that are adjacent to the current cursor position.
 * @param {Cursor} cursor A cursor instance.
 * @returns {Array<Comment>} An array of comment tokens adjacent to the current cursor position.
 * @private
 */
function getAdjacentCommentTokensFromCursor(cursor) {
	/** @type {Array<Comment>} */
	const tokens = [];
	let currentToken = cursor.getOneToken();

	while (currentToken && isCommentToken(currentToken)) {
		tokens.push(currentToken);
		currentToken = cursor.getOneToken();
	}

	return tokens;
}

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * The token store.
 *
 * This class provides methods to get tokens by locations as fast as possible.
 * The methods are a part of public API, so we should be careful if it changes this class.
 *
 * People can get tokens in O(1) by the hash map which is mapping from the location of tokens/comments to tokens.
 * Also people can get a mix of tokens and comments in O(log k), the k is the number of comments.
 * Assuming that comments to be much fewer than tokens, this does not make hash map from token's locations to comments to reduce memory cost.
 * This uses binary-searching instead for comments.
 */
module.exports = class TokenStore {
	/**
	 * Initializes this token store.
	 * @param {Array<Token>} tokens The array of tokens.
	 * @param {Array<Comment>} comments The array of comments.
	 */
	constructor(tokens, comments) {
		this[TOKENS] = tokens;
		this[COMMENTS] = comments;
		this[INDEX_MAP] = createIndexMap(tokens, comments);
	}

	//--------------------------------------------------------------------------
	// Gets single token.
	//--------------------------------------------------------------------------

	/**
	 * Gets the token starting at the specified index.
	 * @param {number} offset Index of the start of the token's range.
	 * @param {CursorOptions} [options] The option object.
	 * @returns {Token | Comment | null} The token starting at index, or null if no such token.
	 */
	getTokenByRangeStart(offset, options) {
		const includeComments = options && options.includeComments;
		const token = cursors.forward
			.createBaseCursor(
				this[TOKENS],
				this[COMMENTS],
				this[INDEX_MAP],
				offset,
				-1,
				includeComments,
			)
			.getOneToken();

		if (token && token.range[0] === offset) {
			return token;
		}
		return null;
	}

	/**
	 * Gets the first token of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CursorOptionsArgument} [options=0] The option object. If this is a number then it's `options.skip`. If this is a function then it's `options.filter`.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	getFirstToken(node, options) {
		return createCursorWithSkip(
			cursors.forward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			node.range[0],
			node.range[1],
			options,
		).getOneToken();
	}

	/**
	 * Gets the last token of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	getLastToken(node, options) {
		return createCursorWithSkip(
			cursors.backward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			node.range[0],
			node.range[1],
			options,
		).getOneToken();
	}

	/**
	 * Gets the token that precedes a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	getTokenBefore(node, options) {
		return createCursorWithSkip(
			cursors.backward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			-1,
			node.range[0],
			options,
		).getOneToken();
	}

	/**
	 * Gets the token that follows a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	getTokenAfter(node, options) {
		return createCursorWithSkip(
			cursors.forward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			node.range[1],
			-1,
			options,
		).getOneToken();
	}

	/**
	 * Gets the first token between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	getFirstTokenBetween(left, right, options) {
		return createCursorWithSkip(
			cursors.forward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			left.range[1],
			right.range[0],
			options,
		).getOneToken();
	}

	/**
	 * Gets the last token between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	getLastTokenBetween(left, right, options) {
		return createCursorWithSkip(
			cursors.backward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			left.range[1],
			right.range[0],
			options,
		).getOneToken();
	}

	//--------------------------------------------------------------------------
	// Gets multiple tokens.
	//--------------------------------------------------------------------------

	/**
	 * Gets the first `count` tokens of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CursorOptionsArgument} [options=0] The option object. If this is a number then it's `options.count`. If this is a function then it's `options.filter`.
	 * @returns {Array<Token | Comment>} Tokens.
	 */
	getFirstTokens(node, options) {
		return createCursorWithCount(
			cursors.forward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			node.range[0],
			node.range[1],
			options,
		).getAllTokens();
	}

	/**
	 * Gets the last `count` tokens of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstTokens()
	 * @returns {Array<Token | Comment>} Tokens.
	 */
	getLastTokens(node, options) {
		return createCursorWithCount(
			cursors.backward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			node.range[0],
			node.range[1],
			options,
		)
			.getAllTokens()
			.reverse();
	}

	/**
	 * Gets the `count` tokens that precedes a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstTokens()
	 * @returns {Array<Token | Comment>} Tokens.
	 */
	getTokensBefore(node, options) {
		return createCursorWithCount(
			cursors.backward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			-1,
			node.range[0],
			options,
		)
			.getAllTokens()
			.reverse();
	}

	/**
	 * Gets the `count` tokens that follows a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstTokens()
	 * @returns {Array<Token | Comment>} Tokens.
	 */
	getTokensAfter(node, options) {
		return createCursorWithCount(
			cursors.forward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			node.range[1],
			-1,
			options,
		).getAllTokens();
	}

	/**
	 * Gets the first `count` tokens between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstTokens()
	 * @returns {Array<Token | Comment>} Tokens between left and right.
	 */
	getFirstTokensBetween(left, right, options) {
		return createCursorWithCount(
			cursors.forward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			left.range[1],
			right.range[0],
			options,
		).getAllTokens();
	}

	/**
	 * Gets the last `count` tokens between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CursorOptionsArgument} [options=0] The option object. Same options as getFirstTokens()
	 * @returns {Array<Token | Comment>} Tokens between left and right.
	 */
	getLastTokensBetween(left, right, options) {
		return createCursorWithCount(
			cursors.backward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			left.range[1],
			right.range[0],
			options,
		)
			.getAllTokens()
			.reverse();
	}

	/**
	 * Gets all tokens that are related to the given node.
	 *
	 * `beforeCount` carries the overload: a number (or nothing) pads the
	 * node's range by that many tokens on each side, while an option object
	 * selects tokens instead and `afterCount` is ignored.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CursorOptionsArgument} [beforeCount=0] The number of tokens before the node to retrieve, or the option object.
	 * @param {number} [afterCount=0] The number of tokens after the node to retrieve.
	 * @returns {Array<Token | Comment>} Array of objects representing tokens.
	 */
	getTokens(node, beforeCount, afterCount) {
		return createCursorWithPadding(
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			node.range[0],
			node.range[1],
			beforeCount,
			afterCount,
		).getAllTokens();
	}

	/**
	 * Gets all of the tokens between two non-overlapping nodes.
	 *
	 * As with `getTokens()`, `padding` is either a number of extra tokens or
	 * an option object that selects tokens instead.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CursorOptionsArgument} [padding=0] Number of extra tokens on either side of center, or the option object.
	 * @returns {Array<Token | Comment>} Tokens between left and right.
	 */
	getTokensBetween(left, right, padding) {
		return createCursorWithPadding(
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			left.range[1],
			right.range[0],
			padding,
			padding,
		).getAllTokens();
	}

	//--------------------------------------------------------------------------
	// Others.
	//--------------------------------------------------------------------------

	/**
	 * Checks whether any comments exist or not between the given 2 nodes.
	 * @param {NodeOrToken} left The node to check.
	 * @param {NodeOrToken} right The node to check.
	 * @returns {boolean} `true` if one or more comments exist.
	 */
	commentsExistBetween(left, right) {
		const index = utils.search(this[COMMENTS], left.range[1]);

		return (
			index < this[COMMENTS].length &&
			this[COMMENTS][index].range[1] <= right.range[0]
		);
	}

	/**
	 * Gets all comment tokens directly before the given node or token.
	 * @param {NodeOrToken} nodeOrToken The AST node or token to check for adjacent comment tokens.
	 * @returns {Array<Comment>} An array of comments in occurrence order.
	 */
	getCommentsBefore(nodeOrToken) {
		const cursor = createCursorWithCount(
			cursors.backward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			-1,
			nodeOrToken.range[0],
			{ includeComments: true },
		);

		return getAdjacentCommentTokensFromCursor(cursor).reverse();
	}

	/**
	 * Gets all comment tokens directly after the given node or token.
	 * @param {NodeOrToken} nodeOrToken The AST node or token to check for adjacent comment tokens.
	 * @returns {Array<Comment>} An array of comments in occurrence order.
	 */
	getCommentsAfter(nodeOrToken) {
		const cursor = createCursorWithCount(
			cursors.forward,
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			nodeOrToken.range[1],
			-1,
			{ includeComments: true },
		);

		return getAdjacentCommentTokensFromCursor(cursor);
	}

	/**
	 * Gets all comment tokens inside the given node.
	 * @param {NodeOrToken} node The AST node to get the comments for.
	 * @returns {Array<Comment>} An array of comments in occurrence order.
	 */
	getCommentsInside(node) {
		return this.getTokens(node, {
			includeComments: true,
			filter: isCommentToken,
		});
	}
};

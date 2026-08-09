// @ts-check
/**
 * @fileoverview Object to handle access and retrieval of tokens.
 * @author Brandon Mills
 */
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
// Types
//------------------------------------------------------------------------------

/**
 * @import {
 *     ASTNode,
 *     Comment,
 *     CountOptions,
 *     NodeOrToken,
 *     SkipOptions,
 *     SourceRange,
 *     Token,
 *     TokenFilter,
 * } from "../../../../types/core.js"
 */

/** @import { IndexMap } from "./utils.js" */

/** @typedef {InstanceType<typeof import("./cursor.js")>} Cursor */

/*
 * Every public getter below is an OVERLOAD FAMILY rather than one signature
 * over a widened union, because the option argument decides the RESULT type:
 * only the object form with `includeComments: true` can ever yield a `Comment`,
 * so a single `SkipOptions`/`CountOptions` signature would force every caller
 * — the overwhelming majority of which pass nothing, a number or a filter — to
 * handle a `Comment` that cannot occur.
 *
 * Each family is three (for `getTokens`/`getTokensBetween`, four) overloads:
 *
 *   1. the comment-inclusive object form ......... widest result
 *   2. the token-only forms ...................... `Token` result
 *   3. the whole option union .................... widest result
 *
 * The third exists so that a caller forwarding an argument it only knows as
 * `SkipOptions`/`CountOptions` still type-checks; without it neither of the
 * first two would accept such a value. Drop it and every wrapper around these
 * getters has to re-discriminate the union itself.
 */

/**
 * The `SkipOptions` forms that cannot yield a comment.
 *
 * A bare number is `skip` and a bare function is `filter`
 * (`createCursorWithSkip` below); the object form reaches comments only when it
 * asks for them, so omitting `includeComments` — or setting it `false` — pins
 * the result to tokens.
 * @typedef {number | TokenFilter | { includeComments?: false, filter?: TokenFilter, skip?: number }} TokenOnlySkipOptions
 */

/**
 * The `SkipOptions` form that asks for comments as well as tokens.
 * @typedef {{ includeComments: true, filter?: TokenFilter, skip?: number }} CommentInclusiveSkipOptions
 */

/**
 * The `CountOptions` forms that cannot yield a comment. As `TokenOnlySkipOptions`,
 * except that a bare number is `count` rather than `skip`.
 * @typedef {number | TokenFilter | { includeComments?: false, filter?: TokenFilter, count?: number }} TokenOnlyCountOptions
 */

/**
 * The `CountOptions` form that asks for comments as well as tokens.
 * @typedef {{ includeComments: true, filter?: TokenFilter, count?: number }} CommentInclusiveCountOptions
 */

/**
 * The `CountOptions` object/function forms that cannot yield a comment.
 *
 * `getTokens` and `getTokensBetween` need this instead of
 * `TokenOnlyCountOptions` because a NUMBER means something different to them:
 * `createCursorWithPadding` reads it as padding, never as `count`.
 * @typedef {TokenFilter | { includeComments?: false, filter?: TokenFilter, count?: number }} TokenOnlyPaddingOptions
 */

/**
 * A cursor factory — `cursors.forward` or `cursors.backward`.
 *
 * Derived from the export rather than restated, because the class itself is
 * private to `cursors.js`. This replaces the hand-written structural typedef
 * that stood here while that file was un-annotated: a restatement can drift
 * from the factory it describes, and this cannot.
 * @typedef {typeof cursors.forward} CursorFactory
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
 * @param {Token[]} tokens The array of tokens.
 * @param {Comment[]} comments The array of comments.
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
	/** @type {SourceRange} */
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
 * @param {Token[]} tokens The array of tokens.
 * @param {Comment[]} comments The array of comments.
 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
 * @param {number} startLoc The start location of the iteration range.
 * @param {number} endLoc The end location of the iteration range.
 * @param {SkipOptions} [opts] The option object. If this is a number then it's `opts.skip`. If this is a function then it's `opts.filter`.
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
	/** @type {TokenFilter | null} */
	let filter = null;

	if (typeof opts === "number") {
		skip = opts | 0;
	} else if (typeof opts === "function") {
		filter = opts;
	} else if (opts) {
		includeComments = !!opts.includeComments;

		/*
		 * ESCAPE HATCH: `skip` is optional, and `undefined | 0` is `0` — the
		 * documented default. The assertion tells the compiler the operand is
		 * numeric so the bitwise coercion type-checks; it asserts nothing about
		 * the value and changes no behaviour.
		 */
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
 * @param {Token[]} tokens The array of tokens.
 * @param {Comment[]} comments The array of comments.
 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
 * @param {number} startLoc The start location of the iteration range.
 * @param {number} endLoc The end location of the iteration range.
 * @param {CountOptions} [opts] The option object. If this is a number then it's `opts.count`. If this is a function then it's `opts.filter`.
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
	/** @type {TokenFilter | null} */
	let filter = null;

	if (typeof opts === "number") {
		count = opts | 0;
		countExists = true;
	} else if (typeof opts === "function") {
		filter = opts;
	} else if (opts) {
		includeComments = !!opts.includeComments;

		/*
		 * ESCAPE HATCH: as in `createCursorWithSkip` above — `count` is
		 * optional and `undefined | 0` is `0`. The `countExists` line below is
		 * what actually distinguishes "absent" from "zero", so nothing depends
		 * on this coercion telling them apart.
		 */
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
 * `beforeCount` carries two unrelated meanings for backward compatibility: a
 * number (or nothing) is padding, and anything else is a `CountOptions` value
 * forwarded to `createCursorWithCount`. `afterCount` is only ever padding.
 * @param {Token[]} tokens The array of tokens.
 * @param {Comment[]} comments The array of comments.
 * @param {IndexMap} indexMap The map from locations to indices in `tokens`.
 * @param {number} startLoc The start location of the iteration range.
 * @param {number} endLoc The end location of the iteration range.
 * @param {CountOptions} [beforeCount] The number of tokens before the node to retrieve, or the option object.
 * @param {number} [afterCount] The number of tokens after the node to retrieve.
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
		/*
		 * ESCAPE HATCH: both counts are optional here and `undefined | 0` is
		 * `0`, which is the documented "no padding" default. The assertions
		 * make the bitwise coercions type-check without changing behaviour.
		 */
		return new PaddedTokenCursor(
			tokens,
			comments,
			indexMap,
			startLoc,
			endLoc,
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
 * @returns {Comment[]} An array of comment tokens adjacent to the current cursor position.
 * @private
 */
function getAdjacentCommentTokensFromCursor(cursor) {
	/** @type {Comment[]} */
	const tokens = [];
	let currentToken = cursor.getOneToken();

	while (currentToken && isCommentToken(currentToken)) {
		/*
		 * ESCAPE HATCH: `isCommentToken` narrows to `@types/estree`'s
		 * `Comment`, which is a weaker declaration than this repo's — it omits
		 * `"Shebang"` from `type` and declares `range`/`loc` optional, both
		 * deliberate divergences recorded in `core.d.ts`. Its runtime test is
		 * `["Block", "Line", "Shebang"].includes(token.type)`, which is exactly
		 * right for anything a cursor yields, so only the declaration
		 * disagrees; the narrowing is re-stated in this vocabulary here.
		 */
		tokens.push(/** @type {Comment} */ (currentToken));
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
	 * @param {Token[]} tokens The array of tokens.
	 * @param {Comment[]} comments The array of comments.
	 */
	constructor(tokens, comments) {
		/**
		 * All of this class's state lives in these three computed symbol slots,
		 * so that nothing outside this file can reach it. Each is annotated
		 * explicitly: `TOKENS` and `COMMENTS` would infer from their arguments,
		 * but `INDEX_MAP` comes from `Object.create(null)` and would otherwise
		 * be `any`, taking every index lookup in the file with it.
		 * @type {Token[]}
		 */
		this[TOKENS] = tokens;

		/** @type {Comment[]} */
		this[COMMENTS] = comments;

		/** @type {IndexMap} */
		this[INDEX_MAP] = createIndexMap(tokens, comments);
	}

	//--------------------------------------------------------------------------
	// Gets single token.
	//--------------------------------------------------------------------------

	/**
	 * Gets the token starting at the specified index.
	 * @overload
	 * @param {number} offset Index of the start of the token's range.
	 * @param {{ includeComments: true }} options The option object.
	 * @returns {Token | Comment | null} The token or comment starting at index, or null if no such token.
	 */
	/**
	 * Gets the token starting at the specified index.
	 * @overload
	 * @param {number} offset Index of the start of the token's range.
	 * @param {{ includeComments?: false }} [options] The option object.
	 * @returns {Token | null} The token starting at index, or null if no such token.
	 */
	/**
	 * Gets the token starting at the specified index.
	 * @overload
	 * @param {number} offset Index of the start of the token's range.
	 * @param {{ includeComments?: boolean }} [options] The option object.
	 * @returns {Token | Comment | null} The token starting at index, or null if no such token.
	 */
	/**
	 * Gets the token starting at the specified index.
	 * @param {number} offset Index of the start of the token's range.
	 * @param {{ includeComments?: boolean }} [options] The option object.
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
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CommentInclusiveSkipOptions} options The option object.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the first token of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {TokenOnlySkipOptions} [options] The option object. If this is a number then it's `options.skip`. If this is a function then it's `options.filter`.
	 * @returns {Token | null} An object representing the token.
	 */
	/**
	 * Gets the first token of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {SkipOptions} [options] The option object.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the first token of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {SkipOptions} [options] The option object.
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
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CommentInclusiveSkipOptions} options The option object.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the last token of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {TokenOnlySkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | null} An object representing the token.
	 */
	/**
	 * Gets the last token of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the last token of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
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
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CommentInclusiveSkipOptions} options The option object.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the token that precedes a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {TokenOnlySkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | null} An object representing the token.
	 */
	/**
	 * Gets the token that precedes a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the token that precedes a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
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
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CommentInclusiveSkipOptions} options The option object.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the token that follows a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {TokenOnlySkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | null} An object representing the token.
	 */
	/**
	 * Gets the token that follows a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the token that follows a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
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
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CommentInclusiveSkipOptions} options The option object.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the first token between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {TokenOnlySkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | null} An object representing the token.
	 */
	/**
	 * Gets the first token between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the first token between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
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
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CommentInclusiveSkipOptions} options The option object.
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the last token between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {TokenOnlySkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | null} An object representing the token.
	 */
	/**
	 * Gets the last token between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
	 * @returns {Token | Comment | null} An object representing the token.
	 */
	/**
	 * Gets the last token between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {SkipOptions} [options] The option object. Same options as getFirstToken()
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
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CommentInclusiveCountOptions} options The option object.
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the first `count` tokens of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {TokenOnlyCountOptions} [options] The option object. If this is a number then it's `options.count`. If this is a function then it's `options.filter`.
	 * @returns {Token[]} Tokens.
	 */
	/**
	 * Gets the first `count` tokens of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CountOptions} [options] The option object.
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the first `count` tokens of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CountOptions} [options] The option object.
	 * @returns {(Token | Comment)[]} Tokens.
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
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CommentInclusiveCountOptions} options The option object.
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the last `count` tokens of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {TokenOnlyCountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {Token[]} Tokens.
	 */
	/**
	 * Gets the last `count` tokens of the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the last `count` tokens of the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens.
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
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CommentInclusiveCountOptions} options The option object.
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the `count` tokens that precedes a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {TokenOnlyCountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {Token[]} Tokens.
	 */
	/**
	 * Gets the `count` tokens that precedes a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the `count` tokens that precedes a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens.
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
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CommentInclusiveCountOptions} options The option object.
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the `count` tokens that follows a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {TokenOnlyCountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {Token[]} Tokens.
	 */
	/**
	 * Gets the `count` tokens that follows a given node or token.
	 * @overload
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens.
	 */
	/**
	 * Gets the `count` tokens that follows a given node or token.
	 * @param {NodeOrToken} node The AST node or token.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens.
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
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CommentInclusiveCountOptions} options The option object.
	 * @returns {(Token | Comment)[]} Tokens between left and right.
	 */
	/**
	 * Gets the first `count` tokens between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {TokenOnlyCountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {Token[]} Tokens between left and right.
	 */
	/**
	 * Gets the first `count` tokens between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens between left and right.
	 */
	/**
	 * Gets the first `count` tokens between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens between left and right.
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
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CommentInclusiveCountOptions} options The option object.
	 * @returns {(Token | Comment)[]} Tokens between left and right.
	 */
	/**
	 * Gets the last `count` tokens between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {TokenOnlyCountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {Token[]} Tokens between left and right.
	 */
	/**
	 * Gets the last `count` tokens between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens between left and right.
	 */
	/**
	 * Gets the last `count` tokens between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CountOptions} [options] The option object. Same options as getFirstTokens()
	 * @returns {(Token | Comment)[]} Tokens between left and right.
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
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CommentInclusiveCountOptions} options The option object.
	 * @returns {(Token | Comment)[]} Array of objects representing tokens.
	 */
	/**
	 * Gets all tokens that are related to the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {TokenOnlyPaddingOptions} options The option object. If this is a function then it's `options.filter`.
	 * @returns {Token[]} Array of objects representing tokens.
	 */
	/**
	 * Gets all tokens that are related to the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {number} [beforeCount] The number of tokens before the node to retrieve.
	 * @param {number} [afterCount] The number of tokens after the node to retrieve.
	 * @returns {Token[]} Array of objects representing tokens.
	 */
	/**
	 * Gets all tokens that are related to the given node.
	 * @overload
	 * @param {NodeOrToken} node The AST node.
	 * @param {CountOptions} [beforeCount] The number of tokens before the node to retrieve, or the option object.
	 * @param {number} [afterCount] The number of tokens after the node to retrieve.
	 * @returns {(Token | Comment)[]} Array of objects representing tokens.
	 */
	/**
	 * Gets all tokens that are related to the given node.
	 * @param {NodeOrToken} node The AST node.
	 * @param {CountOptions} [beforeCount] The number of tokens before the node to retrieve, or the option object.
	 * @param {number} [afterCount] The number of tokens after the node to retrieve.
	 * @returns {(Token | Comment)[]} Array of objects representing tokens.
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
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CommentInclusiveCountOptions} padding The option object.
	 * @returns {(Token | Comment)[]} Tokens between left and right.
	 */
	/**
	 * Gets all of the tokens between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {TokenOnlyPaddingOptions} padding The option object. If this is a function then it's `options.filter`.
	 * @returns {Token[]} Tokens between left and right.
	 */
	/**
	 * Gets all of the tokens between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {number} [padding] Number of extra tokens on either side of center.
	 * @returns {Token[]} Tokens between left and right.
	 */
	/**
	 * Gets all of the tokens between two non-overlapping nodes.
	 * @overload
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CountOptions} [padding] Number of extra tokens on either side of center, or the option object.
	 * @returns {(Token | Comment)[]} Tokens between left and right.
	 */
	/**
	 * Gets all of the tokens between two non-overlapping nodes.
	 * @param {NodeOrToken} left Node before the desired token range.
	 * @param {NodeOrToken} right Node after the desired token range.
	 * @param {CountOptions} [padding] Number of extra tokens on either side of center, or the option object.
	 * @returns {(Token | Comment)[]} Tokens between left and right.
	 */
	getTokensBetween(left, right, padding) {
		/*
		 * ESCAPE HATCH: one `padding` value is passed for both sides, and the
		 * `afterCount` parameter is padding only — never the option object.
		 * `createCursorWithPadding` reaches that argument solely on the branch
		 * where it has already established that its `beforeCount` is a number
		 * or `undefined`, and both arguments here are the same value, so the
		 * assertion restates what that branch has proved rather than something
		 * this call site assumes.
		 */
		return createCursorWithPadding(
			this[TOKENS],
			this[COMMENTS],
			this[INDEX_MAP],
			left.range[1],
			right.range[0],
			padding,
			/** @type {number | undefined} */ (padding),
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
	 * @returns {Comment[]} An array of comments in occurrence order.
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
	 * @returns {Comment[]} An array of comments in occurrence order.
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
	 * @param {ASTNode} node The AST node to get the comments for.
	 * @returns {Comment[]} An array of comments in occurrence order.
	 */
	getCommentsInside(node) {
		/*
		 * ESCAPE HATCH: `filter: isCommentToken` leaves only comments in the
		 * result, but TypeScript cannot carry a predicate passed as an option
		 * into a return type, so the comment-inclusive overload's
		 * `(Token | Comment)[]` is the most it can say.
		 */
		return /** @type {Comment[]} */ (
			this.getTokens(node, {
				includeComments: true,
				filter: isCommentToken,
			})
		);
	}
};

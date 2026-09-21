/**
 * @fileoverview Virtual file
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//-----------------------------------------------------------------------------
// Type Definitions
//-----------------------------------------------------------------------------

/**
 * The file contents as ESLint receives them: text for ordinary files, bytes
 * for languages whose parser works on binary input.
 * @typedef {string | Uint8Array} VFileBody
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Determines if a given value has a byte order mark (BOM).
 * @param {VFileBody} value The value to check.
 * @returns {boolean} `true` if the value has a BOM, `false` otherwise.
 */
function hasUnicodeBOM(value) {
	return typeof value === "string"
		? value.charCodeAt(0) === 0xfeff
		: value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf;
}

/**
 * Strips Unicode BOM from the given value.
 * @param {VFileBody} value The value to remove the BOM from.
 * @returns {VFileBody} The stripped value.
 */
function stripUnicodeBOM(value) {
	if (!hasUnicodeBOM(value)) {
		return value;
	}

	if (typeof value === "string") {
		/*
		 * Check Unicode BOM.
		 * In JavaScript, string data is stored as UTF-16, so BOM is 0xFEFF.
		 * https://262.ecma-international.org/6.0/#sec-unicode-format-control-characters
		 */
		return value.slice(1);
	}

	/*
	 * In a Uint8Array, the BOM is represented by three bytes: 0xEF, 0xBB, and 0xBF,
	 * so we can just remove the first three bytes.
	 */
	return value.slice(3);
}

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * Represents a virtual file inside of ESLint.
 */
class VFile {
	/**
	 * The file path including any processor-created virtual path.
	 * @type {string}
	 * @readonly
	 */
	path;

	/**
	 * The file path on disk.
	 * @type {string}
	 * @readonly
	 */
	physicalPath;

	/**
	 * The file contents.
	 * @type {VFileBody}
	 * @readonly
	 */
	body;

	/**
	 * The raw body of the file, including a BOM if present.
	 * @type {VFileBody}
	 * @readonly
	 */
	rawBody;

	/**
	 * Indicates whether the file has a byte order mark (BOM).
	 * @type {boolean}
	 * @readonly
	 */
	bom;

	/**
	 * Creates a new instance.
	 * @param {string} path The file path.
	 * @param {VFileBody} body The file contents.
	 * @param {Object} [options] Additional options.
	 * @param {string} [options.physicalPath] The file path on disk.
	 */
	constructor(path, body, { physicalPath } = {}) {
		this.path = path;
		this.physicalPath = physicalPath ?? path;
		this.bom = hasUnicodeBOM(body);
		this.body = stripUnicodeBOM(body);
		this.rawBody = body;
	}
}

module.exports = { VFile };

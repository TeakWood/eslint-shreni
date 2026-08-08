// @ts-check
/**
 * @fileoverview Utility functions to locate the source text of each code unit in the value of a string literal or template token.
 * @author Francesco Trotta
 */

"use strict";

/**
 * Represents a code unit produced by the evaluation of a JavaScript common token like a string
 * literal or template token.
 */
class CodeUnit {
	/**
	 * @param {number} start The offset in the source text where this code unit begins.
	 * @param {string} source The source characters that produced this code unit.
	 */
	constructor(start, source) {
		this.start = start;
		this.source = source;
	}

	/**
	 * The offset in the source text just past this code unit.
	 * @type {number}
	 */
	get end() {
		return this.start + this.length;
	}

	/**
	 * The number of source characters this code unit was produced from.
	 * @type {number}
	 */
	get length() {
		return this.source.length;
	}
}

/**
 * An object used to keep track of the position in a source text where the next characters will be read.
 */
class TextReader {
	/**
	 * @param {string} source The source text to read from.
	 */
	constructor(source) {
		this.source = source;
		this.pos = 0;
	}

	/**
	 * Advances the reading position of the specified number of characters.
	 * @param {number} length Number of characters to advance.
	 * @returns {void}
	 */
	advance(length) {
		this.pos += length;
	}

	/**
	 * Reads characters from the source.
	 * @param {number} [offset=0] The offset where reading starts, relative to the current position.
	 * @param {number} [length=1] Number of characters to read.
	 * @returns {string} A substring of source characters.
	 */
	read(offset = 0, length = 1) {
		const start = offset + this.pos;

		return this.source.slice(start, start + length);
	}
}

/**
 * The escape sequences whose value is a single fixed character.
 *
 * `__proto__: null` gives the table no prototype, so a lookup keyed on an
 * arbitrary escape character cannot resolve to an inherited
 * `Object.prototype` member. See the widening at the one read site below —
 * this declaration deliberately carries no `@type`, because annotating it with
 * an index signature makes the `__proto__: null` member itself an error
 * (`null` is not a `string`).
 */
const SIMPLE_ESCAPE_SEQUENCES = {
	__proto__: null,
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
};

/**
 * Reads a hex escape sequence.
 * @param {TextReader} reader The reader should be positioned on the first hexadecimal digit.
 * @param {number} length The number of hexadecimal digits.
 * @returns {string} A code unit.
 */
function readHexSequence(reader, length) {
	const str = reader.read(0, length);
	const charCode = parseInt(str, 16);

	reader.advance(length);
	return String.fromCharCode(charCode);
}

/**
 * Reads a Unicode escape sequence.
 * @param {TextReader} reader The reader should be positioned after the "u".
 * @returns {string} A code unit.
 */
function readUnicodeSequence(reader) {
	const regExp = /\{(?<hexDigits>[\dA-F]+)\}/iuy;

	regExp.lastIndex = reader.pos;
	const match = regExp.exec(reader.source);

	if (match) {
		/*
		 * ESCAPE HATCH. `RegExpExecArray#groups` is typed `| undefined`
		 * because TypeScript cannot tell from a pattern's type whether it has
		 * named groups. This one does — `hexDigits` is the only group in the
		 * literal two lines up — so on a successful match `groups` is always
		 * present and `hexDigits` always a string.
		 */
		const codePoint = parseInt(
			/** @type {{hexDigits: string}} */ (match.groups).hexDigits,
			16,
		);

		reader.pos = regExp.lastIndex;
		return String.fromCodePoint(codePoint);
	}
	return readHexSequence(reader, 4);
}

/**
 * Reads an octal escape sequence.
 * @param {TextReader} reader The reader should be positioned after the first octal digit.
 * @param {number} maxLength The maximum number of octal digits.
 * @returns {string} A code unit.
 */
function readOctalSequence(reader, maxLength) {
	/*
	 * ESCAPE HATCH. `String#match` is typed `RegExpMatchArray | null`, so the
	 * destructuring is TS2461/TS18047 without a cast. The match cannot fail:
	 * the only caller is the `"0"`-`"7"` arms of the switch in
	 * `readEscapeSequenceOrLineContinuation`, and the `-1` offset re-reads that
	 * same digit, so `/^[0-7]+/u` matches at least one character by
	 * construction. The `maxLength` argument bounds how many more it may take.
	 */
	const [octalStr] = /** @type {RegExpMatchArray} */ (
		reader.read(-1, maxLength).match(/^[0-7]+/u)
	);

	reader.advance(octalStr.length - 1);
	const octal = parseInt(octalStr, 8);

	return String.fromCharCode(octal);
}

/**
 * Reads an escape sequence or line continuation.
 * @param {TextReader} reader The reader should be positioned on the backslash.
 * @returns {string} A string of zero, one or two code units.
 */
function readEscapeSequenceOrLineContinuation(reader) {
	const char = reader.read(1);

	reader.advance(2);

	/*
	 * ESCAPE HATCH, and the only one this `__proto__: null` table needs.
	 * The table's inferred type is an object literal — one property per escape
	 * character, plus `__proto__` typed `null` — so it admits no index access
	 * and `SIMPLE_ESCAPE_SEQUENCES[char]` is TS7053, the very lookup the table
	 * exists to serve. The widening goes through `unknown` because `null` is
	 * not a `string`, so a direct assertion is rejected; this follows the same
	 * form as `NODE_TYPES_BY_KEYWORD` in `./ast-utils.js`.
	 *
	 * The value is `string | undefined` rather than `string`: a miss is the
	 * common case, and the truthiness test below is what falls through to the
	 * switch. Typing it `string` would make that guard read as dead code.
	 */
	const unitChar = /** @type {Record<string, string | undefined>} */ (
		/** @type {unknown} */ (SIMPLE_ESCAPE_SEQUENCES)
	)[char];

	if (unitChar) {
		return unitChar;
	}
	switch (char) {
		case "x":
			return readHexSequence(reader, 2);
		case "u":
			return readUnicodeSequence(reader);
		case "\r":
			if (reader.read() === "\n") {
				reader.advance(1);
			}

		// fallthrough
		case "\n":
		case "\u2028":
		case "\u2029":
			return "";
		case "0":
		case "1":
		case "2":
		case "3":
			return readOctalSequence(reader, 3);
		case "4":
		case "5":
		case "6":
		case "7":
			return readOctalSequence(reader, 2);
		default:
			return char;
	}
}

/**
 * Reads an escape sequence or line continuation and generates the respective `CodeUnit` elements.
 * @param {TextReader} reader The reader should be positioned on the backslash.
 * @returns {Generator<CodeUnit>} Zero, one or two `CodeUnit` elements.
 */
function* mapEscapeSequenceOrLineContinuation(reader) {
	const start = reader.pos;
	const str = readEscapeSequenceOrLineContinuation(reader);
	const end = reader.pos;
	const source = reader.source.slice(start, end);

	switch (str.length) {
		case 0:
			break;
		case 1:
			yield new CodeUnit(start, source);
			break;
		default:
			yield new CodeUnit(start, source);
			yield new CodeUnit(start, source);
			break;
	}
}

/**
 * Parses a string literal.
 * @param {string} source The string literal to parse, including the delimiting quotes.
 * @returns {CodeUnit[]} A list of code units produced by the string literal.
 */
function parseStringLiteral(source) {
	const reader = new TextReader(source);
	const quote = reader.read();

	reader.advance(1);
	const codeUnits = [];

	for (;;) {
		const char = reader.read();

		if (char === quote) {
			break;
		}
		if (char === "\\") {
			codeUnits.push(...mapEscapeSequenceOrLineContinuation(reader));
		} else {
			codeUnits.push(new CodeUnit(reader.pos, char));
			reader.advance(1);
		}
	}
	return codeUnits;
}

/**
 * Parses a template token.
 * @param {string} source The template token to parse, including the delimiting sequences `` ` ``, `${` and `}`.
 * @returns {CodeUnit[]} A list of code units produced by the template token.
 */
function parseTemplateToken(source) {
	const reader = new TextReader(source);

	reader.advance(1);
	const codeUnits = [];

	for (;;) {
		const char = reader.read();

		if (char === "`" || (char === "$" && reader.read(1) === "{")) {
			break;
		}
		if (char === "\\") {
			codeUnits.push(...mapEscapeSequenceOrLineContinuation(reader));
		} else {
			let unitSource;

			if (char === "\r" && reader.read(1) === "\n") {
				unitSource = "\r\n";
			} else {
				unitSource = char;
			}
			codeUnits.push(new CodeUnit(reader.pos, unitSource));
			reader.advance(unitSource.length);
		}
	}
	return codeUnits;
}

module.exports = { parseStringLiteral, parseTemplateToken };

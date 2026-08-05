/**
 * @fileoverview An object that creates fix commands for rules.
 * @author Nicholas C. Zakas
 */
"use strict";

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/* eslint class-methods-use-this: off -- Methods desired on instance */

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

// none!

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Creates a fix command that inserts text at the specified index in the source text.
 * @param index The 0-based index at which to insert the new text.
 * @param text The text to insert.
 * @returns The fix command.
 * @private
 */
function insertTextAt(index, text) {
	return {
		range: [index, index],
		text,
	};
}

/**
 * Asserts that the provided text is a string.
 * @param text The text to validate.
 * @throws If `text` is not a string.
 */
function assertIsString(text) {
	if (typeof text !== "string") {
		throw new TypeError("'text' must be a string");
	}
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Creates code fixing commands for rules.
 */
class RuleFixer {
	/**
	 * The source code object representing the text to be fixed.
	 */
	#sourceCode;

	/**
	 * Creates a new instance.
	 * @param options The options for the fixer.
	 * @param options.sourceCode The source code object representing the text to be fixed.
	 */
	constructor({ sourceCode }) {
		this.#sourceCode = sourceCode;
	}

	/**
	 * Creates a fix command that inserts text after the given node or token.
	 * The fix is not applied until applyFixes() is called.
	 * @param nodeOrToken The node or token to insert after.
	 * @param text The text to insert.
	 * @returns The fix command.
	 * @throws If `text` is not a string.
	 */
	insertTextAfter(nodeOrToken, text) {
		assertIsString(text);

		const range = this.#sourceCode.getRange(nodeOrToken);

		return this.insertTextAfterRange(range, text);
	}

	/**
	 * Creates a fix command that inserts text after the specified range in the source text.
	 * The fix is not applied until applyFixes() is called.
	 * @param range The range to replace, first item is start of range, second
	 *      is end of range.
	 * @param text The text to insert.
	 * @returns The fix command.
	 * @throws If `text` is not a string.
	 */
	insertTextAfterRange(range, text) {
		assertIsString(text);

		return insertTextAt(range[1], text);
	}

	/**
	 * Creates a fix command that inserts text before the given node or token.
	 * The fix is not applied until applyFixes() is called.
	 * @param nodeOrToken The node or token to insert before.
	 * @param text The text to insert.
	 * @returns The fix command.
	 * @throws If `text` is not a string.
	 */
	insertTextBefore(nodeOrToken, text) {
		assertIsString(text);

		const range = this.#sourceCode.getRange(nodeOrToken);

		return this.insertTextBeforeRange(range, text);
	}

	/**
	 * Creates a fix command that inserts text before the specified range in the source text.
	 * The fix is not applied until applyFixes() is called.
	 * @param range The range to replace, first item is start of range, second
	 *      is end of range.
	 * @param text The text to insert.
	 * @returns The fix command.
	 * @throws If `text` is not a string.
	 */
	insertTextBeforeRange(range, text) {
		assertIsString(text);

		return insertTextAt(range[0], text);
	}

	/**
	 * Creates a fix command that replaces text at the node or token.
	 * The fix is not applied until applyFixes() is called.
	 * @param nodeOrToken The node or token to remove.
	 * @param text The text to insert.
	 * @returns The fix command.
	 * @throws If `text` is not a string.
	 */
	replaceText(nodeOrToken, text) {
		assertIsString(text);

		const range = this.#sourceCode.getRange(nodeOrToken);

		return this.replaceTextRange(range, text);
	}

	/**
	 * Creates a fix command that replaces text at the specified range in the source text.
	 * The fix is not applied until applyFixes() is called.
	 * @param range The range to replace, first item is start of range, second
	 *      is end of range.
	 * @param text The text to insert.
	 * @returns The fix command.
	 * @throws If `text` is not a string.
	 */
	replaceTextRange(range, text) {
		assertIsString(text);

		return {
			range,
			text,
		};
	}

	/**
	 * Creates a fix command that removes the node or token from the source.
	 * The fix is not applied until applyFixes() is called.
	 * @param nodeOrToken The node or token to remove.
	 * @returns The fix command.
	 */
	remove(nodeOrToken) {
		const range = this.#sourceCode.getRange(nodeOrToken);

		return this.removeRange(range);
	}

	/**
	 * Creates a fix command that removes the specified range of text from the source.
	 * The fix is not applied until applyFixes() is called.
	 * @param range The range to remove, first item is start of range, second
	 *      is end of range.
	 * @returns The fix command.
	 */
	removeRange(range) {
		return {
			range,
			text: "",
		};
	}
}

module.exports = { RuleFixer };

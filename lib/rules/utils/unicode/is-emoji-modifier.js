/**
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

/**
 * Check whether a given character is an emoji modifier.
 * @param code The character code to check.
 * @returns `true` if the character is an emoji modifier.
 */
module.exports = function isEmojiModifier(code) {
	return code >= 0x1f3fb && code <= 0x1f3ff;
};

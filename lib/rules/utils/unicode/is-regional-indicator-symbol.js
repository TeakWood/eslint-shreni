/**
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

/**
 * Check whether a given character is a regional indicator symbol.
 * @param code The character code to check.
 * @returns `true` if the character is a regional indicator symbol.
 */
module.exports = function isRegionalIndicatorSymbol(code) {
	return code >= 0x1f1e6 && code <= 0x1f1ff;
};

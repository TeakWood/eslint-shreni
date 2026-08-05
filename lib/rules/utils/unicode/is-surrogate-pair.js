/**
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

/**
 * Check whether given two characters are a surrogate pair.
 * @param lead The code of the lead character.
 * @param tail The code of the tail character.
 * @returns `true` if the character pair is a surrogate pair.
 */
module.exports = function isSurrogatePair(lead, tail) {
	return lead >= 0xd800 && lead < 0xdc00 && tail >= 0xdc00 && tail < 0xe000;
};

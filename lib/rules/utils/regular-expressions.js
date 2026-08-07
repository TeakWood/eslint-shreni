// @ts-check
/**
 * @fileoverview Common utils for regular expressions.
 * @author Josh Goldberg
 * @author Toru Nagashima
 */

"use strict";

const { RegExpValidator } = require("@eslint-community/regexpp");

/** @import { EcmaVersion } from "../../types/core.js" */
/** @import { EcmaVersion as RegexppEcmaVersion } from "@eslint-community/regexpp/ecma-versions" */

const REGEXPP_LATEST_ECMA_VERSION = 2025;

/**
 * Checks if the given regular expression pattern would be valid with the `u` flag.
 * @param {EcmaVersion} ecmaVersion ECMAScript version to parse in.
 * @param {string} pattern The regular expression pattern to verify.
 * @param {"u" | "v"} [flag] The type of Unicode flag
 * @returns {boolean} `true` if the pattern would be valid with the `u` flag.
 * `false` if the pattern would be invalid with the `u` flag or the configured
 * ecmaVersion doesn't support the `u` flag.
 */
function isValidWithUnicodeFlag(ecmaVersion, pattern, flag = "u") {
	if (flag === "u" && ecmaVersion <= 5) {
		// ecmaVersion <= 5 doesn't support the 'u' flag
		return false;
	}
	if (flag === "v" && ecmaVersion <= 2023) {
		return false;
	}

	const validator = new RegExpValidator({
		/*
		 * ESCAPE HATCH: cast to regexpp's `EcmaVersion`. Reason: regexpp types
		 * the option as a union of the exact year literals it supports, but
		 * `Math.min` widens to `number`. The clamp above is what guarantees the
		 * value is one regexpp accepts, and that guarantee is not expressible
		 * to the compiler.
		 */
		ecmaVersion: /** @type {RegexppEcmaVersion} */ (
			Math.min(ecmaVersion, REGEXPP_LATEST_ECMA_VERSION)
		),
	});

	try {
		validator.validatePattern(
			pattern,
			void 0,
			void 0,
			flag === "u"
				? {
						unicode: /* uFlag = */ true,
					}
				: {
						unicodeSets: true,
					},
		);
	} catch {
		return false;
	}

	return true;
}

module.exports = {
	isValidWithUnicodeFlag,
	REGEXPP_LATEST_ECMA_VERSION,
};

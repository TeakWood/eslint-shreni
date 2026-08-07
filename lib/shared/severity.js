// @ts-check
/**
 * @fileoverview Helpers for severity values (e.g. normalizing different types).
 * @author Bryan Mishkin
 */

"use strict";

/** @import { Severity, SeverityName, SeverityLevel } from "../types/core.js" */

/**
 * Convert severity value of different types to a string.
 * @param {Severity} severity severity value
 * @throws error if severity is invalid
 * @returns {SeverityName} severity string
 */
function normalizeSeverityToString(severity) {
	if ([2, "2", "error"].includes(severity)) {
		return "error";
	}
	if ([1, "1", "warn"].includes(severity)) {
		return "warn";
	}
	if ([0, "0", "off"].includes(severity)) {
		return "off";
	}
	throw new Error(`Invalid severity value: ${severity}`);
}

/**
 * Convert severity value of different types to a number.
 * @param {Severity} severity severity value
 * @throws error if severity is invalid
 * @returns {SeverityLevel} severity number
 */
function normalizeSeverityToNumber(severity) {
	if ([2, "2", "error"].includes(severity)) {
		return 2;
	}
	if ([1, "1", "warn"].includes(severity)) {
		return 1;
	}
	if ([0, "0", "off"].includes(severity)) {
		return 0;
	}
	throw new Error(`Invalid severity value: ${severity}`);
}

module.exports = {
	normalizeSeverityToString,
	normalizeSeverityToNumber,
};

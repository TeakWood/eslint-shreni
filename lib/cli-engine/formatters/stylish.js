// @ts-check
/**
 * @fileoverview Stylish reporter
 * @author Sindre Sorhus
 */
"use strict";

const util = require("node:util"),
	table = require("../../shared/text-table");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @import { Formatter } from "../../types/core.js" */

/**
 * The `util.styleText` formats this reporter uses — the complete set, and each
 * is checked against Node's own declaration at the call sites below.
 *
 * Deliberately NOT derived as `Parameters<typeof util.styleText>[0]`. That
 * derivation is more faithful but emits `import util = require("node:util")`
 * into `stylish.d.ts`, which cannot resolve in the standalone, `types: []`
 * program the declaration-emit gate compiles the output with.
 * @typedef {"bold" | "dim" | "red" | "reset" | "underline" | "yellow"} StyleFormat
 */

/**
 * Applies (or, when color is off, does not apply) a format to a string.
 * @typedef {(format: StyleFormat, text: string) => string} StyleText
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Returns a styling function based on the color option.
 * @param {boolean} [color] Indicates whether to use colors.
 * @returns {StyleText} A function that styles text.
 */
function getStyleText(color) {
	if (typeof color === "undefined") {
		return (format, text) =>
			util.styleText(format, text, { validateStream: true });
	}
	if (color) {
		return (format, text) =>
			util.styleText(format, text, { validateStream: false });
	}
	return (_, text) => text;
}

/**
 * Given a word and a count, append an s if count is not one.
 * @param {string} word A word in its singular form.
 * @param {number} count A number controlling whether word should be pluralized.
 * @returns {string} The original word with an s on the end if count is not one.
 */
function pluralize(word, count) {
	return count === 1 ? word : `${word}s`;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Renders the results as an aligned, optionally colorized terminal report.
 * @type {Formatter}
 */
module.exports = function (results, data) {
	const styleText = getStyleText(data?.color);

	let output = "\n",
		errorCount = 0,
		warningCount = 0,
		fixableErrorCount = 0,
		fixableWarningCount = 0;

	/**
	 * Annotated because inference from the initializer alone would widen this
	 * to `string`, which `util.styleText` does not accept — it takes a closed
	 * union of color and modifier names.
	 * @type {"yellow" | "red"}
	 */
	let summaryColor = "yellow";

	results.forEach(result => {
		const messages = result.messages;

		if (messages.length === 0) {
			return;
		}

		errorCount += result.errorCount;
		warningCount += result.warningCount;
		fixableErrorCount += result.fixableErrorCount;
		fixableWarningCount += result.fixableWarningCount;

		output += `${styleText("underline", result.filePath)}\n`;

		output += `${table(
			messages.map(message => {
				let messageType;

				if (message.fatal || message.severity === 2) {
					messageType = styleText("red", "error");
					summaryColor = "red";
				} else {
					messageType = styleText("yellow", "warning");
				}

				return [
					"",
					String(message.line || 0),
					String(message.column || 0),
					messageType,
					message.message.replace(/([^ ])\.$/u, "$1"),
					message.ruleId ? styleText("dim", message.ruleId) : "",
				];
			}),
			{
				align: ["", "r", "l"],
				stringLength(str) {
					return util.stripVTControlCharacters(str).length;
				},
			},
		)
			.split("\n")
			.map(el =>
				el.replace(/(\d+)\s+(\d+)/u, (m, p1, p2) =>
					styleText("dim", `${p1}:${p2}`),
				),
			)
			.join("\n")}\n\n`;
	});

	const total = errorCount + warningCount;

	/*
	 * We can't use a single `styleText` call like `styleText([summaryColor, "bold"], text)` here.
	 * This is a bug in `util.styleText` in Node.js versions earlier than v22.15.0 (https://github.com/nodejs/node/issues/56717).
	 * As a workaround, we use nested `styleText` calls.
	 */
	if (total > 0) {
		output += `${styleText(
			summaryColor,
			styleText(
				"bold",
				[
					"\u2716 ",
					total,
					pluralize(" problem", total),
					" (",
					errorCount,
					pluralize(" error", errorCount),
					", ",
					warningCount,
					pluralize(" warning", warningCount),
					")",
				].join(""),
			),
		)}\n`;

		if (fixableErrorCount > 0 || fixableWarningCount > 0) {
			output += `${styleText(
				summaryColor,
				styleText(
					"bold",
					[
						"  ",
						fixableErrorCount,
						pluralize(" error", fixableErrorCount),
						" and ",
						fixableWarningCount,
						pluralize(" warning", fixableWarningCount),
						" potentially fixable with the `--fix` option.",
					].join(""),
				),
			)}\n`;
		}
	}

	// Resets output color, for prevent change on top level
	return total > 0 ? styleText("reset", output) : "";
};

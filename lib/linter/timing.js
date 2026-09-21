/**
 * @fileoverview Tracks performance of individual rules.
 * @author Brandon Mills
 */

// @ts-check

"use strict";

const { startTime, endTime } = require("../shared/stats");

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/**
 * Accumulated rule timings, keyed by rule ID and measured in milliseconds.
 * @typedef {Record<string, number>} TimingData
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/* c8 ignore next */
/**
 * Align the string to left
 * @param {string} str string to evaluate
 * @param {number} len length of the string
 * @param {string} [ch] delimiter character
 * @returns {string} modified string
 * @private
 */
function alignLeft(str, len, ch) {
	return str + new Array(len - str.length + 1).join(ch || " ");
}

/* c8 ignore next */
/**
 * Align the string to right
 * @param {string} str string to evaluate
 * @param {number} len length of the string
 * @param {string} [ch] delimiter character
 * @returns {string} modified string
 * @private
 */
function alignRight(str, len, ch) {
	return new Array(len - str.length + 1).join(ch || " ") + str;
}

//------------------------------------------------------------------------------
// Module definition
//------------------------------------------------------------------------------

const enabled = !!process.env.TIMING;

const HEADERS = ["Rule", "Time (ms)", "Relative"];
const ALIGN = [alignLeft, alignRight, alignRight];

/**
 * Decide how many rules to show in the output list.
 * @returns {number} the number of rules to show
 */
function getListSize() {
	const MINIMUM_SIZE = 10;

	if (typeof process.env.TIMING !== "string") {
		return MINIMUM_SIZE;
	}

	if (process.env.TIMING.toLowerCase() === "all") {
		return Number.POSITIVE_INFINITY;
	}

	const TIMING_ENV_VAR_AS_INTEGER = Number.parseInt(process.env.TIMING, 10);

	return TIMING_ENV_VAR_AS_INTEGER > 10
		? TIMING_ENV_VAR_AS_INTEGER
		: MINIMUM_SIZE;
}

/* c8 ignore next */
/**
 * display the data
 * @param {TimingData} data Data object to be displayed
 * @returns {void} prints modified string with console.log
 * @private
 */
function display(data) {
	let total = 0;

	/*
	 * A row starts life as `[ruleId, milliseconds]` and is rewritten in place
	 * below into `[ruleId, formattedTime, percentage]`, so the element type is
	 * the union of both stages. Each read asserts the stage it runs in.
	 */
	const rows = Object.keys(data)
		.map(key => {
			const time = data[key];

			total += time;
			return /** @type {Array<string | number>} */ ([key, time]);
		})
		.sort(
			(a, b) =>
				/** @type {number} */ (b[1]) - /** @type {number} */ (a[1]),
		)
		.slice(0, getListSize());

	rows.forEach(row => {
		const time = /** @type {number} */ (row[1]);

		row.push(`${((time * 100) / total).toFixed(1)}%`);
		row[1] = time.toFixed(3);
	});

	/*
	 * Copied rather than shared: the header row joins a list of mutable
	 * `Array<string | number>` rows, and nothing below mutates it anyway.
	 */
	rows.unshift([...HEADERS]);

	/** @type {Array<number>} */
	const widths = [];

	rows.forEach(row => {
		const len = row.length;

		for (let i = 0; i < len; i++) {
			// Every cell is a string by now: the `forEach` above formatted them.
			const n = /** @type {string} */ (row[i]).length;

			if (!widths[i] || n > widths[i]) {
				widths[i] = n;
			}
		}
	});

	const table = rows.map(row =>
		row
			.map((cell, index) =>
				ALIGN[index](/** @type {string} */ (cell), widths[index]),
			)
			.join(" | "),
	);

	table.splice(
		1,
		0,
		widths
			.map((width, index) => {
				const extraAlignment =
					index !== 0 && index !== widths.length - 1 ? 2 : 1;

				return ALIGN[index](":", width + extraAlignment, "-");
			})
			.join("|"),
	);

	console.log(table.join("\n")); // eslint-disable-line no-console -- Debugging function
}

/* c8 ignore next */
module.exports = (function () {
	/** @type {TimingData} */
	const data = Object.create(null);
	let displayEnabled = true;

	/**
	 * Time the run
	 * @param {string} key key from the data object
	 * @param {(...args: Array<any>) => any} fn function to be called
	 * @param {boolean} [stats] if 'stats' is true, return the result and the time difference
	 * @returns {(...args: Array<any>) => any} function to be executed
	 * @private
	 */
	function time(key, fn, stats) {
		return function (...args) {
			const t = startTime();
			const result = fn(...args);
			const tdiff = endTime(t);

			if (enabled) {
				if (typeof data[key] === "undefined") {
					data[key] = 0;
				}

				data[key] += tdiff;
			}

			return stats ? { result, tdiff } : result;
		};
	}

	/**
	 * Returns a shallow copy of the collected timings data.
	 * @returns {TimingData} mapping of ruleId to total time in ms
	 */
	function getData() {
		return { ...data };
	}

	/**
	 * Merges rule timing totals collected elsewhere into this process' totals.
	 * @param {TimingData} dataToMerge mapping of ruleId to total time in ms
	 * @returns {void}
	 */
	function mergeData(dataToMerge) {
		for (const [key, value] of Object.entries(dataToMerge)) {
			if (typeof data[key] === "undefined") {
				data[key] = 0;
			}
			data[key] += value;
		}
	}

	/**
	 * Disables printing of timing data on process exit.
	 * Intended for worker threads or non-main contexts.
	 * @returns {void}
	 */
	function disableDisplay() {
		displayEnabled = false;
	}

	if (enabled) {
		process.on("exit", () => {
			if (displayEnabled && Object.keys(data).length > 0) {
				display(data);
			}
		});
	}

	return {
		time,
		enabled,
		getListSize,
		getData,
		mergeData,
		disableDisplay,
	};
})();

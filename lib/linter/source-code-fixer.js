// @ts-check
/**
 * @fileoverview An object that caches and applies source code fixes.
 * @author Nicholas C. Zakas
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const debug = require("debug")("eslint:source-code-fixer");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").EditInfo} EditInfo */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */

/**
 * A message that carries a fix, as the sorting and application paths below
 * require. `LintMessage.fix` is optional, and the messages are partitioned on
 * it before either path sees them.
 * @typedef {LintMessage & { fix: EditInfo }} FixableLintMessage
 */

/**
 * Decides whether a given problem should be fixed. `true` (or an absent value)
 * fixes everything, `false` fixes nothing.
 * @typedef {boolean | ((message: LintMessage) => boolean)} ShouldFix
 */

/**
 * The outcome of a fix pass.
 * @typedef {Object} FixReport
 * @property {boolean} fixed `true` when at least one fix was applied.
 * @property {LintMessage[]} messages The messages that were not fixed.
 * @property {string} output The source text with the applied fixes.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const BOM = "\uFEFF";

/**
 * Compares items in a messages array by range.
 * @param {FixableLintMessage} a The first message.
 * @param {FixableLintMessage} b The second message.
 * @returns {number} -1 if a comes before b, 1 if a comes after b, 0 if equal.
 * @private
 */
function compareMessagesByFixRange(a, b) {
	return a.fix.range[0] - b.fix.range[0] || a.fix.range[1] - b.fix.range[1];
}

/**
 * Compares items in a messages array by line and column.
 * @param {LintMessage} a The first message.
 * @param {LintMessage} b The second message.
 * @returns {number} -1 if a comes before b, 1 if a comes after b, 0 if equal.
 * @private
 */
function compareMessagesByLocation(a, b) {
	/*
	 * A message need not carry a position, and subtracting an absent one gives
	 * `NaN`, which `sort()` treats as "equal" and `||` falls through. The
	 * defaults state that rather than change the ordering.
	 */
	return (
		(a.line ?? NaN) - (b.line ?? NaN) ||
		(a.column ?? NaN) - (b.column ?? NaN)
	);
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Utility for apply fixes to source code.
 * @constructor
 */
function SourceCodeFixer() {
	Object.freeze(this);
}

/**
 * Applies the fixes specified by the messages to the given text. Tries to be
 * smart about the fixes and won't apply fixes over the same area in the text.
 * @param {string} sourceText The text to apply the changes to.
 * @param {LintMessage[]} messages The array of messages reported by ESLint.
 * @param {ShouldFix} [shouldFix=true] Determines whether each message should be fixed
 * @returns {FixReport} An object containing the fixed text and any unfixed messages.
 */
SourceCodeFixer.applyFixes = function (sourceText, messages, shouldFix) {
	debug("Applying fixes");

	if (shouldFix === false) {
		debug("shouldFix parameter was false, not attempting fixes");
		return {
			fixed: false,
			messages,
			output: sourceText,
		};
	}

	// clone the array
	const /** @type {LintMessage[]} */ remainingMessages = [],
		/** @type {FixableLintMessage[]} */ fixes = [],
		bom = sourceText.startsWith(BOM) ? BOM : "",
		text = bom ? sourceText.slice(1) : sourceText;
	let lastPos = Number.NEGATIVE_INFINITY,
		output = bom;

	/**
	 * Try to use the 'fix' from a problem.
	 * @param {FixableLintMessage} problem The message object to apply fixes from
	 * @returns {boolean} Whether fix was successfully applied
	 */
	function attemptFix(problem) {
		const fix = problem.fix;
		const start = fix.range[0];
		const end = fix.range[1];

		// Remain it as a problem if it's overlapped or it's a negative range
		if (lastPos >= start || start > end) {
			remainingMessages.push(problem);
			return false;
		}

		// Remove BOM.
		if (
			(start < 0 && end >= 0) ||
			(start === 0 && fix.text.startsWith(BOM))
		) {
			output = "";
		}

		// Make output to this fix.
		output += text.slice(Math.max(0, lastPos), Math.max(0, start));
		output += fix.text;
		lastPos = end;
		return true;
	}

	messages.forEach(problem => {
		if (Object.hasOwn(problem, "fix") && problem.fix) {
			/*
			 * `problem.fix` is checked truthy just above, which does not
			 * narrow `problem` itself to the `fix`-bearing form.
			 */
			fixes.push(/** @type {FixableLintMessage} */ (problem));
		} else {
			remainingMessages.push(problem);
		}
	});

	if (fixes.length) {
		debug("Found fixes to apply");
		let fixesWereApplied = false;

		for (const problem of fixes.sort(compareMessagesByFixRange)) {
			if (typeof shouldFix !== "function" || shouldFix(problem)) {
				attemptFix(problem);

				/*
				 * The only time attemptFix will fail is if a previous fix was
				 * applied which conflicts with it.  So we can mark this as true.
				 */
				fixesWereApplied = true;
			} else {
				remainingMessages.push(problem);
			}
		}
		output += text.slice(Math.max(0, lastPos));

		return {
			fixed: fixesWereApplied,
			messages: remainingMessages.sort(compareMessagesByLocation),
			output,
		};
	}

	debug("No fixes to apply");
	return {
		fixed: false,
		messages,
		output: bom + text,
	};
};

module.exports = SourceCodeFixer;

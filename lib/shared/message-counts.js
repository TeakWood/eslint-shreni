/**
 * @fileoverview Helpers for counting errors and warnings in lint messages.
 * @author Nicholas C. Zakas
 * @author Blake Sager
 */

"use strict";

/** @typedef {import("./types.js").LintMessage} LintMessage */
/** @typedef {import("./types.js").LintMessageCounts} LintMessageCounts */

/**
 * It will calculate the error and warning count for collection of messages per file
 * @param {Array<LintMessage>} messages Collection of messages
 * @returns {LintMessageCounts} Contains the stats
 */
function calculateStatsPerFile(messages) {
	const stat = {
		errorCount: 0,
		fatalErrorCount: 0,
		warningCount: 0,
		fixableErrorCount: 0,
		fixableWarningCount: 0,
	};

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];

		if (message.fatal || message.severity === 2) {
			stat.errorCount++;
			if (message.fatal) {
				stat.fatalErrorCount++;
			}
			if (message.fix) {
				stat.fixableErrorCount++;
			}
		} else {
			stat.warningCount++;
			if (message.fix) {
				stat.fixableWarningCount++;
			}
		}
	}
	return stat;
}

module.exports = {
	calculateStatsPerFile,
};

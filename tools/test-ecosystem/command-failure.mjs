/**
 * @fileoverview Turns a failed `spawn.sync()` result into a diagnosable message.
 *
 * Ecosystem plugins are tested by spawning their own test runners. Those runners
 * report which assertions failed on **stdout** and write only a terse summary to
 * stderr, so an error built from stderr alone (`ERROR: "test:js" exited with 1.`)
 * names the failing script and nothing else. Every stream that was captured is
 * therefore included here, tail-first, so a CI log is enough to diagnose a
 * failure without re-running it locally.
 * @author Navakanth Gandavarapu
 */

//-----------------------------------------------------------------------------
// Constants
//-----------------------------------------------------------------------------

/**
 * How many trailing lines of each captured stream to include. Test runners put
 * their failure summary last, so the tail is the informative end, and a cap
 * keeps a runaway build log from burying it.
 */
export const TAIL_LINE_COUNT = 100;

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Renders one captured stream for inclusion in a failure message.
 * @param {string | Buffer | null | undefined} stream The captured stream, or
 * `null`/`undefined` when the stream was inherited rather than captured.
 * @param {number} tailLineCount How many trailing lines to keep.
 * @returns {string} A human-readable rendering, never empty.
 */
function renderStream(stream, tailLineCount) {
	if (stream === null || stream === undefined) {
		return "<inherited by this process; see the output above>";
	}

	const text = stream.toString().trimEnd();

	if (text === "") {
		return "<empty>";
	}

	const lines = text.split("\n");

	if (lines.length <= tailLineCount) {
		return text;
	}

	return [
		`<${lines.length - tailLineCount} earlier lines omitted>`,
		...lines.slice(-tailLineCount),
	].join("\n");
}

//-----------------------------------------------------------------------------
// Functions
//-----------------------------------------------------------------------------

/**
 * Describes why a spawned command failed, or reports that it did not.
 *
 * A `spawn.sync()` result reports failure three different ways, and only one of
 * them is a non-zero `status`: a command that could not be launched at all, and
 * one killed by a signal, both come back with `status === null`. Treating that
 * as success would turn a crashed test runner into a green build.
 * @param {string[]} commandParts The command and its arguments, as spawned.
 * @param {object} result The `spawn.sync()` result to inspect.
 * @param {object} [options] Options.
 * @param {number} [options.tailLineCount] How many trailing lines of each
 * captured stream to include.
 * @returns {string | null} A failure message, or `null` if the command succeeded.
 */
export function describeCommandFailure(
	commandParts,
	result,
	{ tailLineCount = TAIL_LINE_COUNT } = {},
) {
	if (result.status === 0 && !result.error && !result.signal) {
		return null;
	}

	let reason;

	if (result.error) {
		reason = `could not be run: ${result.error.message}`;
	} else if (result.signal) {
		reason = `was killed by ${result.signal}`;
	} else if (result.status === null || result.status === undefined) {
		reason = "did not report an exit code";
	} else {
		reason = `exited with code ${result.status}`;
	}

	return [
		`Command \`${commandParts.join(" ")}\` ${reason}.`,
		`--- stdout ---\n${renderStream(result.stdout, tailLineCount)}`,
		`--- stderr ---\n${renderStream(result.stderr, tailLineCount)}`,
	].join("\n\n");
}

/**
 * @fileoverview Tests for the build targets in Makefile.js.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "../..");
const MAKEFILE = path.join(REPO_ROOT, "Makefile.js");
const SHELLJS = require.resolve("shelljs");

/**
 * Source for a child process that loads Makefile.js with `shelljs.exec`
 * replaced by a recorder, runs one target, and writes what that target tried
 * to run to a file.
 *
 * Makefile.js captures `exec` and `echo` by destructuring them at load time,
 * so the stubs have to be installed on the `shelljs` module object before
 * Makefile.js is required. `shelljs/make` schedules the argv-named target on a
 * zero-delay timer; exiting synchronously keeps that from firing. Results go
 * to a file rather than stdout, and are written from an `exit` handler,
 * because a failing target calls `process.exit()` itself.
 * @param {string} targetName The target to invoke.
 * @param {string} resultPath Where the child writes its JSON result.
 * @param {string} failPattern Source of a regex matching the command that
 * should report failure, or "" for a run where everything succeeds.
 * @returns {string} The child program.
 */
function harnessSource(targetName, resultPath, failPattern) {
	return `
"use strict";
const fs = require("node:fs");
const shelljs = require(${JSON.stringify(SHELLJS)});
const commands = [];
const messages = [];
const failing = ${JSON.stringify(failPattern)};

/*
 * Stand in for the real c8, which creates its temp directory and writes a
 * coverage profile into it. Without that the cleanup assertion below would
 * hold trivially.
 */
shelljs.exec = command => {
	commands.push(command);
	const tempDirectory = /--temp-directory "([^"]+)"/u.exec(command);
	if (tempDirectory && command.includes(" -- ")) {
		fs.mkdirSync(tempDirectory[1], { recursive: true });
		fs.writeFileSync(tempDirectory[1] + "/coverage-0.json", "{}");
	}
	const failed = failing !== "" && new RegExp(failing, "u").test(command);
	return { code: failed ? 1 : 0 };
};
shelljs.echo = message => {
	messages.push(String(message));
};

process.on("exit", () => {
	const tempDirectories = commands
		.map(command => /--temp-directory "([^"]+)"/u.exec(command))
		.filter(match => match !== null)
		.map(match => match[1]);

	fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
		commands,
		messages,
		tempDirectories,
		survivingTempDirectories: tempDirectories.filter(directory =>
			fs.existsSync(directory)),
	}));
});

process.argv = [process.argv[0], ${JSON.stringify(MAKEFILE)}, "--help"];
require(${JSON.stringify(MAKEFILE)});
global.target[${JSON.stringify(targetName)}]();
process.exit(0);
`;
}

/**
 * Runs a Makefile.js target in a child process with `shelljs.exec` recorded
 * rather than executed.
 * @param {string} targetName The target to invoke.
 * @param {string} [failPattern] Source of a regex matching the command that
 * should report failure.
 * @returns {Promise<Object>} What the target ran, what it printed, the temp
 * directories it chose, and any that outlived it.
 */
async function captureTarget(targetName, failPattern = "") {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "eslint-makefile-"));
	const resultPath = path.join(scratch, "result.json");
	const programPath = path.join(scratch, "harness.js");

	fs.writeFileSync(
		programPath,
		harnessSource(targetName, resultPath, failPattern),
	);

	try {
		/*
		 * The target names its coverage directory relative to the working
		 * directory, so the child runs in the scratch directory rather than
		 * the repository -- a case that fails partway through should not be
		 * able to leave anything behind in `coverage/`. Nothing Makefile.js
		 * does at load time reads the working directory, and the commands it
		 * builds are recorded rather than run.
		 *
		 * A target that fails exits non-zero, which `execFile` surfaces as a
		 * rejection. The result file is written either way.
		 */
		await execFileAsync(process.execPath, [programPath], {
			cwd: scratch,
		}).catch(error => {
			if (!fs.existsSync(resultPath)) {
				throw error;
			}
		});
		return JSON.parse(fs.readFileSync(resultPath, "utf8"));
	} finally {
		fs.rmSync(scratch, { force: true, recursive: true });
	}
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("Makefile.js", () => {
	describe("the mocha target", function () {
		// Each case loads Makefile.js in a fresh child process.
		this.timeout(30000); // eslint-disable-line no-invalid-this -- Mocha context

		let captured;

		before(async () => {
			captured = await captureTarget("mocha");
		});

		it("runs the suite and then checks coverage", () => {
			assert.strictEqual(captured.commands.length, 2);
			assert.match(captured.commands[0], /_mocha/u);
			assert.match(captured.commands[0], /--forbid-only/u);
			assert.match(captured.commands[1], /\bcheck-coverage\b/u);
		});

		/*
		 * `c8` deletes its temp directory before starting the process it
		 * instruments (`--clean` defaults to true). The default location is
		 * derived from the repository rather than from the run, so two
		 * overlapping invocations -- `npm test` and `npm run test:coverage`
		 * are separate commands a CI job may run concurrently -- would share
		 * it, and one would delete the profile the other still needs. The
		 * loser's `check-coverage` reads a partial profile and fails its
		 * thresholds with every test passing.
		 */
		it("gives each invocation its own coverage temp directory", () => {
			assert.strictEqual(captured.tempDirectories.length, 2);
			assert.notStrictEqual(
				captured.tempDirectories[0],
				path.join("coverage", "tmp"),
			);
		});

		/*
		 * `check-coverage` reads back what the instrumented run wrote, so
		 * pointing only the first call at the private directory would leave
		 * the second one reading the shared default -- the same collision,
		 * just harder to see.
		 */
		it("points both c8 calls at that one directory", () => {
			assert.strictEqual(
				captured.tempDirectories[0],
				captured.tempDirectories[1],
			);
		});

		it("does not leave the raw coverage profile behind", () => {
			assert.deepStrictEqual(captured.survivingTempDirectories, []);
		});

		it("picks a different directory in a concurrent run", async () => {
			const other = await captureTarget("mocha");

			assert.notStrictEqual(
				captured.tempDirectories[0],
				other.tempDirectories[0],
			);
		});

		it("says nothing about failure when everything passes", () => {
			assert.deepStrictEqual(
				captured.messages.filter(message =>
					message.startsWith("FAILED:"),
				),
				[],
			);
		});

		/*
		 * A coverage-threshold failure prints `ERROR: Coverage for ...` and no
		 * mocha summary, so a run failing only there is red with no failing
		 * test to point at -- the "unknown number of failing" this names.
		 */
		it("names the coverage thresholds when only they fail", async () => {
			const result = await captureTarget("mocha", "check-coverage");

			assert.strictEqual(
				result.messages.at(-1),
				"FAILED: the coverage thresholds.",
			);
		});

		it("names the unit tests when only they fail", async () => {
			const result = await captureTarget("mocha", " -- ");

			assert.strictEqual(
				result.messages.at(-1),
				"FAILED: the unit tests.",
			);
		});

		it("still removes the profile when the run fails", async () => {
			const result = await captureTarget("mocha", "check-coverage");

			assert.deepStrictEqual(result.survivingTempDirectories, []);
		});
	});
});

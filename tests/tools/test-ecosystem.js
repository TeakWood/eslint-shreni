/**
 * @fileoverview Tests for the ecosystem plugin test harness.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert;
const fs = require("node:fs");
const path = require("node:path");
const spawn = require("cross-spawn");

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------

const TOOL_DIRECTORY = path.resolve(__dirname, "../../tools/test-ecosystem");
const PLUGINS_DATA_PATH = path.join(TOOL_DIRECTORY, "plugins-data.json");
const INDEX_PATH = path.join(TOOL_DIRECTORY, "index.mjs");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Builds a `spawn.sync()`-shaped result. Streams default to Buffers because
 * that is what `spawn.sync()` returns when output is captured.
 * @param {object} overrides Properties to override on the default result.
 * @returns {object} A result object.
 */
function spawnResult(overrides) {
	/*
	 * `error` is deliberately absent rather than explicitly undefined, which is
	 * indistinguishable to every read in the code under test.
	 */
	return {
		signal: null,
		status: 0,
		stderr: Buffer.from(""),
		stdout: Buffer.from(""),
		...overrides,
	};
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("tools/test-ecosystem", () => {
	describe("describeCommandFailure()", () => {
		let describeCommandFailure, TAIL_LINE_COUNT;

		before(async () => {
			({ describeCommandFailure, TAIL_LINE_COUNT } = await import(
				`file://${path.join(TOOL_DIRECTORY, "command-failure.mjs")}`
			));
		});

		it("reports no failure when the command exits cleanly", () => {
			assert.isNull(
				describeCommandFailure(["npm", "run", "test"], spawnResult({})),
			);
		});

		/*
		 * This is the defect this harness was built around. A plugin's test
		 * runner writes which assertions failed to stdout and only a terse
		 * summary to stderr, so an error built from stderr alone names the
		 * failing script and nothing else.
		 */
		it("includes stdout, not just stderr, when the command exits non-zero", () => {
			const message = describeCommandFailure(
				["npm", "run", "test"],
				spawnResult({
					status: 1,
					stderr: Buffer.from('ERROR: "test:js" exited with 1.'),
					stdout: Buffer.from(
						"1 test failed\n\nno-unnecessary-polyfills › invalid(1)",
					),
				}),
			);

			assert.include(message, "no-unnecessary-polyfills › invalid(1)");
			assert.include(message, "1 test failed");
			assert.include(message, 'ERROR: "test:js" exited with 1.');
			assert.include(message, "npm run test");
			assert.include(message, "exited with code 1");
		});

		/*
		 * `status` is null both when a command cannot be launched and when it is
		 * killed by a signal. Testing `status` for truthiness treats each of
		 * those as a pass, which turns a crashed test runner into a green build.
		 */
		it("reports a failure when the command is killed by a signal", () => {
			const message = describeCommandFailure(
				["npm", "run", "test"],
				spawnResult({ signal: "SIGKILL", status: null }),
			);

			assert.isNotNull(message);
			assert.include(message, "was killed by SIGKILL");
		});

		it("reports a failure when the command could not be run at all", () => {
			const message = describeCommandFailure(
				["pnpm", "install"],
				spawnResult({
					error: new Error("spawnSync pnpm ENOENT"),
					status: null,
					stderr: null,
					stdout: null,
				}),
			);

			assert.isNotNull(message);
			assert.include(message, "could not be run");
			assert.include(message, "spawnSync pnpm ENOENT");
		});

		it("reports a failure when the command reports no exit code at all", () => {
			const message = describeCommandFailure(
				["npm", "run", "test"],
				spawnResult({ status: null }),
			);

			assert.isNotNull(message);
			assert.include(message, "did not report an exit code");
		});

		it("keeps the tail of long output and says what it dropped", () => {
			const lines = Array.from(
				{ length: TAIL_LINE_COUNT + 50 },
				(_, index) => `line ${index}`,
			);
			const message = describeCommandFailure(
				["npm", "run", "test"],
				spawnResult({
					status: 1,
					stdout: Buffer.from(lines.join("\n")),
				}),
			);

			assert.include(message, `line ${lines.length - 1}`);
			assert.include(message, "<50 earlier lines omitted>");
			assert.notInclude(message, "line 0\n");
		});

		it("distinguishes an inherited stream from an empty one", () => {
			const message = describeCommandFailure(
				["npm", "run", "test"],
				spawnResult({
					status: 1,
					stderr: Buffer.from(""),
					stdout: null,
				}),
			);

			assert.include(message, "<inherited by this process");
			assert.include(message, "<empty>");
		});

		it("describes a real spawn.sync() failure that only prints to stdout", () => {
			const result = spawn.sync(process.execPath, [
				"-e",
				'console.log("detail only on stdout"); process.exit(1);',
			]);

			const message = describeCommandFailure(
				[process.execPath, "-e", "..."],
				result,
			);

			assert.isNotNull(message);
			assert.include(message, "detail only on stdout");
			assert.include(message, "exited with code 1");
		});

		it("describes a real spawn.sync() launch failure", () => {
			const result = spawn.sync(
				path.join(__dirname, "no-such-executable-b7f3"),
				[],
			);

			assert.isNotNull(describeCommandFailure(["nope"], result));
		});

		it("reports no failure for a real spawn.sync() success", () => {
			const result = spawn.sync(process.execPath, ["-e", ""]);

			assert.isNull(describeCommandFailure([process.execPath], result));
		});
	});

	describe("index.mjs", () => {
		/*
		 * The helper above is only worth anything if the harness actually calls
		 * it. Without this, deleting the call leaves every test above green.
		 */
		it("builds its command failures with describeCommandFailure()", () => {
			const source = fs.readFileSync(INDEX_PATH, "utf8");

			assert.include(source, "describeCommandFailure");
			assert.notInclude(
				source,
				"new Error(result.stderr",
				"Command failures must not be built from stderr alone; test runners report on stdout.",
			);
		});
	});

	describe("plugins-data.json", () => {
		const pluginsData = JSON.parse(
			fs.readFileSync(PLUGINS_DATA_PATH, "utf8"),
		);

		it("is not empty", () => {
			assert.isAbove(Object.keys(pluginsData).length, 0);
		});

		for (const [pluginKey, pluginSettings] of Object.entries(pluginsData)) {
			describe(pluginKey, () => {
				it("pins a full commit hash", () => {
					assert.match(pluginSettings.commit, /^[\da-f]{40}$/u);
				});

				it("has a repository, an install command, and a test command", () => {
					assert.match(
						pluginSettings.repository,
						/^https:\/\/github\.com\//u,
					);
					assert.isNotEmpty(pluginSettings.commands.install);
					assert.isNotEmpty(pluginSettings.commands.test);
				});
			});
		}

		/*
		 * core-js-compat 3.50.0 emptied the support data for `es.promise.try`
		 * and `esnext.promise.try`, following tc39/ecma262#3883, so
		 * `require("core-js/stable/promise")` now counts as needed on every
		 * target and eslint-plugin-unicorn's `no-unnecessary-polyfills` test
		 * that expects one error gets none. The plugin's dependency range is
		 * `^3.49.0`, so moving its commit pin forward does not avoid this.
		 *
		 * Retire this pin, and this test with it, once
		 * sindresorhus/eslint-plugin-unicorn#3606 lands and the plugin's commit
		 * pin has moved past it.
		 */
		it("pins core-js-compat for eslint-plugin-unicorn", () => {
			assert.include(
				pluginsData["eslint-plugin-unicorn"].commands.install,
				"core-js-compat@3.49.0",
				"Without this pin the plugin's no-unnecessary-polyfills test fails against core-js-compat >= 3.50.0.",
			);
		});
	});
});

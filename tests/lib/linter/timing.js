"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert;
const sinon = require("sinon");
const timingModule = require("../../../lib/linter/timing");

const { getListSize } = timingModule;

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const TIMING_PATH = require.resolve("../../../lib/linter/timing");

/*
 * The module reads `process.env.TIMING` once, at load time, and caches the
 * result in its `enabled` flag. Observing the enabled behaviour therefore means
 * dropping the cache entry and re-requiring it with the variable already set.
 * `originalCacheEntry` is the pristine instance every other test file shares;
 * it is put back in `after()` so this file leaves no trace in the registry.
 */
const originalCacheEntry = require.cache[TIMING_PATH];
const originalTimingEnvValue = process.env.TIMING;

/** @type {Array<Function>} */
let addedExitListeners = [];

/**
 * Loads a fresh copy of the timing module with `process.env.TIMING` set.
 * @param {string} [timingEnvValue] Value for `process.env.TIMING`. When
 *      omitted, the variable is unset, which disables the module.
 * @returns {{module: Object, exitListeners: Array<Function>}} The freshly
 *      loaded module, plus any `process.on("exit")` listeners it registered.
 */
function loadTiming(timingEnvValue) {
	const listenersBefore = new Set(process.listeners("exit"));

	if (typeof timingEnvValue === "string") {
		process.env.TIMING = timingEnvValue;
	} else {
		delete process.env.TIMING;
	}

	delete require.cache[TIMING_PATH];

	const loadedModule = require(TIMING_PATH);
	const exitListeners = process
		.listeners("exit")
		.filter(listener => !listenersBefore.has(listener));

	/*
	 * Track them so `afterEach` can detach them. Left attached, they would fire
	 * when the mocha process really exits and print timing tables into the
	 * middle of the test reporter's output.
	 */
	addedExitListeners = addedExitListeners.concat(exitListeners);

	return { module: loadedModule, exitListeners };
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("timing", () => {
	describe("getListSize()", () => {
		after(() => {
			delete process.env.TIMING;
		});

		it("returns minimum list size with small environment variable value", () => {
			delete process.env.TIMING; // With no value.
			assert.strictEqual(getListSize(), 10);

			process.env.TIMING = "true";
			assert.strictEqual(getListSize(), 10);

			process.env.TIMING = "foo";
			assert.strictEqual(getListSize(), 10);

			process.env.TIMING = "0";
			assert.strictEqual(getListSize(), 10);

			process.env.TIMING = "1";
			assert.strictEqual(getListSize(), 10);

			process.env.TIMING = "5";
			assert.strictEqual(getListSize(), 10);

			process.env.TIMING = "10";
			assert.strictEqual(getListSize(), 10);
		});

		it("returns longer list size with larger environment variable value", () => {
			process.env.TIMING = "11";
			assert.strictEqual(getListSize(), 11);

			process.env.TIMING = "100";
			assert.strictEqual(getListSize(), 100);
		});

		it("returns maximum list size with environment variable value of 'all'", () => {
			process.env.TIMING = "all";
			assert.strictEqual(getListSize(), Number.POSITIVE_INFINITY);

			process.env.TIMING = "ALL";
			assert.strictEqual(getListSize(), Number.POSITIVE_INFINITY);
		});
	});

	describe("when reloaded with a TIMING environment variable", () => {
		afterEach(() => {
			addedExitListeners.forEach(listener =>
				process.removeListener("exit", listener),
			);
			addedExitListeners = [];
			sinon.restore();
		});

		after(() => {
			/*
			 * Hand the pristine instance back to the module registry. Test files
			 * that run later must not observe a copy loaded with TIMING set.
			 */
			require.cache[TIMING_PATH] = originalCacheEntry;

			if (typeof originalTimingEnvValue === "string") {
				process.env.TIMING = originalTimingEnvValue;
			} else {
				delete process.env.TIMING;
			}
		});

		describe("enabled", () => {
			it("is false and registers no exit listener when TIMING is unset", () => {
				const { module: timing, exitListeners } = loadTiming();

				assert.strictEqual(timing.enabled, false);
				assert.lengthOf(exitListeners, 0);
			});

			it("is true and registers an exit listener when TIMING is set", () => {
				const { module: timing, exitListeners } = loadTiming("all");

				assert.strictEqual(timing.enabled, true);
				assert.lengthOf(exitListeners, 1);
			});
		});

		describe("time()", () => {
			it("forwards arguments and returns the wrapped function's result", () => {
				const { module: timing } = loadTiming();
				const wrapped = timing.time("a-rule", (a, b) => a + b);

				assert.strictEqual(wrapped(2, 3), 5);
			});

			it("returns the result alongside the elapsed time when stats is true", () => {
				const { module: timing } = loadTiming();
				const wrapped = timing.time("a-rule", () => "value", true);
				const returnValue = wrapped();

				assert.strictEqual(returnValue.result, "value");
				assert.isNumber(returnValue.tdiff);
				assert.isAtLeast(returnValue.tdiff, 0);
			});

			it("does not collect data when TIMING is unset", () => {
				const { module: timing } = loadTiming();

				timing.time("a-rule", () => null)();

				assert.deepStrictEqual(timing.getData(), {});
			});

			it("collects data per key when TIMING is set", () => {
				const { module: timing } = loadTiming("all");

				timing.time("a-rule", () => null)();
				timing.time("b-rule", () => null)();

				assert.hasAllKeys(timing.getData(), ["a-rule", "b-rule"]);
			});

			it("accumulates repeated calls under the same key", () => {
				const { module: timing } = loadTiming("all");
				const wrapped = timing.time("a-rule", () => {
					const until = Date.now() + 2;

					while (Date.now() < until) {
						/* Burn a measurable amount of wall clock time. */
					}
				});

				wrapped();

				const afterFirstCall = timing.getData()["a-rule"];

				wrapped();

				assert.isAbove(timing.getData()["a-rule"], afterFirstCall);
			});

			it("collects data in stats mode as well", () => {
				const { module: timing } = loadTiming("all");

				timing.time("a-rule", () => null, true)();

				assert.hasAllKeys(timing.getData(), ["a-rule"]);
			});
		});

		describe("getData()", () => {
			it("returns an empty object before anything is recorded", () => {
				const { module: timing } = loadTiming("all");

				assert.deepStrictEqual(timing.getData(), {});
			});

			it("returns a copy that does not write back to the module", () => {
				const { module: timing } = loadTiming("all");

				timing.mergeData({ "a-rule": 1 });

				const data = timing.getData();

				data["a-rule"] = 999;
				data["b-rule"] = 5;

				assert.deepStrictEqual(timing.getData(), { "a-rule": 1 });
			});
		});

		describe("mergeData()", () => {
			it("adds previously unseen keys", () => {
				const { module: timing } = loadTiming("all");

				timing.mergeData({ "a-rule": 3, "b-rule": 4 });

				assert.deepStrictEqual(timing.getData(), {
					"a-rule": 3,
					"b-rule": 4,
				});
			});

			it("adds to the totals of keys that already exist", () => {
				const { module: timing } = loadTiming("all");

				timing.mergeData({ "a-rule": 3 });
				timing.mergeData({ "a-rule": 4, "b-rule": 1 });

				assert.deepStrictEqual(timing.getData(), {
					"a-rule": 7,
					"b-rule": 1,
				});
			});

			it("merges into totals collected by time()", () => {
				const { module: timing } = loadTiming("all");

				timing.time("a-rule", () => null)();

				const collected = timing.getData()["a-rule"];

				timing.mergeData({ "a-rule": 10 });

				assert.strictEqual(timing.getData()["a-rule"], collected + 10);
			});

			it("does nothing when given an empty object", () => {
				const { module: timing } = loadTiming("all");

				timing.mergeData({});

				assert.deepStrictEqual(timing.getData(), {});
			});
		});

		describe("display on exit", () => {
			it("prints an aligned table sorted by descending time", () => {
				const { module: timing, exitListeners } = loadTiming("all");
				const log = sinon.stub(console, "log");

				timing.mergeData({ "b-rule": 30, "a-rule": 70 });
				exitListeners[0]();

				assert.strictEqual(log.callCount, 1);
				assert.strictEqual(
					log.firstCall.args[0],
					[
						"Rule   | Time (ms) | Relative",
						":------|----------:|--------:",
						"a-rule |    70.000 |    70.0%",
						"b-rule |    30.000 |    30.0%",
					].join("\n"),
				);
			});

			it("widens columns to fit the longest rule name", () => {
				const { module: timing, exitListeners } = loadTiming("all");
				const log = sinon.stub(console, "log");

				timing.mergeData({ "a-very-long-rule-name": 100 });
				exitListeners[0]();

				assert.strictEqual(
					log.firstCall.args[0],
					[
						"Rule                  | Time (ms) | Relative",
						":---------------------|----------:|--------:",
						"a-very-long-rule-name |   100.000 |   100.0%",
					].join("\n"),
				);
			});

			it("limits the table to the size requested by TIMING", () => {
				const { module: timing, exitListeners } = loadTiming("11");
				const log = sinon.stub(console, "log");

				/** @type {Record<string, number>} */
				const data = {};

				for (let i = 0; i < 20; i++) {
					data[`rule-${i}`] = i + 1;
				}

				timing.mergeData(data);
				exitListeners[0]();

				const lines = log.firstCall.args[0].split("\n");

				/* One header row, one separator row, then 11 rule rows. */
				assert.lengthOf(lines, 13);
				assert.include(lines[2], "rule-19");
				assert.include(lines[12], "rule-9");
			});

			it("prints nothing when no timings were collected", () => {
				const { exitListeners } = loadTiming("all");
				const log = sinon.stub(console, "log");

				exitListeners[0]();

				assert.strictEqual(log.callCount, 0);
			});

			it("prints nothing after disableDisplay() is called", () => {
				const { module: timing, exitListeners } = loadTiming("all");
				const log = sinon.stub(console, "log");

				timing.mergeData({ "a-rule": 70 });
				timing.disableDisplay();
				exitListeners[0]();

				assert.strictEqual(log.callCount, 0);
			});
		});
	});
});

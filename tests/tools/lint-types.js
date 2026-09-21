/**
 * @fileoverview Tests for the lint-types/build-types wrapper around tsc.
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

const REPO_ROOT = path.resolve(__dirname, "../..");
const LINT_TYPES = path.join(REPO_ROOT, "tools", "lint-types.js");
const TSC = require.resolve("typescript/bin/tsc");
const PACKAGE_JSON = require(path.join(REPO_ROOT, "package.json"));
const TSCONFIG_JSON = require(path.join(REPO_ROOT, "tsconfig.json"));

/**
 * Base compiler options mirroring the repo's tsconfig.json. `rootDir` is set
 * explicitly because emitting from a nested source directory otherwise fails
 * with TS5011.
 * @type {Object}
 */
const COMPILER_OPTIONS = {
	allowJs: true,
	checkJs: true,
	strict: true,
	declaration: true,
	emitDeclarationOnly: true,
	rootDir: "src",
	outDir: "dist/types",
};

let tmpDir;

/**
 * Creates a throwaway project directory containing a tsconfig.json and,
 * optionally, source files to type-check.
 * @param {string} name Directory name, unique within the temp directory.
 * @param {Object} tsconfig The tsconfig.json contents.
 * @param {Object<string, string>} [files] Source file paths mapped to contents.
 * @returns {string} The absolute path of the created project directory.
 */
function createProject(name, tsconfig, files = {}) {
	const projectDir = path.join(tmpDir, name);

	fs.mkdirSync(projectDir, { recursive: true });
	fs.writeFileSync(
		path.join(projectDir, "tsconfig.json"),
		JSON.stringify(tsconfig),
	);

	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(projectDir, relativePath);

		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	}

	return projectDir;
}

/**
 * Builds a tsconfig.json object with the repo's compiler options.
 * @param {Array<string>} include The `include` array for the config.
 * @returns {Object} The tsconfig.json contents.
 */
function buildTsconfig(include) {
	return { compilerOptions: COMPILER_OPTIONS, include };
}

/**
 * Runs the wrapper in a given project directory.
 * @param {string} cwd The directory to run in; tsc reads its tsconfig.json.
 * @param {...string} args Arguments to pass to the wrapper.
 * @returns {Promise<ChildProcess>} An object with properties `stdout` and `stderr` on success.
 * @throws An object with properties `code`, `stdout` and `stderr` on failure.
 */
async function runLintTypes(cwd, ...args) {
	return await promisify(execFile)(process.execPath, [LINT_TYPES, ...args], {
		cwd,
	});
}

/**
 * Runs tsc directly, bypassing the wrapper, to establish what the wrapper is
 * suppressing.
 * @param {string} cwd The directory to run in; tsc reads its tsconfig.json.
 * @param {...string} args Arguments to pass to tsc.
 * @returns {Promise<ChildProcess>} An object with properties `stdout` and `stderr` on success.
 * @throws An object with properties `code`, `stdout` and `stderr` on failure.
 */
async function runTsc(cwd, ...args) {
	return await promisify(execFile)(process.execPath, [TSC, ...args], { cwd });
}

/**
 * Runs tsc directly and captures the outcome whether or not it failed, so a
 * test can compare the wrapper's report against tsc's own words.
 * @param {string} cwd The directory to run in; tsc reads its tsconfig.json.
 * @param {...string} args Arguments to pass to tsc.
 * @returns {Promise<{code: number, output: string}>} The exit code and tsc's
 *      combined output, concatenated in the order the wrapper concatenates it.
 */
async function tscOutcome(cwd, ...args) {
	try {
		const { stdout, stderr } = await runTsc(cwd, ...args);

		return { code: 0, output: stdout + stderr };
	} catch (error) {
		return { code: error.code, output: error.stdout + error.stderr };
	}
}

/**
 * Lists the declaration files emitted into a project's output directory.
 * @param {string} projectDir The project directory.
 * @returns {Array<string>} Emitted file names, empty if nothing was emitted.
 */
function emittedFiles(projectDir) {
	const outDir = path.join(projectDir, "dist", "types");

	return fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
}

/**
 * Lists every file under a directory tree, as paths relative to it.
 * @param {string} dir The directory to walk.
 * @param {string} [prefix] The relative path of `dir`, used when recursing.
 * @returns {Array<string>} Slash-separated relative paths, empty if `dir` does not exist.
 */
function filesUnder(dir, prefix = "") {
	const paths = [];

	if (!fs.existsSync(dir)) {
		return paths;
	}

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			paths.push(...filesUnder(path.join(dir, entry.name), relativePath));
		} else {
			paths.push(relativePath);
		}
	}

	return paths;
}

/**
 * Reports which of the given sources had no declaration emitted for them.
 *
 * Paths are matched by suffix rather than by file name. tsc roots the output
 * tree at the common root of the compiled files, so the leading segments are
 * not fixed, while comparing bare names would let an unrelated declaration
 * stand in for a missing one — `lib/shared/ast-utils.js` and
 * `lib/rules/utils/ast-utils.js` both emit an `ast-utils.d.ts`.
 * @param {Array<string>} emitted Slash-separated paths of the emitted files.
 * @param {Array<string>} sources Slash-separated repo-relative source paths.
 * @returns {Array<string>} The expected declaration paths that are absent.
 */
function missingDeclarations(emitted, sources) {
	return sources
		.map(source => source.replace(/\.js$/u, ".d.ts"))
		.filter(
			declaration =>
				!emitted.some(
					file =>
						file === declaration ||
						file.endsWith(`/${declaration}`),
				),
		);
}

const VALID_SOURCE = `/**
 * Adds one to a number.
 * @param {number} n The number to increment.
 * @returns {number} The incremented number.
 */
function addOne(n) {
	return n + 1;
}

module.exports = { addOne };
`;

const INVALID_SOURCE = `/**
 * Claims to return a string but returns a number.
 * @param {number} n The number.
 * @returns {string} The result.
 */
function broken(n) {
	return n;
}

module.exports = { broken };
`;

/*
 * tsc explains a nested mismatch over three lines, only the first of which
 * matches `error TS`. Reporting just the lines that survive the wrapper's
 * filter would therefore still name the right error code while discarding the
 * explanation of why the two types are incompatible.
 */
const ELABORATED_SOURCE = `/** @type {{a: number}} */
const source = { a: 1 };

/** @type {{a: string}} */
const target = source;

module.exports = { target };
`;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lint-types", function () {
	// Each assertion spawns a real tsc process, which is slower than the default.
	this.timeout(60000); // eslint-disable-line no-invalid-this -- Mocha timeout

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eslint-lint-types-"));
	});

	after(() => {
		fs.rmSync(tmpDir, { force: true, recursive: true });
	});

	/*
	 * TS18003 ("No inputs were found") is the expected tsc failure while the
	 * staged JSDoc-annotation rollout leaves `include` empty, and both entry
	 * points must suppress it.
	 */
	describe("with an empty include array", () => {
		/*
		 * Pins the premise of the two tests below. Without this, a future tsc
		 * that stopped reporting TS18003 for an empty `include` would leave
		 * them passing while never exercising the suppression they exist to
		 * cover.
		 */
		it("is a case where tsc itself fails with only TS18003", async () => {
			const projectDir = createProject(
				"empty-premise",
				buildTsconfig([]),
			);

			await assert.rejects(
				runTsc(projectDir, "--noEmit"),
				({ code, stdout }) => {
					assert.notStrictEqual(code, 0);
					assert.match(stdout, /error TS18003/u);
					assert.deepStrictEqual(
						stdout
							.split("\n")
							.filter(line => /error TS(?!18003\b)/u.test(line)),
						[],
					);
					return true;
				},
			);
		});

		it("exits 0 in emit mode (build:types)", async () => {
			const projectDir = createProject("empty-emit", buildTsconfig([]));
			const childProcess = await runLintTypes(projectDir, "--emit");

			assert.strictEqual(childProcess.stdout, "");
			assert.strictEqual(childProcess.stderr, "");
			assert.deepStrictEqual(emittedFiles(projectDir), []);
		});

		it("exits 0 in no-emit mode (lint:types)", async () => {
			const projectDir = createProject("empty-noemit", buildTsconfig([]));
			const childProcess = await runLintTypes(projectDir);

			assert.strictEqual(childProcess.stdout, "");
			assert.strictEqual(childProcess.stderr, "");
			assert.deepStrictEqual(emittedFiles(projectDir), []);
		});
	});

	describe("with type-safe sources", () => {
		it("emits declaration files in emit mode", async () => {
			const projectDir = createProject(
				"valid-emit",
				buildTsconfig(["src"]),
				{
					"src/ok.js": VALID_SOURCE,
				},
			);
			const childProcess = await runLintTypes(projectDir, "--emit");

			assert.strictEqual(childProcess.stderr, "");
			assert.deepStrictEqual(emittedFiles(projectDir), ["ok.d.ts"]);
		});

		it("does not emit declaration files in no-emit mode", async () => {
			const projectDir = createProject(
				"valid-noemit",
				buildTsconfig(["src"]),
				{ "src/ok.js": VALID_SOURCE },
			);
			const childProcess = await runLintTypes(projectDir);

			assert.strictEqual(childProcess.stderr, "");
			assert.deepStrictEqual(emittedFiles(projectDir), []);
		});
	});

	/*
	 * The empty-include block pins what happens while nothing is compiled.
	 * These pin the other end, which is the point of the gate: once `include`
	 * names real sources, `build:types` must put declarations — and only
	 * declarations — under `outDir`. Exit code 0 cannot tell that apart from a
	 * build that emitted nothing, so every assertion here is filesystem state.
	 */
	describe("with a non-empty include array", () => {
		/**
		 * Creates a project whose sources sit at two depths, so the shape of
		 * the emitted tree can be compared and not merely its size.
		 * @param {string} name Directory name, unique within the temp directory.
		 * @returns {string} The absolute path of the created project directory.
		 */
		function createEmitProject(name) {
			return createProject(name, buildTsconfig(["src"]), {
				"src/ok.js": VALID_SOURCE,
				"src/nested/deep.js": VALID_SOURCE,
			});
		}

		it("mirrors the source tree under outDir", async () => {
			const projectDir = createEmitProject("emit-layout");

			await runLintTypes(projectDir, "--emit");

			assert.deepStrictEqual(
				filesUnder(path.join(projectDir, "dist", "types"))
					.filter(file => file.endsWith(".d.ts"))
					.sort(),
				["nested/deep.d.ts", "ok.d.ts"],
			);
		});

		/*
		 * Without `emitDeclarationOnly`, `declaration: true` still writes every
		 * `.d.ts` above — tsc just compiles the sources to JavaScript beside
		 * them. Only looking for what should be absent catches that.
		 */
		it("emits declarations only, never JavaScript", async () => {
			const projectDir = createEmitProject("emit-declarations-only");

			await runLintTypes(projectDir, "--emit");

			assert.deepStrictEqual(
				filesUnder(path.join(projectDir, "dist", "types")).filter(
					file => !file.endsWith(".d.ts"),
				),
				[],
			);
		});

		it("leaves the sources alongside no declarations of their own", async () => {
			const projectDir = createEmitProject("emit-source-tree");

			await runLintTypes(projectDir, "--emit");

			assert.deepStrictEqual(
				filesUnder(path.join(projectDir, "src")).sort(),
				["nested/deep.js", "ok.js"],
			);
		});

		/*
		 * A declaration file that exists but describes nothing would satisfy
		 * every assertion above while making the whole build worthless, so
		 * check that the JSDoc annotations actually reached the output.
		 */
		it("carries the JSDoc types into the declaration", async () => {
			const projectDir = createEmitProject("emit-contents");

			await runLintTypes(projectDir, "--emit");

			assert.match(
				fs.readFileSync(
					path.join(projectDir, "dist", "types", "ok.d.ts"),
					"utf8",
				),
				/export function addOne\(n: number\): number;/u,
			);
		});
	});

	/*
	 * Every success above reaches exit 0 through the output filter, which for a
	 * clean run has nothing to keep and so agrees with tsc's own status. None of
	 * them can tell whether the wrapper trusts `result.status === 0` or merely
	 * re-derives success from the absence of `error TS` lines. That distinction
	 * is the wrapper's contract once the staged rollout finishes and the gate
	 * starts passing for real: a run tsc considers clean must pass, whatever tsc
	 * printed along the way.
	 *
	 * `listFiles` makes tsc name every file it read, so a source path that
	 * happens to contain the text `error TS2322` puts a line the filter would
	 * keep into the output of a run that succeeded.
	 */
	describe("when tsc succeeds while printing text the filter matches", () => {
		const DECOY_SOURCE = "src/error TS2322.js";

		/**
		 * Creates a project whose sole source is named after an error code.
		 * @param {string} name Directory name, unique within the temp directory.
		 * @returns {string} The absolute path of the created project directory.
		 */
		function createDecoyProject(name) {
			return createProject(
				name,
				{
					compilerOptions: { ...COMPILER_OPTIONS, listFiles: true },
					include: ["src"],
				},
				{ [DECOY_SOURCE]: VALID_SOURCE },
			);
		}

		/**
		 * Applies the wrapper's own filter to some tsc output.
		 * @param {string} output The combined output of a tsc run.
		 * @returns {Array<string>} The lines the filter would treat as errors.
		 */
		function keptLines(output) {
			return output
				.split("\n")
				.filter(line => /error TS(?!18003\b)/u.test(line));
		}

		/*
		 * Pins the premise of the two tests below: this fixture really does make
		 * a successful tsc print a line that the filter cannot tell apart from a
		 * diagnostic. Without it, a future tsc that stopped listing files — or a
		 * fixture that stopped matching — would leave them passing as ordinary
		 * duplicates of the clean-project tests above.
		 */
		it("is a case where tsc exits 0 having printed such a line", async () => {
			const projectDir = createDecoyProject("decoy-premise");
			const { code, output } = await tscOutcome(projectDir, "--noEmit");

			assert.strictEqual(code, 0);
			assert.ok(
				keptLines(output).some(line =>
					line.endsWith("error TS2322.js"),
				),
				`expected tsc's output to list ${DECOY_SOURCE}, got ${JSON.stringify(output)}`,
			);
		});

		it("exits 0 in no-emit mode (lint:types)", async () => {
			const projectDir = createDecoyProject("decoy-noemit");
			const childProcess = await runLintTypes(projectDir);

			assert.strictEqual(childProcess.stderr, "");
			assert.strictEqual(childProcess.stdout, "");
		});

		it("exits 0 in emit mode (build:types)", async () => {
			const projectDir = createDecoyProject("decoy-emit");
			const childProcess = await runLintTypes(projectDir, "--emit");

			assert.strictEqual(childProcess.stderr, "");
			assert.strictEqual(childProcess.stdout, "");
			assert.deepStrictEqual(emittedFiles(projectDir), [
				"error TS2322.d.ts",
			]);
		});
	});

	describe("with a real type error", () => {
		/*
		 * Pins the premise of this block: the fixture fails with an error that
		 * is not TS18003, which is precisely the case the suppression must not
		 * swallow. It also records that tsc signals failure with exit code 2,
		 * making the wrapper's normalisation to 1 a deliberate assertion below
		 * rather than a coincidence.
		 */
		it("is a case where tsc itself fails with a non-TS18003 error", async () => {
			const projectDir = createProject(
				"real-premise",
				buildTsconfig(["src"]),
				{ "src/bad.js": INVALID_SOURCE },
			);
			const { code, output } = await tscOutcome(projectDir, "--noEmit");

			assert.strictEqual(code, 2);
			assert.match(output, /error TS2322/u);
			assert.doesNotMatch(output, /error TS18003/u);
		});

		it("exits 1 and reports the error in emit mode", async () => {
			const projectDir = createProject(
				"invalid-emit",
				buildTsconfig(["src"]),
				{ "src/bad.js": INVALID_SOURCE },
			);

			await assert.rejects(
				runLintTypes(projectDir, "--emit"),
				({ code, stderr }) => {
					assert.strictEqual(code, 1);
					assert.match(stderr, /error TS2322/u);
					return true;
				},
			);
		});

		it("exits 1 and reports the error in no-emit mode", async () => {
			const projectDir = createProject(
				"invalid-noemit",
				buildTsconfig(["src"]),
				{ "src/bad.js": INVALID_SOURCE },
			);

			await assert.rejects(
				runLintTypes(projectDir),
				({ code, stderr }) => {
					assert.strictEqual(code, 1);
					assert.match(stderr, /error TS2322/u);
					return true;
				},
			);
		});

		/*
		 * The filter decides the exit code; it must not decide what the
		 * developer is shown. Matching a single `error TS2322` cannot tell the
		 * two apart, because a wrapper reporting only the lines that failed the
		 * filter would still print that code. These fixtures separate them: a
		 * nested mismatch adds continuation lines that no `error TS` filter
		 * would keep, and a second failing file proves every error survives.
		 */
		describe("spanning several lines and several files", () => {
			/**
			 * Creates a project whose errors span continuation lines and files.
			 * @param {string} name Directory name, unique within the temp directory.
			 * @returns {string} The absolute path of the created project directory.
			 */
			function createElaboratedProject(name) {
				return createProject(name, buildTsconfig(["src"]), {
					"src/bad.js": ELABORATED_SOURCE,
					"src/other.js": INVALID_SOURCE,
				});
			}

			/**
			 * Asserts the wrapper failed and reproduced tsc's report in full.
			 * @param {{code: number, stdout: string, stderr: string}} rejection The rejection value.
			 * @param {string} expected tsc's own combined output for the same project.
			 * @returns {boolean} Always `true`, so `assert.rejects` accepts it.
			 */
			function assertForwardsVerbatim(
				{ code, stdout, stderr },
				expected,
			) {
				assert.strictEqual(code, 1);
				assert.strictEqual(stdout, "");
				assert.strictEqual(stderr, expected);

				/*
				 * Spelled out as well as compared, so a regression reports
				 * which part of the message went missing rather than only that
				 * two long strings differ.
				 */
				assert.match(stderr, /error TS2322/u);
				assert.match(
					stderr,
					/ {2}Types of property 'a' are incompatible\./u,
				);
				assert.match(stderr, /other\.js/u);
				return true;
			}

			it("writes tsc's whole report to stderr in no-emit mode", async () => {
				const projectDir = createElaboratedProject("elaborated-noemit");
				const expected = await tscOutcome(projectDir, "--noEmit");

				assert.strictEqual(expected.code, 2);

				await assert.rejects(runLintTypes(projectDir), rejection =>
					assertForwardsVerbatim(rejection, expected.output),
				);
			});

			it("writes tsc's whole report to stderr in emit mode", async () => {
				const projectDir = createElaboratedProject("elaborated-emit");
				const expected = await tscOutcome(projectDir);

				assert.strictEqual(expected.code, 2);

				await assert.rejects(
					runLintTypes(projectDir, "--emit"),
					rejection =>
						assertForwardsVerbatim(rejection, expected.output),
				);
			});
		});
	});

	/*
	 * The suppression is scoped to TS18003 alone, not to "tsc failed while
	 * `include` was empty". A malformed compiler option makes tsc report
	 * TS6046 alongside TS18003, so the run must still fail.
	 */
	describe("with an empty include array and an unrelated error", () => {
		/**
		 * Builds a tsconfig whose `target` is invalid, producing TS6046.
		 * @returns {Object} The tsconfig.json contents.
		 */
		function buildMixedTsconfig() {
			return {
				compilerOptions: {
					...COMPILER_OPTIONS,
					target: "NotAVersion",
				},
				include: [],
			};
		}

		/*
		 * Pins the premise of the tests below: this fixture really does make tsc
		 * report both codes at once. A config-level diagnostic is the only error
		 * class that CAN co-occur with TS18003, since an empty file set leaves
		 * nothing for file-level checks to complain about. Without this test, a
		 * future tsc that stopped reporting TS18003 here would quietly reduce
		 * the cases below to duplicates of the plain "real type error" block.
		 */
		it("is a case where tsc itself reports TS18003 and TS6046", async () => {
			const projectDir = createProject(
				"mixed-premise",
				buildMixedTsconfig(),
			);

			await assert.rejects(
				runTsc(projectDir, "--noEmit"),
				({ code, stdout }) => {
					assert.notStrictEqual(code, 0);
					assert.match(stdout, /error TS18003/u);
					assert.match(stdout, /error TS6046/u);
					return true;
				},
			);
		});

		/**
		 * Asserts the wrapper failed and forwarded tsc's output verbatim.
		 *
		 * Matching TS6046 alone would still pass if the wrapper reported only
		 * the lines it kept in `realErrors`, so the suppressed TS18003 line is
		 * asserted too: filtering decides the exit code, it must not censor
		 * what the developer is shown.
		 * @param {{code: number, stderr: string}} error The rejection value.
		 * @returns {boolean} Always `true`, so `assert.rejects` accepts it.
		 */
		function assertReportsBothErrors({ code, stderr }) {
			assert.strictEqual(code, 1);
			assert.match(stderr, /error TS6046/u);
			assert.match(stderr, /error TS18003/u);
			return true;
		}

		it("exits 1 and reports the error in emit mode", async () => {
			const projectDir = createProject(
				"mixed-emit",
				buildMixedTsconfig(),
			);

			await assert.rejects(
				runLintTypes(projectDir, "--emit"),
				assertReportsBothErrors,
			);
		});

		it("exits 1 and reports the error in no-emit mode", async () => {
			const projectDir = createProject(
				"mixed-noemit",
				buildMixedTsconfig(),
			);

			await assert.rejects(
				runLintTypes(projectDir),
				assertReportsBothErrors,
			);
		});
	});

	/*
	 * The tests above drive tools/lint-types.js directly. These pin the npm
	 * scripts to that same entry point, so renaming a script or changing its
	 * flags cannot silently leave the gates untested.
	 */
	describe("npm script wiring", () => {
		it("maps lint:types to the wrapper with no flags", () => {
			assert.strictEqual(
				PACKAGE_JSON.scripts["lint:types"],
				"node tools/lint-types.js",
			);
		});

		it("maps build:types to the wrapper with --emit", () => {
			assert.strictEqual(
				PACKAGE_JSON.scripts["build:types"],
				"node tools/lint-types.js --emit",
			);
		});
	});

	/*
	 * `include` alone no longer decides what gets type-checked. lib/config
	 * requires lib/rules and lib/languages, which drags the whole rule set into
	 * the program, so whole-program `checkJs` would fail on hundreds of files
	 * whose annotation beads have not landed. `checkJs` is therefore off and
	 * each annotated file opts in with `// @ts-check`. These tests pin that
	 * mechanism, because a file added to `include` without the directive is
	 * still emitted and would otherwise look covered.
	 */
	describe("with checkJs disabled", () => {
		/**
		 * Builds a tsconfig.json that mirrors the repo's per-file opt-in setup.
		 * @param {Array<string>} include The `include` array for the config.
		 * @returns {Object} The tsconfig.json contents.
		 */
		function buildOptInTsconfig(include) {
			return {
				compilerOptions: { ...COMPILER_OPTIONS, checkJs: false },
				include,
			};
		}

		it("leaves a broken file unchecked without // @ts-check", async () => {
			const projectDir = createProject(
				"opt-in-absent",
				buildOptInTsconfig(["src"]),
				{ "src/bad.js": INVALID_SOURCE },
			);

			const childProcess = await runLintTypes(projectDir);

			assert.strictEqual(childProcess.stderr, "");
		});

		it("checks the same file once it carries // @ts-check", async () => {
			const projectDir = createProject(
				"opt-in-present",
				buildOptInTsconfig(["src"]),
				{ "src/bad.js": `// @ts-check\n${INVALID_SOURCE}` },
			);

			await assert.rejects(
				runLintTypes(projectDir),
				({ code, stderr }) => {
					assert.strictEqual(code, 1);
					assert.match(stderr, /error TS2322/u);
					return true;
				},
			);
		});

		it("still emits declarations for a file without // @ts-check", async () => {
			const projectDir = createProject(
				"opt-in-emit",
				buildOptInTsconfig(["src"]),
				{ "src/bad.js": INVALID_SOURCE },
			);

			await runLintTypes(projectDir, "--emit");

			assert.deepStrictEqual(emittedFiles(projectDir), ["bad.d.ts"]);
		});
	});

	describe("against the repository's own tsconfig.json", () => {
		const CHECKED_DIRECTORIES = [
			"lib/shared",
			"lib/config",
			"lib/rules/utils",
		];
		const OUT_DIR = path.join(REPO_ROOT, "dist", "types");

		/**
		 * Lists the sources the repo has opted into type-checking.
		 *
		 * The walk recurses because `include` patterns do. `lib/rules/utils`
		 * has a `unicode/` subdirectory, and a flat listing would report full
		 * coverage of it while leaving every file inside unexamined.
		 * @returns {Array<string>} Slash-separated repo-relative paths.
		 */
		function checkedSources() {
			return CHECKED_DIRECTORIES.flatMap(directory =>
				filesUnder(path.join(REPO_ROOT, directory))
					.filter(file => file.endsWith(".js"))
					.map(file => `${directory}/${file}`),
			);
		}

		it("type-checks lib/shared", () => {
			assert.ok(
				TSCONFIG_JSON.include.some(pattern =>
					pattern.startsWith("lib/shared/"),
				),
				`expected tsconfig.json 'include' to cover lib/shared, got ${JSON.stringify(TSCONFIG_JSON.include)}`,
			);
		});

		it("type-checks lib/config", () => {
			assert.ok(
				TSCONFIG_JSON.include.some(pattern =>
					pattern.startsWith("lib/config/"),
				),
				`expected tsconfig.json 'include' to cover lib/config, got ${JSON.stringify(TSCONFIG_JSON.include)}`,
			);
		});

		it("type-checks lib/rules/utils", () => {
			assert.ok(
				TSCONFIG_JSON.include.some(pattern =>
					pattern.startsWith("lib/rules/utils/"),
				),
				`expected tsconfig.json 'include' to cover lib/rules/utils, got ${JSON.stringify(TSCONFIG_JSON.include)}`,
			);
		});

		it("opts every included source into checking with // @ts-check", () => {
			assert.strictEqual(TSCONFIG_JSON.compilerOptions.checkJs, false);

			const unchecked = checkedSources().filter(
				source =>
					!/^\/\/ @ts-check$/mu.test(
						fs.readFileSync(path.join(REPO_ROOT, source), "utf8"),
					),
			);

			assert.deepStrictEqual(unchecked, []);
		});

		/*
		 * Where the declarations go is the build's contract with its
		 * consumers, and the test below hardcodes `dist/types` to check it.
		 * Pinning the options here turns a change to any of them into a
		 * failure that names the option rather than a puzzling report of
		 * declarations gone missing.
		 */
		it("is configured to emit declarations to dist/types", () => {
			const { compilerOptions } = TSCONFIG_JSON;

			assert.strictEqual(compilerOptions.declaration, true);
			assert.strictEqual(compilerOptions.emitDeclarationOnly, true);
			assert.strictEqual(
				compilerOptions.outDir,
				path.posix.join("dist", "types"),
			);
		});

		it("exits 0 in emit mode (build:types)", async () => {
			/*
			 * dist/ is gitignored build output that survives between runs, so
			 * a tree left by an earlier build would satisfy everything below
			 * even if this run emitted nothing at all. Start from nothing.
			 */
			fs.rmSync(OUT_DIR, { force: true, recursive: true });

			const childProcess = await runLintTypes(REPO_ROOT, "--emit");

			assert.strictEqual(childProcess.stderr, "");

			const emitted = filesUnder(OUT_DIR);

			/*
			 * Exit 0 would also hold if `include` matched no files at all, so
			 * assert that every annotated source really was compiled rather
			 * than trusting the exit code on its own.
			 */
			assert.deepStrictEqual(
				missingDeclarations(emitted, checkedSources()),
				[],
			);

			/*
			 * `emitDeclarationOnly` is what keeps this a types build. Without
			 * it tsc also writes a compiled copy of every source it reaches,
			 * which is a second, silently diverging lib/ inside dist/.
			 */
			assert.deepStrictEqual(
				emitted.filter(file => !file.endsWith(".d.ts")),
				[],
			);
		});

		it("exits 0 in no-emit mode (lint:types)", async () => {
			const childProcess = await runLintTypes(REPO_ROOT);

			assert.strictEqual(childProcess.stderr, "");
		});

		/*
		 * `lib/rules/utils/ast-utils.js` is the vocabulary every rule file will
		 * annotate against, so what it emits is a contract and not just a
		 * by-product. Emitting the file at all proves nothing on its own: a
		 * declaration file made entirely of `any` is exactly what a lost or
		 * mistyped `@param` produces, and it satisfies every path- and
		 * name-based assertion above while making the whole build worthless.
		 */
		it("emits a typed node vocabulary from the rules utility hub", async () => {
			fs.rmSync(OUT_DIR, { force: true, recursive: true });

			await runLintTypes(REPO_ROOT, "--emit");

			const declarations = fs.readFileSync(
				path.join(OUT_DIR, "lib", "rules", "utils", "ast-utils.d.ts"),
				"utf8",
			);

			// The names rule files will refer to as `import(...).ASTNode`.
			assert.match(declarations, /^type ASTNode = \{$/mu);
			assert.match(declarations, /^type Token = \{$/mu);

			// A representative export, typed end to end.
			assert.match(
				declarations,
				/isTokenOnSameLine\(left: Token, right: Token\): boolean;/u,
			);

			/*
			 * The two index signatures on `ASTNode` and `Token` are the only
			 * `any` the hub is meant to expose; they are what keeps
			 * parser-specific fields readable without a cast.
			 */
			const untyped = declarations
				.split("\n")
				.filter(line => /: any\b/u.test(line))
				.filter(line => !line.includes("[key: string]: any;"));

			assert.deepStrictEqual(untyped, []);
		});
	});
});

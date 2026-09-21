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
 * Lists the names of every declaration file under a directory tree. tsc picks
 * the output layout from the common root of the compiled files, so the tree
 * shape is not fixed and only the file names are compared.
 * @param {string} dir The directory to walk.
 * @returns {Set<string>} The declaration file names found, empty if `dir` does not exist.
 */
function declarationFileNames(dir) {
	const names = new Set();

	if (!fs.existsSync(dir)) {
		return names;
	}

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			for (const name of declarationFileNames(
				path.join(dir, entry.name),
			)) {
				names.add(name);
			}
		} else if (entry.name.endsWith(".d.ts")) {
			names.add(entry.name);
		}
	}

	return names;
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
		const CHECKED_DIRECTORIES = ["lib/shared", "lib/config"];

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

		it("opts every included source into checking with // @ts-check", () => {
			assert.strictEqual(TSCONFIG_JSON.compilerOptions.checkJs, false);

			const unchecked = [];

			for (const directory of CHECKED_DIRECTORIES) {
				const directoryPath = path.join(REPO_ROOT, directory);

				for (const name of fs.readdirSync(directoryPath)) {
					if (!name.endsWith(".js")) {
						continue;
					}

					const source = fs.readFileSync(
						path.join(directoryPath, name),
						"utf8",
					);

					if (!/^\/\/ @ts-check$/mu.test(source)) {
						unchecked.push(`${directory}/${name}`);
					}
				}
			}

			assert.deepStrictEqual(unchecked, []);
		});

		it("exits 0 in emit mode (build:types)", async () => {
			const childProcess = await runLintTypes(REPO_ROOT, "--emit");

			assert.strictEqual(childProcess.stderr, "");

			/*
			 * Exit 0 would also hold if `include` matched no files at all, so
			 * assert that every annotated source really was compiled rather
			 * than trusting the exit code on its own.
			 */
			const emitted = declarationFileNames(
				path.join(REPO_ROOT, "dist", "types"),
			);
			const missing = CHECKED_DIRECTORIES.flatMap(directory =>
				fs
					.readdirSync(path.join(REPO_ROOT, directory))
					.filter(name => name.endsWith(".js"))
					.map(name => `${path.basename(name, ".js")}.d.ts`)
					.filter(name => !emitted.has(name)),
			);

			assert.deepStrictEqual(missing, []);
		});

		it("exits 0 in no-emit mode (lint:types)", async () => {
			const childProcess = await runLintTypes(REPO_ROOT);

			assert.strictEqual(childProcess.stderr, "");
		});
	});
});

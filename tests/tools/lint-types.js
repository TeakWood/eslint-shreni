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
 * Lists the declaration files emitted into a project's output directory.
 * @param {string} projectDir The project directory.
 * @returns {Array<string>} Emitted file names, empty if nothing was emitted.
 */
function emittedFiles(projectDir) {
	const outDir = path.join(projectDir, "dist", "types");

	return fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
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

		it("exits 1 and reports the error in emit mode", async () => {
			const projectDir = createProject(
				"mixed-emit",
				buildMixedTsconfig(),
			);

			await assert.rejects(
				runLintTypes(projectDir, "--emit"),
				({ code, stderr }) => {
					assert.strictEqual(code, 1);
					assert.match(stderr, /error TS6046/u);
					return true;
				},
			);
		});

		it("exits 1 and reports the error in no-emit mode", async () => {
			const projectDir = createProject(
				"mixed-noemit",
				buildMixedTsconfig(),
			);

			await assert.rejects(
				runLintTypes(projectDir),
				({ code, stderr }) => {
					assert.strictEqual(code, 1);
					assert.match(stderr, /error TS6046/u);
					return true;
				},
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

	describe("against the repository's own tsconfig.json", () => {
		it("exits 0 in emit mode (build:types)", async () => {
			const childProcess = await runLintTypes(REPO_ROOT, "--emit");

			assert.strictEqual(childProcess.stderr, "");
		});

		it("exits 0 in no-emit mode (lint:types)", async () => {
			const childProcess = await runLintTypes(REPO_ROOT);

			assert.strictEqual(childProcess.stderr, "");
		});
	});
});

/**
 * @fileoverview Guards the host-key convention every type-probe suite depends
 * on.
 *
 * The suites in this directory compile synthetic sources through an in-memory
 * `ts.CompilerHost`. Keying that host's `Map` with a platform-native path is
 * correct on POSIX and wrong on Windows, and the way it is wrong is the worst
 * available: TypeScript normalizes root names and asks the host for
 * forward-slash paths, the lookup misses, the override falls through to a file
 * that is not on disk, and the probe leaves the program without a word.
 *
 * A dropped probe reports zero diagnostics. Every `expectError` assertion —
 * "this source must NOT compile" — then passes on an empty array and states the
 * opposite of the truth, and `program.getSourceFile()` returns `undefined`,
 * which crashes the type checker when it reaches `getSymbolAtLocation`. That is
 * how 26 of the 28 Windows failures this suite exists for were produced.
 *
 * The mechanism is platform-independent, which is what makes it testable here:
 * `normalizeSlashes` rewrites backslashes on every platform, so a
 * backslash-keyed host reproduces the Windows failure exactly on macOS and
 * Linux. These tests therefore demonstrate the bug and the fix on whatever
 * platform they run on:
 *
 * 1. A native-separator key drops the probe and inverts an `expectError`.
 * 2. A `probePath` key keeps it, and the rejection it is supposed to produce is
 *    still produced.
 * 3. `assertProbesLoaded` converts (1) from a silent inversion into a failure.
 * 4. Every probe suite in this directory goes through the shared helper, so the
 *    next suite to be written inherits the convention rather than the bug.
 * @author Silpi
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { assert } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const {
	probePath,
	assertProbesLoaded,
} = require("../../_utils/type-probe-paths");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PROBE_DIR = probePath(REPO_ROOT, "lib");
const TYPES_TEST_DIR = __dirname;

const COMPILER_OPTIONS = {
	strict: true,
	skipLibCheck: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

/**
 * A probe the compiler must reject. It stands in for every `expectError` case
 * in the sibling suites: if the probe is dropped, this produces no diagnostic
 * and the assertion built on it silently inverts.
 */
const REJECTED_SOURCE = 'export const wrong: number = "not a number";\n';

/** The error code `REJECTED_SOURCE` is supposed to produce. */
const REJECTED_CODE = 2322;

/**
 * Compiles `REJECTED_SOURCE` through an in-memory host keyed on a caller-chosen
 * path, mirroring what the sibling suites build.
 * @param {string} key The path the host's content map is keyed on.
 * @returns {{program: ts.Program, diagnostics: ts.Diagnostic[], asked: string[]}}
 * The program, its diagnostics, and the paths the compiler asked the host for.
 */
function compileWithKey(key) {
	const contents = new Map([[key, REJECTED_SOURCE]]);
	const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
	const { getSourceFile, fileExists, readFile } = host;
	const asked = [];

	host.getSourceFile = (fileName, languageVersion, ...rest) => {
		asked.push(fileName);

		return contents.has(fileName)
			? ts.createSourceFile(
					fileName,
					contents.get(fileName),
					languageVersion,
					true,
				)
			: getSourceFile.call(host, fileName, languageVersion, ...rest);
	};
	host.fileExists = fileName =>
		contents.has(fileName) || fileExists.call(host, fileName);
	host.readFile = fileName =>
		contents.has(fileName)
			? contents.get(fileName)
			: readFile.call(host, fileName);

	const program = ts.createProgram([key], COMPILER_OPTIONS, host);

	return {
		program,
		diagnostics: [
			...program.getSyntacticDiagnostics(),
			...program.getSemanticDiagnostics(),
		],
		asked,
	};
}

const NORMALIZED_KEY = probePath(PROBE_DIR, "host-key-probe.ts");

/**
 * The same path in platform-native separator form.
 *
 * On Windows this is literally what `path.join` returns, so it is the real bug.
 * Elsewhere it is the same shape reached by hand, and TypeScript treats it
 * identically because `normalizeSlashes` runs on every platform — which is why
 * this suite can demonstrate a Windows-only failure without Windows.
 */
const NATIVE_KEY = NORMALIZED_KEY.replaceAll("/", "\\");

/** The probe suites whose compiler hosts this convention governs. */
const PROBE_SUITES = [
	"ast-vocabulary.js",
	"core-vocabulary.js",
	"declared-types-packages.js",
	"vendor.js",
];

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("type-probe compiler host paths", () => {
	// Each case spins up a real `tsc` program; the default 2s is tight.
	const PROBE_TIMEOUT = 60000;

	beforeEach(function () {
		this.timeout(PROBE_TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API
	});

	describe("probePath", () => {
		it("produces a path with no native separators left in it", () => {
			assert.notInclude(
				probePath(REPO_ROOT, "lib/types/core.d.ts"),
				"\\",
			);
		});

		it("still points at the same file the native form does", () => {
			const joined = path.join(REPO_ROOT, "lib/types/core.d.ts");

			assert.strictEqual(
				probePath(REPO_ROOT, "lib/types/core.d.ts"),
				joined.replaceAll(path.sep, "/"),
			);
			assert.isTrue(fs.existsSync(joined));
		});
	});

	describe("the failure a native-separator key produces", () => {
		it("makes the compiler ask for the normalized path instead", () => {
			const { asked } = compileWithKey(NATIVE_KEY);

			assert.include(
				asked,
				NORMALIZED_KEY,
				"TypeScript normalizes root names before asking the host, so the host must be keyed on the normalized form",
			);
		});

		it("drops the probe out of the program entirely", () => {
			const { program } = compileWithKey(NATIVE_KEY);

			assert.isUndefined(
				program.getSourceFile(NATIVE_KEY),
				"the probe was expected to be missing, which is the failure this convention exists to prevent",
			);
		});

		/*
		 * The reason this is worth a suite of its own. A dropped probe is not a
		 * loud failure — it is an empty diagnostic array, which is exactly what
		 * `expectError` is looking for.
		 */
		it("inverts an expectError assertion into a false pass", () => {
			const { diagnostics } = compileWithKey(NATIVE_KEY);

			assert.isEmpty(
				diagnostics,
				"a dropped probe reports nothing; if this ever stops being true the demonstration below is no longer meaningful",
			);
		});
	});

	describe("the fix", () => {
		it("keeps the probe in the program", () => {
			const { program } = compileWithKey(NORMALIZED_KEY);

			assert.isDefined(program.getSourceFile(NORMALIZED_KEY));
		});

		/*
		 * The acceptance test for this whole change: a probe that ought to be
		 * rejected still produces a non-empty diagnostic array under the
		 * separator form Windows hands the suites, so `expectError` is
		 * constraining something rather than passing on silence.
		 */
		it("still rejects a probe that ought to be rejected", () => {
			const { diagnostics } = compileWithKey(NORMALIZED_KEY);

			assert.isNotEmpty(diagnostics);
			assert.includeMembers(
				diagnostics.map(diagnostic => diagnostic.code),
				[REJECTED_CODE],
			);
		});
	});

	describe("assertProbesLoaded", () => {
		it("throws for a probe the compiler never loaded", () => {
			const { program } = compileWithKey(NATIVE_KEY);

			assert.throws(
				() => assertProbesLoaded(program, [NATIVE_KEY]),
				/not in the compiled program/u,
			);
		});

		it("passes for a probe the compiler loaded", () => {
			const { program } = compileWithKey(NORMALIZED_KEY);

			// Throwing is the failure — there is nothing else to assert here.
			assertProbesLoaded(program, [NORMALIZED_KEY]);

			assert.isDefined(program.getSourceFile(NORMALIZED_KEY));
		});
	});

	/*
	 * Fixing the call sites does not stop the next suite from reintroducing
	 * the bug: this pattern is the epic's established convention and every
	 * remaining annotation bead copies it. These two checks are what make the
	 * convention enforced rather than merely documented.
	 */
	describe("the convention", () => {
		it("is followed by every probe suite in this directory", () => {
			for (const suite of PROBE_SUITES) {
				const source = fs.readFileSync(
					path.join(TYPES_TEST_DIR, suite),
					"utf8",
				);

				assert.include(
					source,
					'require("../../_utils/type-probe-paths")',
					`${suite} builds a compiler host but does not use the shared probe-path helper`,
				);
				assert.include(
					source,
					"assertProbesLoaded(",
					`${suite} does not assert its probes made it into the program, so a bad host key would fail silently`,
				);
			}
		});

		it("catches a new suite that builds a host without it", () => {
			const unchecked = [];

			for (const entry of fs.readdirSync(TYPES_TEST_DIR)) {
				if (
					!entry.endsWith(".js") ||
					entry === path.basename(__filename)
				) {
					continue;
				}

				const source = fs.readFileSync(
					path.join(TYPES_TEST_DIR, entry),
					"utf8",
				);

				if (
					source.includes("ts.createCompilerHost(") &&
					!source.includes('require("../../_utils/type-probe-paths")')
				) {
					unchecked.push(entry);
				}
			}

			assert.deepStrictEqual(
				unchecked,
				[],
				"these suites build an in-memory compiler host without probePath()/assertProbesLoaded(), so their probes can be silently dropped on Windows",
			);
		});
	});
});

/**
 * @fileoverview Demonstrates that growing the type-check allowlist cannot
 * surface errors from files that have not been annotated yet.
 *
 * The trap this guards against: a `tsconfig.json` `files`/`include` list
 * selects only the ROOT files of the program. Every file those roots require
 * is pulled in as well, and under `checkJs: true` it is type-checked with
 * them. On a codebase converting incrementally that makes the gate unusable —
 * adding one annotated module drags its entire un-annotated dependency subtree
 * into the build and fails on code nobody has touched.
 *
 * The mechanism this repo uses instead is `checkJs: false` in
 * `tsconfig.base.json` plus a per-file `@ts-check` pragma. Membership in the
 * allowlist puts a file in the program; the pragma is what turns checking on.
 * A required file with no pragma is parsed and used for inference but never
 * reported on, so conversion order is independent of the dependency graph.
 *
 * These tests exercise that claim against the real compiler rather than
 * restating it:
 *
 * 1. Traversal genuinely happens — files outside the allowlist are in the
 *    program, so the trap is not hypothetical.
 * 2. Adding an annotated file that requires an un-annotated subtree produces
 *    no errors.
 * 3. The same file set with `checkJs: true` DOES error, and every error comes
 *    from an un-annotated file — so the clean result in (2) is the mechanism
 *    working, not an accident of what is currently in the allowlist.
 * 4. Checking is actually on for annotated files — a broken annotated file is
 *    still reported. Without this, (2) would be satisfied by a compiler that
 *    checks nothing.
 * @author Silpi
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { assert } = require("chai");
const path = require("node:path");
const ts = require("typescript");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, "../../..");
const TSCONFIG_PATH = path.join(ROOT_DIR, "tsconfig.json");

const FIXTURE_DIR = path.join(
	ROOT_DIR,
	"tests/fixtures/types/allowlist-growth",
);

/** An annotated file requiring an un-annotated subtree. */
const ANNOTATED_CONSUMER = path.join(FIXTURE_DIR, "annotated-consumer.js");

/** An annotated file with a deliberate type error. */
const ANNOTATED_WITH_ERROR = path.join(FIXTURE_DIR, "annotated-with-error.js");

/**
 * The un-annotated module `annotated-consumer.js` reaches for.
 *
 * This was `lib/rules/utils/ast-utils.js` until that file was annotated, at
 * which point the guard below fired and said so. It is now a rule module:
 * `lib/rules/` is outside this epic's phases 0-2 entirely, so it will stay
 * un-annotated for longer than anything in `lib/shared` or
 * `lib/rules/utils`. When it too is converted, this constant, the fixture in
 * `tests/fixtures/types/allowlist-growth/` and the two assertions naming it
 * all move together.
 */
const UNANNOTATED_DEPENDENCY = path.join(
	ROOT_DIR,
	"lib/rules/no-unused-vars.js",
);

/** `UNANNOTATED_DEPENDENCY` as the diagnostics and traversal lists spell it. */
const UNANNOTATED_DEPENDENCY_NAME = "lib/rules/no-unused-vars.js";

/**
 * Loads the real gate configuration, so these tests describe the shipped
 * `tsconfig.json` rather than a copy of it that can drift.
 * @returns {ts.ParsedCommandLine} The parsed configuration.
 */
function loadGateConfig() {
	const parsed = ts.getParsedCommandLineOfConfigFile(
		TSCONFIG_PATH,
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic(diagnostic) {
				throw new Error(
					ts.flattenDiagnosticMessageText(
						diagnostic.messageText,
						" ",
					),
				);
			},
		},
	);

	assert.isDefined(parsed, "tsconfig.json could not be parsed");

	return parsed;
}

const gateConfig = loadGateConfig();

/**
 * Builds a program from the gate's allowlist plus extra root files.
 * @param {object} [options] Options.
 * @param {string[]} [options.extraRootFiles] Additional root files.
 * @param {boolean} [options.checkJs] Overrides the gate's `checkJs` setting.
 * @returns {ts.Program} The program.
 */
function createProgram({ extraRootFiles = [], checkJs } = {}) {
	const compilerOptions = { ...gateConfig.options };

	if (checkJs !== void 0) {
		compilerOptions.checkJs = checkJs;
	}

	return ts.createProgram(
		[...gateConfig.fileNames, ...extraRootFiles],
		compilerOptions,
	);
}

/**
 * Collects the diagnostics the gate would report.
 *
 * Only syntactic and semantic diagnostics are gathered: those are what a type
 * error surfaces as, and they are the categories `tsc -p tsconfig.json`
 * fails on for this project.
 * @param {ts.Program} program The program to check.
 * @returns {Array<{file: string, message: string}>} The diagnostics, with
 * repo-relative file paths.
 */
function getDiagnostics(program) {
	return [
		...program.getSyntacticDiagnostics(),
		...program.getSemanticDiagnostics(),
	].map(diagnostic => ({
		file: diagnostic.file
			? path
					.relative(ROOT_DIR, diagnostic.file.fileName)
					.replaceAll(path.sep, "/")
			: "(no file)",
		message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
	}));
}

/**
 * Lists the JavaScript files a program contains that were not given to it as
 * root files — that is, the ones import traversal pulled in.
 * @param {ts.Program} program The program to inspect.
 * @param {string[]} rootFiles The root files the program was built from.
 * @returns {string[]} Repo-relative paths.
 */
function getTraversedFiles(program, rootFiles) {
	const roots = new Set(rootFiles.map(file => path.resolve(ROOT_DIR, file)));

	return program
		.getSourceFiles()
		.filter(file => !file.isDeclarationFile)
		.filter(file => !file.fileName.includes("/node_modules/"))
		.filter(file => file.fileName.endsWith(".js"))
		.filter(file => !roots.has(path.resolve(file.fileName)))
		.map(file =>
			path.relative(ROOT_DIR, file.fileName).replaceAll(path.sep, "/"),
		);
}

/**
 * Formats diagnostics for an assertion message.
 * @param {Array<{file: string, message: string}>} diagnostics The diagnostics.
 * @returns {string} A readable summary.
 */
function format(diagnostics) {
	return diagnostics
		.slice(0, 10)
		.map(({ file, message }) => `  ${file}: ${message}`)
		.join("\n");
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("allowlist growth vs. import traversal", () => {
	// Building programs over the allowlist is a real compile; the default 2s is tight.
	const TIMEOUT = 120000;

	beforeEach(function () {
		this.timeout(TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API
	});

	describe("the trap is real", () => {
		it("pulls files into the program that the allowlist does not name", () => {
			const program = createProgram();
			const traversed = getTraversedFiles(program, gateConfig.fileNames);

			assert.isAbove(
				traversed.length,
				0,
				"No file outside the allowlist reached the program, so this suite is not testing anything. Import traversal is what these tests exist to constrain.",
			);
		});

		it("pulls in an un-annotated file when an annotated file requires it", () => {
			const rootFiles = [...gateConfig.fileNames, ANNOTATED_CONSUMER];
			const program = createProgram({
				extraRootFiles: [ANNOTATED_CONSUMER],
			});

			const traversed = getTraversedFiles(program, rootFiles);

			assert.include(
				traversed,
				UNANNOTATED_DEPENDENCY_NAME,
				"The un-annotated dependency was not pulled into the program, so the demonstration below would be vacuous.",
			);

			assert.isFalse(
				program
					.getSourceFile(UNANNOTATED_DEPENDENCY)
					.text.startsWith("// @ts-check"),
				`${UNANNOTATED_DEPENDENCY_NAME} has been annotated. Point this demonstration at a file that still has not been, or it no longer demonstrates anything.`,
			);
		});
	});

	describe("the mechanism holds", () => {
		it("reports nothing for the allowlist as shipped", () => {
			const diagnostics = getDiagnostics(createProgram());

			assert.deepStrictEqual(
				diagnostics,
				[],
				`The shipped allowlist does not type-check:\n${format(diagnostics)}`,
			);
		});

		it("reports nothing when an annotated file drags in an un-annotated subtree", () => {
			const diagnostics = getDiagnostics(
				createProgram({ extraRootFiles: [ANNOTATED_CONSUMER] }),
			);

			assert.deepStrictEqual(
				diagnostics,
				[],
				`Adding an annotated file to the allowlist surfaced errors from files it merely requires. The checkJs:false + per-file pragma mechanism is no longer holding:\n${format(diagnostics)}`,
			);
		});

		it("keeps checkJs off, which is what makes that work", () => {
			assert.isNotTrue(
				gateConfig.options.checkJs,
				"checkJs is enabled. Every un-annotated file reachable from the allowlist is now type-checked, which breaks incremental conversion — see the counterfactual below.",
			);
		});
	});

	describe("the mechanism is load-bearing, not a coincidence", () => {
		it("would report errors from un-annotated files if checkJs were on", () => {
			const diagnostics = getDiagnostics(
				createProgram({
					extraRootFiles: [ANNOTATED_CONSUMER],
					checkJs: true,
				}),
			);

			assert.isAbove(
				diagnostics.length,
				0,
				"Enabling checkJs produced no errors, so `checkJs: false` is not what is keeping the gate green and this suite proves nothing.",
			);

			const fromUnannotated = diagnostics.filter(
				({ file }) => file === UNANNOTATED_DEPENDENCY_NAME,
			);

			assert.isAbove(
				fromUnannotated.length,
				0,
				"The errors checkJs surfaced did not come from the un-annotated dependency, which is the case this mechanism exists to suppress.",
			);
		});
	});

	describe("annotated files are genuinely checked", () => {
		it("reports errors in an annotated file", () => {
			const diagnostics = getDiagnostics(
				createProgram({ extraRootFiles: [ANNOTATED_WITH_ERROR] }),
			);

			const fromFixture = diagnostics.filter(({ file }) =>
				file.endsWith("annotated-with-error.js"),
			);

			assert.isAbove(
				fromFixture.length,
				0,
				"A file carrying a `// @ts-check` pragma and a deliberate type error was not reported. Checking is off entirely, which would make every other result in this suite meaningless.",
			);
		});
	});
});

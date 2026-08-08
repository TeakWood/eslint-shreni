/**
 * @fileoverview Tests for the two build-configuration invariants that hold the
 * CI baseline green.
 *
 * Both are consequences of this epic rather than of any product code, both are
 * held closed by configuration alone, and both are the kind of thing a later
 * edit can undo without anything failing until CI runs:
 *
 * 1. `knip.jsonc` declares `lib/eslint/worker.js` as an **entry point**. The
 *    baseline type strip deleted the only static reference to it, so Knip
 *    reports it as unused and `npm run lint:unused` exits 1. This entry is a
 *    stopgap that a phase 3+ bead has to delete; the obligation is recorded in
 *    the design note, and this suite checks that it still is.
 * 2. `tsconfig.json` carries a top-level `ts-node` key setting
 *    `ignoreDeprecations`, so Cypress can load `cypress.config.js` through its
 *    bundled ts-node under TypeScript 6 — while the real type-check gate keeps
 *    reporting deprecations.
 *
 * The ts-node half is proved against the real compiler rather than asserted:
 * the merge ts-node performs is replicated, and TS5107 has to be present
 * without the key's compiler options and absent with them.
 *
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

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, "../../..");
const KNIP_PATH = path.join(ROOT_DIR, "knip.jsonc");
const TSCONFIG_PATH = path.join(ROOT_DIR, "tsconfig.json");
const TSCONFIG_BASE_PATH = path.join(ROOT_DIR, "tsconfig.base.json");
const CYPRESS_CONFIG_PATH = path.join(ROOT_DIR, "cypress.config.js");
const DESIGN_NOTE_PATH = path.join(
	ROOT_DIR,
	".shreni/design/typescript-types-from-jsdoc.md",
);

const WORKER_ENTRY = "lib/eslint/worker.js";

/**
 * `Option 'moduleResolution=node10' is deprecated ...` — the diagnostic that
 * kills Cypress while it loads its config file.
 * @type {number}
 */
const TS_DEPRECATED_OPTION = 5107;

/**
 * Reads a JSONC config.
 *
 * TypeScript's own parser is used rather than a comment-stripping regex: both
 * files here carry trailing commas and `knip.jsonc` has trailing `//` comments
 * on content lines, next to string values that themselves contain `//`.
 * @param {string} filePath Absolute path to a JSONC file.
 * @returns {any} The parsed value.
 */
function readJsonc(filePath) {
	const { config, error } = ts.parseConfigFileTextToJson(
		filePath,
		fs.readFileSync(filePath, "utf8"),
	);

	assert.isUndefined(
		error,
		`${filePath} is not valid JSONC: ${error && ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
	);

	return config;
}

/**
 * Resolves the shipped `tsconfig.json` the way the compiler does, following
 * `extends` into `tsconfig.base.json`.
 * @returns {import("typescript").ParsedCommandLine} The resolved config.
 */
function resolveShippedConfig() {
	const parsed = ts.getParsedCommandLineOfConfigFile(
		TSCONFIG_PATH,
		{},
		/** @type {any} */ ({
			getCurrentDirectory: () => ROOT_DIR,
			useCaseSensitiveFileNames: true,
			readDirectory: ts.sys.readDirectory,
			fileExists: ts.sys.fileExists,
			readFile: ts.sys.readFile,
			onUnRecoverableConfigFileDiagnostic(diagnostic) {
				throw new Error(
					ts.flattenDiagnosticMessageText(
						diagnostic.messageText,
						" ",
					),
				);
			},
		}),
	);

	assert.isDefined(parsed, "tsconfig.json failed to resolve");

	return parsed;
}

/**
 * The compiler options the type-check gate actually runs under.
 * @returns {import("typescript").CompilerOptions} The resolved options.
 */
function resolveShippedCompilerOptions() {
	return resolveShippedConfig().options;
}

/**
 * Reproduces what Cypress's bundled ts-node hands the compiler when it loads
 * `cypress.config.js`, and reports the resulting option diagnostics.
 *
 * ts-node merges, in order: the compiler options resolved from the tsconfig
 * file, then the tsconfig's own `ts-node.compilerOptions`, then the options the
 * embedder passed through the API. Cypress passes
 * `{ module: "commonjs", moduleResolution: "node" }`, which is why `node10`
 * arrives here no matter what the tsconfig says — and why the deprecation has
 * to be silenced rather than avoided.
 * @param {import("typescript").CompilerOptions} [tsNodeOptions] The tsconfig's
 *      `ts-node.compilerOptions`, or nothing to model the key being absent.
 * @returns {number[]} The option diagnostic codes the compiler reports.
 */
function cypressOptionDiagnosticCodes(tsNodeOptions = {}) {
	const options = {
		...resolveShippedCompilerOptions(),
		...tsNodeOptions,

		// Hard-coded by Cypress, and not overridable from this repo.
		module: ts.ModuleKind.CommonJS,
		moduleResolution: ts.ModuleResolutionKind.Node10,
	};

	const program = ts.createProgram([CYPRESS_CONFIG_PATH], options);

	return program.getOptionsDiagnostics().map(diagnostic => diagnostic.code);
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("CI baseline configuration", () => {
	describe("knip: lib/eslint/worker.js", () => {
		let knip;

		before(() => {
			knip = readJsonc(KNIP_PATH);
		});

		it("is declared as an entry point of the root workspace", () => {
			assert.include(
				knip.workspaces["."].entry,
				WORKER_ENTRY,
				`${WORKER_ENTRY} is loaded only through pathToFileURL, which Knip cannot follow, and the static @import tag that used to keep it reachable was removed by the baseline type strip. Without this entry, "npm run lint:unused" reports it as unused and exits 1.`,
			);
		});

		it("is not merely ignored", () => {
			/*
			 * `ignore` would silence the report without stating anything true,
			 * and would also suppress any real future finding inside the file.
			 */
			assert.notInclude(
				knip.workspaces["."].ignore ?? [],
				WORKER_ENTRY,
				`${WORKER_ENTRY} belongs in "entry", not "ignore" — it genuinely is a worker-thread entry point.`,
			);
		});

		it("still exists, so the entry is not stale", () => {
			assert.isTrue(
				fs.existsSync(path.join(ROOT_DIR, WORKER_ENTRY)),
				`${WORKER_ENTRY} no longer exists; remove its knip.jsonc entry.`,
			);
		});

		it("has its retirement obligation recorded in the design note", () => {
			/*
			 * The entry is a stopgap. It has to be deleted by whichever phase 3+
			 * bead restores the `@import` tag at lib/eslint/eslint.js, and that
			 * bead's author reads the design note, not this bead.
			 */
			const note = fs.readFileSync(DESIGN_NOTE_PATH, "utf8");

			assert.include(
				note,
				WORKER_ENTRY,
				"the design note must name the file whose knip entry has to be retired",
			);
			assert.match(
				note,
				/must delete\s+[\s\S]{0,80}knip\.jsonc/u,
				"the design note must state the obligation to delete the knip entry when lib/eslint/eslint.js is annotated",
			);
		});
	});

	describe("ts-node: ignoreDeprecations", () => {
		let tsconfig;

		before(() => {
			tsconfig = readJsonc(TSCONFIG_PATH);
		});

		it("is set under the top-level ts-node key", () => {
			assert.strictEqual(
				tsconfig["ts-node"]?.compilerOptions?.ignoreDeprecations,
				"6.0",
				'Cypress loads cypress.config.js through its bundled ts-node with moduleResolution: "node" hard-coded, which is a hard error (TS5107) under TypeScript 6.',
			);
		});

		it("is not in compilerOptions of either tsconfig, so the gate still reports deprecations", () => {
			/*
			 * This is the whole point of scoping the key. Both placements make
			 * Cypress load and both leave `tsc` at exit 0, so nothing else in
			 * the repo would notice the type-check gate going quiet.
			 */
			assert.notProperty(
				tsconfig.compilerOptions ?? {},
				"ignoreDeprecations",
				"tsconfig.json's compilerOptions must not silence deprecations for the type-check gate",
			);
			assert.notProperty(
				readJsonc(TSCONFIG_BASE_PATH).compilerOptions ?? {},
				"ignoreDeprecations",
				"tsconfig.base.json's compilerOptions must not silence deprecations for the type-check gate",
			);
			assert.notProperty(
				resolveShippedCompilerOptions(),
				"ignoreDeprecations",
				"the resolved gate options must not carry ignoreDeprecations",
			);
		});

		it("is ignored by tsc, which does not reject the unknown top-level key", () => {
			const errors = resolveShippedConfig().errors.map(diagnostic =>
				ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
			);

			assert.deepStrictEqual(
				errors,
				[],
				"tsc must resolve tsconfig.json cleanly with the ts-node key present",
			);
		});

		it("silences TS5107 for the options Cypress injects", () => {
			assert.notInclude(
				cypressOptionDiagnosticCodes(
					tsconfig["ts-node"].compilerOptions,
				),
				TS_DEPRECATED_OPTION,
				"Cypress cannot load its config file: TypeScript still reports moduleResolution=node10 as deprecated",
			);
		});

		it("is load-bearing — TS5107 is reported without it", () => {
			/*
			 * The counterfactual. Without this, the previous test would also
			 * pass on a TypeScript release that stopped reporting TS5107 at
			 * all, and the key could be deleted with nothing failing until
			 * Browser Test ran.
			 */
			assert.include(
				cypressOptionDiagnosticCodes(),
				TS_DEPRECATED_OPTION,
				"expected TypeScript to report TS5107 for the moduleResolution Cypress injects; if it no longer does, the ts-node key in tsconfig.json can be retired",
			);
		});
	});
});

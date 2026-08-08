/**
 * @fileoverview Guards the annotation of the four dependency-blocked files in
 * `lib/shared/` — `ajv.js`, `traverser.js`, `translate-cli-options.js` and
 * `runtime-info.js`.
 *
 * Unlike the ambient declarations in `vendor.d.ts`, these four ARE exercised by
 * the shipped gate: they sit in the `tsconfig.json` allowlist, so `tsc` compiles
 * them for real. What `tsc` cannot tell anyone is whether the annotations
 * actually produced types at the call site. A parameter left undocumented is
 * an implicit `any` in a `.js` file, and `any` type-checks clean forever — so
 * "the gate is green" and "the module is typed" are different claims.
 *
 * These probes assert the second one, and are two-sided for exactly that
 * reason: every positive probe is paired with a negative one that must be
 * REJECTED, because a signature that had decayed to `any` would accept both.
 *
 * The suite also pins the structural property this layer is built on:
 * `lib/shared` requires nothing else inside `lib/`. That is what makes it
 * annotatable first, and nothing else in the repo checks it.
 * @author Silpi
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert;
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
const SHARED_DIR = path.join(REPO_ROOT, "lib/shared");

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so that both bare specifiers and the relative `./shared/...` imports
 * resolve exactly as they do for a real source file.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/**
 * The hand-authored ambient declarations. `translate-cli-options.js` cannot be
 * typed without the `@humanwhocodes/module-importer` block, and nothing pulls
 * an ambient block into a program implicitly — the shipped gate gets it from
 * the `tsconfig.json` allowlist, so a probe program has to name it as a root
 * the same way.
 */
const VENDOR_DTS = probePath(REPO_ROOT, "lib/types/vendor.d.ts");

/**
 * The four files this bead annotated, and the reason each was blocked until now.
 */
const ANNOTATED_FILES = [
	"lib/shared/ajv.js",
	"lib/shared/runtime-info.js",
	"lib/shared/translate-cli-options.js",
	"lib/shared/traverser.js",
];

/**
 * Mirrors the resolution- and inference-relevant options of the shipped gate
 * (`tsconfig.base.json`).
 *
 * `allowJs` is what lets a probe import the annotated `.js` sources at all, and
 * `checkJs` stays off for the same reason the gate keeps it off: a probe must
 * not be able to fail because of an unconverted file somewhere downstream.
 * `resolveJsonModule` is not optional here — `ajv.js` requires the draft-04
 * meta-schema and `runtime-info.js` requires `package.json`.
 */
const COMPILER_OPTIONS = {
	strict: true,
	allowJs: true,
	checkJs: false,
	resolveJsonModule: true,
	skipLibCheck: true,
	noEmit: true,
	types: ["node"],
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

/**
 * Compiles synthetic TypeScript sources against the real `lib/` and the
 * installed `node_modules`.
 * @param {Record<string, string>} files Probe file name to contents.
 * @returns {{program: ts.Program, diagnostics: ts.Diagnostic[]}} The compiled program and its diagnostics.
 */
function compile(files) {
	/*
	 * Keys MUST be forward-slash normalized with `probePath`, never bare
	 * `path.join`: TypeScript normalizes root names and asks the host for
	 * forward-slash paths on every platform, so a Windows-native key never
	 * matches and the probe is dropped from the program without a word.
	 */
	const contents = new Map(
		Object.entries(files).map(([name, text]) => [
			probePath(PROBE_DIR, name),
			text,
		]),
	);

	const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
	const { getSourceFile, fileExists, readFile } = host;

	host.getSourceFile = (fileName, languageVersion, ...rest) =>
		contents.has(fileName)
			? ts.createSourceFile(
					fileName,
					contents.get(fileName),
					languageVersion,
					true,
				)
			: getSourceFile.call(host, fileName, languageVersion, ...rest);
	host.fileExists = fileName =>
		contents.has(fileName) || fileExists.call(host, fileName);
	host.readFile = fileName =>
		contents.has(fileName)
			? contents.get(fileName)
			: readFile.call(host, fileName);

	const roots = [VENDOR_DTS, ...contents.keys()];
	const program = ts.createProgram(roots, COMPILER_OPTIONS, host);

	assertProbesLoaded(program, roots);

	return {
		program,
		diagnostics: [
			...program.getSyntacticDiagnostics(),
			...program.getSemanticDiagnostics(),
		],
	};
}

/**
 * Formats diagnostics into a readable failure message.
 * @param {ts.Diagnostic[]} diagnostics The diagnostics to format.
 * @returns {string} One `TSxxxx: message` line per diagnostic.
 */
function format(diagnostics) {
	return diagnostics
		.map(
			diagnostic =>
				`TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
		)
		.join("\n");
}

/**
 * Compiles a probe and asserts it produces no diagnostics.
 * @param {string} name The probe file name.
 * @param {string} source The probe source.
 * @returns {void}
 */
function expectClean(name, source) {
	const { diagnostics } = compile({ [name]: source });

	assert.strictEqual(
		diagnostics.length,
		0,
		`probe was expected to compile clean but did not:\n${format(diagnostics)}`,
	);
}

/**
 * Compiles a probe and asserts the compiler rejected it with a given error.
 *
 * The specific code matters. Asserting merely "some diagnostic" would let a
 * probe that fails for an unrelated reason — a typo, a bad import — stand in
 * for the constraint being tested.
 * @param {string} name The probe file name.
 * @param {string} source The probe source.
 * @param {number} code The expected TypeScript error code.
 * @returns {void}
 */
function expectError(name, source, code) {
	const { diagnostics } = compile({ [name]: source });

	assert.isNotEmpty(
		diagnostics,
		"probe was expected to be rejected but compiled clean, so the annotation is not constraining anything",
	);
	assert.include(
		diagnostics.map(diagnostic => diagnostic.code),
		code,
		`probe was rejected, but not for the expected reason:\n${format(diagnostics)}`,
	);
}

/**
 * Reads every `require()` and dynamic `import()` specifier out of a source file.
 *
 * `import()` is included because it is the other way a module edge is created —
 * `lib/eslint/eslint-helpers.js` already reaches `@humanfs/node` that way — and
 * a leaf invariant that only looked at `require` would miss it.
 * @param {string} filePath Absolute path to a JavaScript file.
 * @returns {string[]} The specifiers, in source order.
 */
function importedSpecifiers(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const specifiers = [];
	const pattern = /\b(?:require|import)\(\s*"([^"]+)"\s*\)/gu;
	let match;

	while ((match = pattern.exec(source)) !== null) {
		specifiers.push(match[1]);
	}

	return specifiers;
}

/**
 * A realistic set of parsed CLI options, as `optionator` produces them.
 *
 * Written once and shared by the positive and negative `translateOptions`
 * probes so that the only difference between them is the member under test.
 */
const CLI_OPTIONS_LITERAL = `{
	cache: false,
	cacheFile: ".eslintcache",
	cacheStrategy: "metadata",
	concurrency: "off",
	configLookup: true,
	errorOnUnmatchedPattern: true,
	fix: false,
	fixDryRun: false,
	ignore: true,
	inlineConfig: true,
	quiet: false,
	stats: false,
	warnIgnored: true,
	passOnNoPatterns: false,
	maxWarnings: -1,
}`;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lib/shared type annotations", () => {
	describe("the leaf invariant", () => {
		/*
		 * This is why `lib/shared` could be annotated before anything else, and
		 * it is a property a single innocuous `require("../linter/...")` would
		 * destroy. Nothing else in the repo checks it.
		 */
		it("requires nothing else inside lib/", () => {
			const offenders = [];

			for (const entry of fs.readdirSync(SHARED_DIR)) {
				if (!entry.endsWith(".js")) {
					continue;
				}

				const filePath = path.join(SHARED_DIR, entry);

				for (const specifier of importedSpecifiers(filePath)) {
					if (!specifier.startsWith(".")) {
						continue;
					}

					const resolved = path.resolve(SHARED_DIR, specifier);

					/*
					 * Reaching out of `lib/` entirely is fine — `runtime-info.js`
					 * reads the root `package.json`. Reaching into another part
					 * of `lib/` is what breaks the layering.
					 */
					if (
						resolved.startsWith(
							`${path.join(REPO_ROOT, "lib")}${path.sep}`,
						) &&
						!resolved.startsWith(`${SHARED_DIR}${path.sep}`)
					) {
						offenders.push(`lib/shared/${entry} -> ${specifier}`);
					}
				}
			}

			assert.deepStrictEqual(
				offenders,
				[],
				"lib/shared is the leaf of the dependency graph and must not require anything else inside lib/",
			);
		});
	});

	describe("the allowlist", () => {
		/*
		 * `types.js` already checks that the allowlist and the pragmas agree in
		 * both directions. What it cannot check is that these four particular
		 * files are converted at all — dropping one would simply shrink the
		 * allowlist, consistently.
		 */
		it("covers all four dependency-blocked files", () => {
			const tsconfig = ts.parseConfigFileTextToJson(
				path.join(REPO_ROOT, "tsconfig.json"),
				fs.readFileSync(path.join(REPO_ROOT, "tsconfig.json"), "utf8"),
			);

			assert.isUndefined(tsconfig.error);

			for (const file of ANNOTATED_FILES) {
				assert.include(tsconfig.config.files, file);
				assert.isTrue(
					fs
						.readFileSync(path.join(REPO_ROOT, file), "utf8")
						.startsWith("// @ts-check\n"),
					`${file} must carry a @ts-check pragma to actually be checked`,
				);
			}
		});
	});

	describe("ajv.js", () => {
		it("types the factory's options and its return value", () => {
			expectClean(
				"probe-ajv.ts",
				`import createAjv = require("./shared/ajv.js");

				const ajv = createAjv({ verbose: true });
				const text: string = ajv.errorsText();
				const withoutOptions = createAjv();

				void text;
				void withoutOptions;`,
			);
		});

		it("rejects an option ajv does not have", () => {
			expectError(
				"probe-ajv-bad-option.ts",
				`import createAjv = require("./shared/ajv.js");

				createAjv({ notAnAjvOption: true });`,
				2353,
			);
		});
	});

	describe("traverser.js", () => {
		it("types the visitor callbacks against the node vocabulary", () => {
			expectClean(
				"probe-traverser.ts",
				`import Traverser = require("./shared/traverser.js");
				import type { ASTNode } from "./types/core.js";

				declare const program: ASTNode;

				Traverser.traverse(program, {
					enter(node, parent) {
						const type: string = node.type;
						const ancestor: ASTNode | null = parent;

						void type;
						void ancestor;
					},
				});

				const traverser = new Traverser();
				const current: ASTNode | null = traverser.current();
				const parents: ASTNode[] = traverser.parents();

				void current;
				void parents;`,
			);
		});

		it("rejects a visitor that misreads the node it is handed", () => {
			expectError(
				"probe-traverser-bad-visitor.ts",
				`import Traverser = require("./shared/traverser.js");
				import type { ASTNode } from "./types/core.js";

				declare const program: ASTNode;

				Traverser.traverse(program, {
					enter(node) {
						const type: number = node.type;

						void type;
					},
				});`,
				2322,
			);
		});

		it("rejects traversing something that is not a node", () => {
			expectError(
				"probe-traverser-bad-root.ts",
				`import Traverser = require("./shared/traverser.js");

				Traverser.traverse("not a node", {});`,
				2345,
			);
		});
	});

	describe("runtime-info.js", () => {
		it("types both exported functions as returning strings", () => {
			expectClean(
				"probe-runtime-info.ts",
				`import runtimeInfo = require("./shared/runtime-info.js");

				const version: string = runtimeInfo.version();
				const environment: string = runtimeInfo.environment();

				void version;
				void environment;`,
			);
		});

		it("rejects treating a version as anything but a string", () => {
			expectError(
				"probe-runtime-info-bad.ts",
				`import runtimeInfo = require("./shared/runtime-info.js");

				const version: number = runtimeInfo.version();

				void version;`,
				2322,
			);
		});
	});

	describe("translate-cli-options.js", () => {
		it("types the CLI options it accepts and the options it returns", () => {
			expectClean(
				"probe-translate.ts",
				`import translateOptions = require("./shared/translate-cli-options.js");

				async function main() {
					const options = await translateOptions(${CLI_OPTIONS_LITERAL});
					const overrideConfig = options.overrideConfig;
					const runs: boolean = options.ruleFilter({
						ruleId: "no-undef",
						severity: 2,
					});

					void overrideConfig;
					void runs;
				}

				void main;`,
			);
		});

		it("rejects a CLI option of the wrong type", () => {
			expectError(
				"probe-translate-bad-option.ts",
				`import translateOptions = require("./shared/translate-cli-options.js");

				void translateOptions({
					...${CLI_OPTIONS_LITERAL},
					maxWarnings: "unlimited",
				});`,
				2322,
			);
		});

		it("rejects a rule filter called with a non-severity", () => {
			expectError(
				"probe-translate-bad-filter.ts",
				`import translateOptions = require("./shared/translate-cli-options.js");

				async function main() {
					const options = await translateOptions(${CLI_OPTIONS_LITERAL});

					options.ruleFilter({ ruleId: "no-undef", severity: 3 });
				}

				void main;`,
				2322,
			);
		});
	});
});

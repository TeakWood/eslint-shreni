/**
 * @fileoverview Tests that `@eslint/js` ships types a consumer can actually
 * resolve.
 *
 * Getting declarations EMITTED is not the same as getting them RESOLVED, and
 * this epic already has a first-hand example of the gap:
 * `@humanwhocodes/module-importer` ships `dist/module-importer.d.ts` AND sets a
 * top-level `types` field, and TypeScript still cannot see either — because its
 * `exports` map has no `types` condition, and once an `exports` map is present
 * the top-level `types` field is ignored. We hand-wrote an ambient module in
 * `lib/types/vendor.d.ts` to work around somebody else's version of that bug.
 *
 * So this suite does not assert the wiring, it exercises it:
 *
 * 1. `packages/js/package.json` puts a `types` condition FIRST inside every
 *    `exports` entry. Conditions are matched in declaration order, so a `types`
 *    key placed after `default` is unreachable.
 * 2. A synthetic consumer resolves `@eslint/js` and gets the real types under
 *    all three supported resolution modes — node16 from CJS, node16 from ESM,
 *    and bundler.
 * 3. Those types are the exact rule-name literals, not `any` and not a widened
 *    `Record<string, string>`, so a mistyped rule name in an `eslint.config.ts`
 *    is a compile error.
 * 4. Nothing outside the package is needed to type-check it. `eslint` is an
 *    OPTIONAL peer dependency, so a declaration that reached for the main
 *    package's vocabulary would break for consumers who never installed it.
 * 5. `@arethetypeswrong/cli` reports no problems against the packed tarball,
 *    which is the same check from the packaging side rather than the compiler
 *    side — including the runtime half neither the compiler nor a `.d.ts` can
 *    see, that Node's `cjs-module-lexer` really can find the named exports the
 *    declarations promise.
 * @author Silpi
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { assert } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const {
	probePath,
	assertProbesLoaded,
} = require("../../_utils/type-probe-paths");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages/js");
const PACKAGE_MANIFEST_PATH = path.join(PACKAGE_DIR, "package.json");
const EMIT_CONFIG_PATH = path.join(PACKAGE_DIR, "tsconfig.types.json");

/*
 * The probe lives at the repo root so that `@eslint/js` resolves through the
 * real `node_modules/` the same way it does for any other consumer — the
 * workspace install symlinks the package there.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/** Launched through Node rather than the `.bin` shim, which Windows cannot run. */
const TSC_PATH = path.join(REPO_ROOT, "node_modules/typescript/bin/tsc");
const ATTW_PATH = path.join(
	REPO_ROOT,
	"node_modules/@arethetypeswrong/cli/dist/index.js",
);

const manifest = JSON.parse(fs.readFileSync(PACKAGE_MANIFEST_PATH, "utf8"));

/**
 * The `exports` entries that select a file through conditions, paired with the
 * subpath they answer. A plain string target (`"./package.json"`) carries no
 * conditions and so has nothing to order.
 * @returns {Array<[string, Record<string, string>]>} Subpath/conditions pairs.
 */
function conditionalExports() {
	return Object.entries(manifest.exports).filter(
		([, target]) => typeof target === "object" && target !== null,
	);
}

/**
 * The resolution modes the package supports. node10 is deliberately absent:
 * this epic's compatibility floor is `moduleResolution` node16/nodenext and
 * bundler.
 */
const RESOLUTION_MODES = [
	{
		name: "node16 (from CJS)",
		extension: ".ts",
		options: {
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
		},

		/*
		 * `import ... = require(...)` is how a CJS TypeScript file consumes a
		 * CJS module without interop, so the probe tests the declaration rather
		 * than a synthesized default.
		 */
		importForm: 'import js = require("@eslint/js");',
	},
	{
		name: "node16 (from ESM)",

		// `.mts` is ESM regardless of the nearest `package.json` `type` field.
		extension: ".mts",
		options: {
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
		},
		importForm: 'import js from "@eslint/js";',
	},
	{
		name: "bundler",
		extension: ".ts",
		options: {
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			esModuleInterop: true,
		},
		importForm: 'import js from "@eslint/js";',
	},
];

/**
 * Compiles a probe against the installed `node_modules`.
 *
 * `types: []` is load-bearing rather than tidiness: it keeps the ambient
 * `@types/*` sweep out of the program, so the probe proves the package's own
 * declarations carry the types instead of picking something up for free.
 * @param {object} mode One entry of `RESOLUTION_MODES`.
 * @param {string} source The probe body, appended after the import.
 * @returns {{diagnostics: ts.Diagnostic[], program: ts.Program, fileName: string}}
 * The probe's diagnostics, its program, and the path it was compiled at.
 */
function compile(mode, source) {
	const options = {
		strict: true,
		skipLibCheck: true,
		noEmit: true,
		types: [],
		target: ts.ScriptTarget.ES2022,
		...mode.options,
	};
	const text = `${mode.importForm}\n${source}\n`;

	/*
	 * The host key MUST be forward-slash normalized — `probePath`, never bare
	 * `path.join`. TypeScript normalizes root names and asks the host below for
	 * forward-slash paths on every platform, so a Windows-native key never
	 * matches and the probe is silently dropped from the program.
	 */
	const fileName = probePath(
		PROBE_DIR,
		`js-package-probe${mode.extension.replace(".", "-")}${mode.extension}`,
	);
	const host = ts.createCompilerHost(options, true);
	const { getSourceFile, fileExists, readFile } = host;

	host.getSourceFile = (name, languageVersion, ...rest) =>
		name === fileName
			? ts.createSourceFile(name, text, languageVersion, true)
			: getSourceFile.call(host, name, languageVersion, ...rest);
	host.fileExists = name => name === fileName || fileExists.call(host, name);
	host.readFile = name =>
		name === fileName ? text : readFile.call(host, name);

	const program = ts.createProgram([fileName], options, host);

	assertProbesLoaded(program, [fileName]);

	return {
		program,
		fileName,

		/*
		 * Syntactic and semantic diagnostics only: global diagnostics carry
		 * ambient `lib` noise that says nothing about the probe.
		 */
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
 * Asserts a probe compiles clean.
 * @param {object} mode One entry of `RESOLUTION_MODES`.
 * @param {string} source The probe body.
 * @returns {ts.Program} The compiled program.
 */
function expectClean(mode, source) {
	const { diagnostics, program } = compile(mode, source);

	assert.isEmpty(
		diagnostics,
		`probe was expected to compile but did not:\n${format(diagnostics)}`,
	);

	return program;
}

/**
 * Asserts a probe is rejected, with a specific diagnostic code.
 *
 * The code matters. Asserting merely "some diagnostic" would pass for a probe
 * that failed to resolve the package at all, which is the opposite of what
 * these cases are checking.
 * @param {object} mode One entry of `RESOLUTION_MODES`.
 * @param {string} source The probe body.
 * @param {number} code The expected TypeScript error code.
 * @returns {void}
 */
function expectError(mode, source, code) {
	const { diagnostics } = compile(mode, source);

	assert.isNotEmpty(
		diagnostics,
		"probe was expected to be rejected but compiled clean, so the declaration is not constraining anything",
	);
	assert.includeMembers(
		diagnostics.map(diagnostic => diagnostic.code),
		[code],
		`expected TS${code} but got:\n${format(diagnostics)}`,
	);
}

/**
 * Runs a Node entry point and returns its result.
 * @param {string} entry Absolute path to the script.
 * @param {string[]} args Arguments for it.
 * @returns {{code: number, output: string}} The exit code and combined output.
 */
function run(entry, args) {
	try {
		return {
			code: 0,
			output: execFileSync(process.execPath, [entry, ...args], {
				cwd: REPO_ROOT,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}),
		};
	} catch (error) {
		/*
		 * A null status means the process never launched, and both streams are
		 * empty in that case; carry the spawn error through so the failure is
		 * readable rather than blank.
		 */
		return {
			code: error.status ?? -1,
			output:
				error.status === null
					? error.message
					: `${error.stdout || ""}${error.stderr || ""}`,
		};
	}
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("@eslint/js package types", () => {
	// Each case builds a real program, and the emit is a `tsc` subprocess.
	const TIMEOUT = 120000;

	before(function () {
		this.timeout(TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API

		/*
		 * Emit into the package's real `dist/`, not a temp directory. The paths
		 * under test are the ones `package.json` names, so the emit has to land
		 * where those point or the wiring is not what was checked.
		 */
		const { code, output } = run(TSC_PATH, ["-p", EMIT_CONFIG_PATH]);

		assert.strictEqual(
			code,
			0,
			`declaration emit for packages/js failed:\n${output}`,
		);
	});

	beforeEach(function () {
		this.timeout(TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API
	});

	describe("package.json wiring", () => {
		it("keeps a top-level types field for resolvers that predate exports", () => {
			assert.isString(manifest.types);
			assert.isTrue(
				fs.existsSync(path.join(PACKAGE_DIR, manifest.types)),
				`the types field points at ${manifest.types}, which the emit did not produce`,
			);
		});

		/*
		 * The `@humanwhocodes/module-importer` trap: with an `exports` map
		 * present, the top-level `types` field above is IGNORED. Declarations
		 * have to be reachable through the map or they are not reachable.
		 */
		it("declares a types condition in every conditional exports entry", () => {
			for (const [subpath, conditions] of conditionalExports()) {
				assert.property(
					conditions,
					"types",
					`the "${subpath}" exports entry has no types condition, so TypeScript resolves past the declarations to the JavaScript and reports TS7016`,
				);
				assert.isTrue(
					fs.existsSync(path.join(PACKAGE_DIR, conditions.types)),
					`the "${subpath}" types condition points at ${conditions.types}, which the emit did not produce`,
				);
			}
		});

		/*
		 * Conditions are matched in declaration order. A `types` key after
		 * `default` is unreachable — and silently so, because the map is still
		 * a valid exports map and the package still resolves at runtime.
		 */
		it("places types FIRST in every conditional exports entry", () => {
			for (const [subpath, conditions] of conditionalExports()) {
				assert.strictEqual(
					Object.keys(conditions)[0],
					"types",
					`the "${subpath}" exports entry lists ${Object.keys(conditions)[0]} before types; conditions match in declaration order, so a later types condition never wins`,
				);
			}
		});

		it("ships the declarations in the published files list", () => {
			const declarationRoot = manifest.types.replace(/^\.\//u, "");

			assert.isTrue(
				manifest.files.some(entry =>
					declarationRoot.startsWith(
						entry.replace(/^\.\//u, "").replace(/\/$/u, ""),
					),
				),
				`nothing in "files" (${manifest.files.join(", ")}) covers ${manifest.types}, so the declarations are emitted but never packed`,
			);
		});
	});

	describe("resolution", () => {
		for (const mode of RESOLUTION_MODES) {
			describe(mode.name, () => {
				it("resolves the declarations rather than falling through to the JavaScript", () => {
					const program = expectClean(
						mode,
						"export const packageName: string = js.meta.name;",
					);
					const resolved = program
						.getSourceFiles()
						.map(file => file.fileName)
						.filter(fileName => fileName.endsWith("index.d.ts"));

					assert.isNotEmpty(
						resolved,
						"the package's declaration file is not in the program, so the probe was typed by something else",
					);
				});

				it("carries the exact rule literals through to the consumer", () => {
					expectClean(
						mode,
						'export const severity: "error" = js.configs.recommended.rules["no-undef"];',
					);
				});

				/*
				 * The negative half. Without it every assertion above would
				 * also pass against `any`, which is precisely the state an
				 * unresolved declaration leaves a consumer in.
				 */
				it("rejects a rule name the config does not enable", () => {
					expectError(
						mode,
						'export const severity = js.configs.recommended.rules["no-such-rule"];',
						7053,
					);
				});

				it("rejects a severity the config does not set", () => {
					expectError(
						mode,
						'export const severity: "warn" = js.configs.recommended.rules["no-undef"];',
						2322,
					);
				});

				/*
				 * `eslint` is an optional peer dependency. Asserting that the
				 * program pulls in nothing beyond the package itself is the
				 * demonstration that it is genuinely optional — a declaration
				 * that referenced the main package's vocabulary would drag its
				 * files in here.
				 */
				it("needs nothing outside the package to type-check", () => {
					const { program, fileName } = compile(
						mode,
						"export const packageName: string = js.meta.name;",
					);
					const external = program
						.getSourceFiles()
						.filter(
							file =>
								!program.isSourceFileDefaultLibrary(file) &&
								file.fileName !== fileName &&
								!file.fileName.includes("@eslint/js/") &&
								!file.fileName.includes("packages/js/"),
						)
						.map(file => file.fileName);

					assert.deepStrictEqual(
						external,
						[],
						"the probe pulled in declarations from outside @eslint/js, so the package no longer type-checks standalone with the optional eslint peer dependency absent",
					);
				});
			});
		}

		/*
		 * The ESM view is where the named exports matter, and it is the one
		 * claim the compiler cannot settle on its own: TypeScript offers named
		 * imports from a CJS declaration whether or not Node can find them at
		 * runtime, so this pairs the compiler's answer with Node's. Node
		 * detects a CommonJS module's named exports with `cjs-module-lexer`, a
		 * static scan that sees shorthand over a binding but not an inline
		 * object literal — so a refactor of `module.exports` that looks purely
		 * cosmetic turns `import { configs } from "@eslint/js"` into a runtime
		 * `SyntaxError` while every type still checks out.
		 */
		it("offers named ESM imports that Node can actually find", async () => {
			const esm = RESOLUTION_MODES.find(
				mode => mode.name === "node16 (from ESM)",
			);
			const { diagnostics } = compile(
				{
					...esm,
					importForm: 'import { meta, configs } from "@eslint/js";',
				},
				'export const severity: "error" = configs.all.rules["no-undef"];\nexport const packageName: string = meta.name;',
			);

			assert.isEmpty(diagnostics, format(diagnostics));

			const namespace = await import(
				pathToFileURL(path.join(PACKAGE_DIR, "src/index.js")).href
			);

			assert.includeMembers(
				Object.keys(namespace),
				["meta", "configs"],
				"Node's static analysis of the CommonJS entry point does not expose the named exports the declarations promise, so an ESM consumer importing them crashes at runtime",
			);
		});
	});

	describe("emitted declarations", () => {
		const emitted = [
			"dist/src/index.d.ts",
			"dist/src/configs/eslint-all.d.ts",
			"dist/src/configs/eslint-recommended.d.ts",
		];

		it("exist for every source in the package", () => {
			for (const file of emitted) {
				assert.isTrue(
					fs.existsSync(path.join(PACKAGE_DIR, file)),
					`no declaration was emitted at ${file}`,
				);
			}
		});

		/*
		 * A cheap, direct reading of the same constraint the resolution probes
		 * check from the consumer side: no import, no triple-slash reference,
		 * nothing that could send a resolver outside the tarball.
		 */
		it("reference nothing outside the package", () => {
			for (const file of emitted) {
				const declaration = fs.readFileSync(
					path.join(PACKAGE_DIR, file),
					"utf8",
				);

				assert.notMatch(
					declaration,
					/^\s*(?:import|export)\s.*\bfrom\s/mu,
					`${file} imports from another module, so the published types are not self-contained`,
				);
				assert.notInclude(
					declaration,
					"/// <reference",
					`${file} carries a triple-slash reference, so the published types are not self-contained`,
				);
			}
		});

		it("does not leak the ../package.json specifier", () => {
			const declaration = fs.readFileSync(
				path.join(PACKAGE_DIR, "dist/src/index.d.ts"),
				"utf8",
			);

			assert.notInclude(declaration, "package.json");
			assert.include(declaration, "let name: string;");
			assert.include(declaration, "let version: string;");
		});
	});

	describe("are the types wrong?", () => {
		let report;

		before(function () {
			this.timeout(TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API

			/*
			 * The same invocation as the `test:types:packaged` script, in JSON
			 * form. `--pack` builds the real tarball, so this checks what would
			 * be published rather than what is lying around in the worktree.
			 */
			const { output } = run(ATTW_PATH, [
				"--pack",
				"packages/js",
				"--profile",
				"node16",
				"-f",
				"json",
			]);

			report = JSON.parse(output);
		});

		it("is wired to the same invocation the package script runs", () => {
			const rootManifest = JSON.parse(
				fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
			);

			assert.property(rootManifest.scripts, "test:types:packaged");
			assert.include(
				rootManifest.scripts["test:types:packaged"],
				"attw --pack packages/js",
			);
			assert.property(
				rootManifest.devDependencies,
				"@arethetypeswrong/cli",
			);
		});

		it("reports no problems for the packed tarball", () => {
			assert.deepStrictEqual(
				report.problems,
				{},
				`@arethetypeswrong/cli reported problems:\n${JSON.stringify(report.problems, null, 2)}`,
			);
		});

		it("resolves the declarations in node16-cjs, node16-esm and bundler", () => {
			const { resolutions } = report.analysis.entrypoints["."];

			for (const mode of ["node16-cjs", "node16-esm", "bundler"]) {
				const { resolution } = resolutions[mode];

				assert.isTrue(
					resolution.isTypeScript,
					`${mode} did not resolve to a declaration file`,
				);
				assert.match(
					resolution.fileName,
					/@eslint\/js\/dist\/src\/index\.d\.ts$/u,
					`${mode} resolved to ${resolution.fileName}`,
				);
			}
		});
	});
});

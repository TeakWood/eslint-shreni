/**
 * @fileoverview Tests for the source-annotated type pipeline.
 *
 * These tests guard the pipeline itself rather than any one annotation:
 *
 * 1. The allowlist in `tsconfig.json` and the per-file check pragmas in the
 *    sources have to agree, or a file can sit in the allowlist while silently
 *    not being checked.
 * 2. Every allowlisted source has to type-check clean under `strict: true`.
 * 3. Declaration emit has to produce `.d.ts` files that are themselves valid
 *    under `strict: true`, since those are what consumers see.
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
const { execFileSync } = require("node:child_process");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, "../../..");
const TSCONFIG_PATH = path.join(ROOT_DIR, "tsconfig.json");
/*
 * The compiler is invoked through Node rather than the `node_modules/.bin/tsc`
 * shim. On Windows npm writes `tsc.cmd` and `tsc.ps1` there, and the
 * extension-less `tsc` is a POSIX shell script that `CreateProcess` cannot
 * execute: `spawnSync` fails before launch, leaving `status` null and both
 * streams empty, so the failure surfaces as an empty "tsc reported errors:"
 * message. Running the compiler's own entry point sidesteps the split.
 */
const TSC_PATH = path.join(ROOT_DIR, "node_modules/typescript/bin/tsc");

/**
 * The `tsconfig*.json` files are JSONC, so `JSON.parse` cannot read them
 * directly. Only the comment forms this repo actually uses need stripping, and
 * both configs are checked in, so a targeted strip is enough here — pulling in
 * a JSONC parser purely for a test would be more machinery than the job needs.
 * @param {string} filePath Absolute path to a JSONC file.
 * @returns {any} The parsed value.
 */
function readJsonc(filePath) {
	const text = fs
		.readFileSync(filePath, "utf8")
		.replace(/^\s*\/\/.*$/gmu, "")
		.replace(/\/\*[\s\S]*?\*\//gu, "");

	return JSON.parse(text);
}

/**
 * Runs `tsc` against a project and returns its combined output.
 * @param {string} project Path to the tsconfig to build.
 * @returns {{ code: number, output: string }} The exit code and output.
 */
function runTsc(project) {
	try {
		const output = execFileSync(
			process.execPath,
			[TSC_PATH, "-p", project],
			{
				cwd: ROOT_DIR,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		return { code: 0, output };
	} catch (error) {
		/*
		 * A null status means the process never launched rather than that the
		 * compiler reported anything, and both streams are empty in that case.
		 * Carry the spawn error through so the failure is readable instead of
		 * an empty "tsc reported errors:" message.
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

const tsconfig = readJsonc(TSCONFIG_PATH);
const allowlist = tsconfig.files;
const jsAllowlist = allowlist.filter(file => file.endsWith(".js"));

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("types", () => {
	// `tsc` is a subprocess over the whole allowlist; the default 10s is tight.
	const TSC_TIMEOUT = 120000;

	describe("allowlist", () => {
		it("is non-empty", () => {
			assert.isAbove(jsAllowlist.length, 0);
		});

		it("lists no file twice", () => {
			assert.sameMembers(allowlist, [...new Set(allowlist)]);
		});

		it("lists only files that exist", () => {
			for (const file of allowlist) {
				assert.isTrue(
					fs.existsSync(path.join(ROOT_DIR, file)),
					`${file} is in tsconfig.json but does not exist`,
				);
			}
		});

		/*
		 * `checkJs` is off so that an unconverted transitive dependency cannot
		 * fail the build for the file that pulled it in. That makes the
		 * `// @ts-check` pragma — not the allowlist — what actually turns
		 * checking on, so a listed file without the pragma would be silently
		 * unchecked.
		 */
		it("only lists sources that opt in with a @ts-check pragma", () => {
			for (const file of jsAllowlist) {
				const source = fs.readFileSync(
					path.join(ROOT_DIR, file),
					"utf8",
				);

				assert.isTrue(
					source.startsWith("// @ts-check\n"),
					`${file} is in the tsconfig.json allowlist but does not start with a "// @ts-check" pragma, so it is not actually type-checked`,
				);
			}
		});

		it("does not leave a @ts-check source out of the allowlist", () => {
			const listed = new Set(jsAllowlist);
			const orphans = [];

			for (const dir of ["lib", "conf", "bin", "packages/js/src"]) {
				const entries = fs.readdirSync(path.join(ROOT_DIR, dir), {
					recursive: true,
					withFileTypes: true,
				});

				for (const entry of entries) {
					if (!entry.isFile() || !entry.name.endsWith(".js")) {
						continue;
					}

					const absolute = path.join(entry.parentPath, entry.name);
					const relative = path
						.relative(ROOT_DIR, absolute)
						.replaceAll(path.sep, "/");

					if (listed.has(relative)) {
						continue;
					}

					if (
						fs
							.readFileSync(absolute, "utf8")
							.startsWith("// @ts-check\n")
					) {
						orphans.push(relative);
					}
				}
			}

			assert.deepStrictEqual(
				orphans,
				[],
				"these sources carry a @ts-check pragma but are missing from the tsconfig.json allowlist, so nothing checks them",
			);
		});
	});

	describe("type checking", () => {
		it("passes for every allowlisted source under strict mode", function () {
			this.timeout(TSC_TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API

			const { code, output } = runTsc(TSCONFIG_PATH);

			assert.strictEqual(code, 0, `tsc reported errors:\n${output}`);
		});

		/*
		 * The `node_modules/.bin` entry is a POSIX shell script that Windows
		 * cannot launch directly, and `spawnSync` failing before launch is
		 * indistinguishable from a clean run with an empty output — it reports
		 * a null status and two empty streams. Pin the entry point instead.
		 */
		it("invokes the compiler through Node rather than the .bin shim", () => {
			assert.isTrue(
				fs.existsSync(TSC_PATH),
				`${TSC_PATH} does not exist, so tsc cannot be launched`,
			);
			assert.notInclude(
				TSC_PATH.replaceAll(path.sep, "/"),
				"node_modules/.bin/",
			);
		});

		it("has strict mode enabled", () => {
			const base = readJsonc(path.join(ROOT_DIR, "tsconfig.base.json"));

			assert.strictEqual(base.compilerOptions.strict, true);
		});
	});

	describe("declaration emit", () => {
		let outDir;

		before(function () {
			this.timeout(TSC_TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API

			/*
			 * Emit inside the repo rather than the OS temp dir: `extends`
			 * resolves the allowlist relative to the repo root, and an
			 * `outDir` that climbs out of the root produces unusable paths.
			 * `tmp/` is gitignored.
			 */
			const tmpRoot = path.join(ROOT_DIR, "tmp");

			fs.mkdirSync(tmpRoot, { recursive: true });
			outDir = fs.mkdtempSync(path.join(tmpRoot, "types-"));

			const emitConfigPath = path.join(outDir, "tsconfig.emit.json");

			fs.writeFileSync(
				emitConfigPath,
				JSON.stringify({
					extends: path.relative(outDir, TSCONFIG_PATH),
					compilerOptions: {
						noEmit: false,
						declaration: true,
						emitDeclarationOnly: true,
						rootDir: path.relative(outDir, ROOT_DIR),
						outDir: ".",
					},
				}),
			);

			const { code, output } = runTsc(emitConfigPath);

			assert.strictEqual(code, 0, `declaration emit failed:\n${output}`);

			// The emitted declarations import the vocabulary by relative path.
			fs.mkdirSync(path.join(outDir, "lib/types"), { recursive: true });
			for (const name of ["core.d.ts", "vendor.d.ts"]) {
				fs.copyFileSync(
					path.join(ROOT_DIR, "lib/types", name),
					path.join(outDir, "lib/types", name),
				);
			}
		});

		after(() => {
			if (outDir) {
				fs.rmSync(outDir, { recursive: true, force: true });
			}
		});

		it("emits a declaration for every allowlisted source", () => {
			for (const file of jsAllowlist) {
				const declaration = path.join(
					outDir,
					file.replace(/\.js$/u, ".d.ts"),
				);

				assert.isTrue(
					fs.existsSync(declaration),
					`no declaration was emitted for ${file}`,
				);
			}
		});

		it("carries JSDoc parameter and return types into the declarations", () => {
			const declaration = fs.readFileSync(
				path.join(outDir, "lib/shared/severity.d.ts"),
				"utf8",
			);

			assert.include(
				declaration,
				"export function normalizeSeverityToString(severity: Severity): SeverityName;",
			);
			assert.include(
				declaration,
				"export function normalizeSeverityToNumber(severity: Severity): SeverityLevel;",
			);
			assert.include(declaration, 'from "../types/core.js"');
		});

		it("resolves shared vocabulary types rather than widening them to any", () => {
			const declaration = fs.readFileSync(
				path.join(outDir, "lib/shared/message-counts.d.ts"),
				"utf8",
			);

			assert.include(
				declaration,
				"export function calculateStatsPerFile(messages: LintMessage[]): MessageCounts;",
			);
		});

		it("does not leak unresolvable specifiers into the declarations", () => {
			const declaration = fs.readFileSync(
				path.join(outDir, "packages/js/src/index.d.ts"),
				"utf8",
			);

			assert.notInclude(declaration, "package.json");
			assert.include(declaration, "let name: string;");
			assert.include(declaration, "let version: string;");
		});

		it("produces declarations that themselves type-check under strict mode", function () {
			this.timeout(TSC_TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API

			const checkConfigPath = path.join(outDir, "tsconfig.check.json");

			fs.writeFileSync(
				checkConfigPath,
				JSON.stringify({
					compilerOptions: {
						strict: true,
						noEmit: true,
						module: "NodeNext",
						moduleResolution: "NodeNext",
						target: "ES2022",
						lib: ["ES2022"],
						types: [],
						skipLibCheck: false,
					},
					include: ["**/*.d.ts"],
				}),
			);

			const { code, output } = runTsc(checkConfigPath);

			assert.strictEqual(
				code,
				0,
				`emitted declarations do not type-check:\n${output}`,
			);
		});
	});
});

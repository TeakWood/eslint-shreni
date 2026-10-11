/**
 * @fileoverview Tests for the tsc pipeline: the root `tsconfig.json` and the
 * `lint:types` / `build:types` scripts that drive it.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert,
	fs = require("node:fs"),
	path = require("node:path"),
	ts = require("typescript");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TSCONFIG_PATH = path.join(PROJECT_ROOT, "tsconfig.json");

/**
 * Rewrites a path to forward slashes.
 *
 * TypeScript always reports paths with forward slashes, while `path.join()`
 * uses a backslash on Windows. Normalizing both sides keeps the assertions
 * below from passing on POSIX and failing on Windows.
 * @param filePath The path to normalize.
 * @returns The path with every separator as a forward slash.
 */
function toPosix(filePath) {
	return filePath.split(path.sep).join("/");
}

/**
 * Reads and resolves the root `tsconfig.json` the way `tsc` does.
 * @returns The parsed command line, including resolved options and file names.
 */
function parseProjectConfig() {
	const { config, error } = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);

	assert.isUndefined(
		error,
		`tsconfig.json is not readable: ${error && ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
	);

	return {
		raw: config,
		parsed: ts.parseJsonConfigFileContent(
			config,
			ts.sys,
			PROJECT_ROOT,
			void 0,
			TSCONFIG_PATH,
		),
	};
}

/**
 * Formats diagnostics as a single readable string for assertion messages.
 * @param diagnostics The diagnostics to format.
 * @returns One message per line.
 */
function formatDiagnostics(diagnostics) {
	return diagnostics
		.map(
			diagnostic =>
				`TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
		)
		.join("\n");
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("tsc pipeline", () => {
	describe("tsconfig.json", () => {
		it("should exist at the project root", () => {
			assert.isTrue(
				fs.existsSync(TSCONFIG_PATH),
				"tsconfig.json should exist at the project root",
			);
		});

		it("should resolve without configuration errors", () => {
			const { parsed } = parseProjectConfig();

			assert.strictEqual(
				parsed.errors.length,
				0,
				`tsconfig.json should resolve cleanly:\n${formatDiagnostics(parsed.errors)}`,
			);
		});

		it("should type-check JS sources from their JSDoc under strict mode", () => {
			const { parsed } = parseProjectConfig();

			assert.isTrue(parsed.options.allowJs, "allowJs should be enabled");
			assert.isTrue(parsed.options.checkJs, "checkJs should be enabled");
			assert.isTrue(parsed.options.strict, "strict should be enabled");
		});

		it("should emit declarations only, into dist/types", () => {
			const { parsed } = parseProjectConfig();

			assert.isTrue(
				parsed.options.declaration,
				"declaration should be enabled",
			);
			assert.isTrue(
				parsed.options.emitDeclarationOnly,
				"emitDeclarationOnly should be enabled, so no JS is emitted",
			);
			assert.strictEqual(
				toPosix(parsed.options.outDir),
				toPosix(path.join(PROJECT_ROOT, "dist/types")),
			);
		});

		it("should pin rootDir to the project root so the emitted layout mirrors the repo", () => {
			const { parsed } = parseProjectConfig();

			assert.strictEqual(
				toPosix(parsed.options.rootDir),
				toPosix(PROJECT_ROOT),
			);
		});

		it("should resolve modules as Node16 CommonJS", () => {
			const { parsed } = parseProjectConfig();

			assert.strictEqual(parsed.options.module, ts.ModuleKind.Node16);
			assert.strictEqual(
				parsed.options.moduleResolution,
				ts.ModuleResolutionKind.Node16,
			);
			assert.strictEqual(parsed.options.target, ts.ScriptTarget.ES2022);
		});

		it("should list only existing files in `include`", () => {
			const { raw } = parseProjectConfig();

			assert.isArray(raw.include, "`include` should be an array");

			for (const entry of raw.include) {
				assert.isTrue(
					fs.existsSync(path.join(PROJECT_ROOT, entry)),
					`\`include\` entry "${entry}" should exist`,
				);
			}
		});

		it("should resolve to at least one JavaScript input file", () => {
			const { parsed } = parseProjectConfig();

			// An input-less project fails with TS18003, so `include` is never empty.
			assert.isNotEmpty(
				parsed.fileNames,
				"the project should have at least one input file",
			);

			for (const fileName of parsed.fileNames) {
				assert.match(
					fileName,
					/\.js$/u,
					"only JavaScript sources should be type-checked",
				);
				assert.isTrue(
					fs.existsSync(fileName),
					`input file "${fileName}" should exist`,
				);
			}
		});

		it("should map an input file to a declaration file under dist/types", () => {
			const { parsed } = parseProjectConfig();
			const [input] = parsed.fileNames;
			const outputs = ts.getOutputFileNames(parsed, input, false);
			const expected = toPosix(
				path.join(
					PROJECT_ROOT,
					"dist/types",
					`${path.relative(PROJECT_ROOT, input).slice(0, -".js".length)}.d.ts`,
				),
			);

			assert.deepStrictEqual(outputs.map(toPosix), [expected]);
		});
	});

	describe("`pnpm lint:types`", () => {
		it("should report no type errors for the configured sources", () => {
			const { parsed } = parseProjectConfig();
			const program = ts.createProgram(parsed.fileNames, {
				...parsed.options,
				noEmit: true,
			});
			const diagnostics = ts.getPreEmitDiagnostics(program);

			assert.strictEqual(
				diagnostics.length,
				0,
				`\`pnpm lint:types\` should pass:\n${formatDiagnostics(diagnostics)}`,
			);
		});
	});

	describe("package.json", () => {
		const { scripts } = require("../../package.json");

		it("should type-check without emitting via `lint:types`", () => {
			assert.strictEqual(scripts["lint:types"], "tsc --noEmit");
		});

		it("should emit declarations via `build:types`", () => {
			assert.strictEqual(scripts["build:types"], "tsc");
		});
	});

	describe(".gitignore", () => {
		it("should ignore the declaration output directory", () => {
			const gitignore = fs.readFileSync(
				path.join(PROJECT_ROOT, ".gitignore"),
				"utf8",
			);

			assert.include(
				gitignore.split(/\r?\n/u),
				"/dist",
				"emitted declarations should never be committed",
			);
		});
	});
});

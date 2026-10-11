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

const {
	CHECK_PRAGMA,
	PROJECT_ROOT,
	TSCONFIG_PATH,
	formatDiagnostics,
	parseProjectConfig,
	toPosix,
} = require("../_utils/type-probe");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Lists the directories `include` covers with a recursive glob.
 * @param {any} raw The raw `tsconfig.json` object.
 * @returns {string[]} The directory paths, relative to the project root.
 */
function annotatedDirectories(raw) {
	return raw.include
		.filter(entry => entry.endsWith("/**/*.js"))
		.map(entry => entry.slice(0, -"/**/*.js".length));
}

/**
 * Lists every JavaScript source in a directory, recursively.
 * @param {string} directory The directory path, relative to the project root.
 * @returns {string[]} The sources' paths, relative to the project root.
 */
function sourcesIn(directory) {
	return fs
		.readdirSync(path.join(PROJECT_ROOT, directory), { recursive: true })
		.map(entry => toPosix(String(entry)))
		.filter(entry => entry.endsWith(".js"))
		.map(entry => `${directory}/${entry}`);
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
			const { parsed, readError } = parseProjectConfig();

			assert.isUndefined(
				readError,
				`tsconfig.json is not readable: ${readError && ts.flattenDiagnosticMessageText(readError.messageText, " ")}`,
			);

			assert.strictEqual(
				parsed.errors.length,
				0,
				`tsconfig.json should resolve cleanly:\n${formatDiagnostics(parsed.errors)}`,
			);
		});

		it("should type-check JS sources from their JSDoc under strict mode", () => {
			const { parsed } = parseProjectConfig();

			assert.isTrue(parsed.options.allowJs, "allowJs should be enabled");
			assert.isTrue(parsed.options.strict, "strict should be enabled");
		});

		it("should leave `checkJs` off, so that checking is opted into per file", () => {
			const { parsed } = parseProjectConfig();

			/*
			 * `include` only picks the program's roots; everything they
			 * `require()` is pulled in and would be checked as well. Enabling
			 * `checkJs` globally would therefore report errors throughout the
			 * not-yet-annotated tree, which is why each annotated source
			 * carries a pragma instead.
			 */
			assert.notOk(
				parsed.options.checkJs,
				"checkJs should stay off, or the whole transitively-reached tree gets checked",
			);
		});

		it("should skip checking third-party declarations", () => {
			const { parsed } = parseProjectConfig();

			/*
			 * Two reachable packages ship declarations that cannot compile
			 * here: espree's `.d.cts` re-exports its ESM entry (TS1479 under
			 * node16 CJS), and `@eslint-community/eslint-utils` imports from
			 * `"eslint"`, which resolves to this fork's own untyped entry
			 * (TS7016).
			 */
			assert.isTrue(
				parsed.options.skipLibCheck,
				"skipLibCheck should be enabled",
			);
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

		it("should have every `include` entry match at least one file", () => {
			const { raw } = parseProjectConfig();

			assert.isArray(raw.include, "`include` should be an array");

			/*
			 * The entries are globs, so they cannot be checked with
			 * `existsSync`. Resolving each one on its own catches a stale
			 * entry that the combined file list would hide.
			 */
			for (const entry of raw.include) {
				const matched = ts.parseJsonConfigFileContent(
					{ ...raw, include: [entry] },
					ts.sys,
					PROJECT_ROOT,
					void 0,
					TSCONFIG_PATH,
				).fileNames;

				assert.isNotEmpty(
					matched,
					`\`include\` entry "${entry}" should match at least one file`,
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
			assert.isNotEmpty(
				parsed.fileNames.filter(fileName => fileName.endsWith(".js")),
				"the project should type-check JavaScript sources",
			);

			for (const fileName of parsed.fileNames) {
				assert.match(
					fileName,
					/(?:\.js|\.d\.ts)$/u,
					"inputs should be JavaScript sources or ambient declarations",
				);
				assert.isTrue(
					fs.existsSync(fileName),
					`input file "${fileName}" should exist`,
				);
			}
		});

		it("should resolve `require()`d JSON, which several lib modules depend on", () => {
			const { parsed } = parseProjectConfig();

			assert.isTrue(
				parsed.options.resolveJsonModule,
				"resolveJsonModule should be enabled, or requiring JSON fails with TS2732",
			);
		});

		it("should map a declaration input to no output", () => {
			const { parsed } = parseProjectConfig();
			const ambient = parsed.fileNames.find(fileName =>
				fileName.endsWith(".d.ts"),
			);

			assert.isDefined(
				ambient,
				"`include` should carry the hand-written ambient declarations",
			);

			/*
			 * Declaration inputs emit nothing, which is why adding `types/**`
			 * to `include` cannot disturb the `dist/types/` layout that
			 * `rootDir` pins.
			 */
			assert.deepStrictEqual(
				ts.getOutputFileNames(parsed, ambient, false),
				[],
			);
		});

		it("should type-check every source in each annotated directory", () => {
			const { raw, parsed } = parseProjectConfig();
			const inputs = new Set(parsed.fileNames.map(toPosix));

			/*
			 * A directory enters `include` as a whole, so every `.js` file in
			 * it must be annotated. Reading the directories back off `include`
			 * keeps this honest as the glob grows bead by bead, instead of
			 * hard-coding the set that happens to be annotated today.
			 */
			const directories = annotatedDirectories(raw);

			assert.isNotEmpty(
				directories,
				"`include` should cover at least one directory of sources",
			);

			for (const directory of directories) {
				const sources = sourcesIn(directory);

				assert.isNotEmpty(
					sources,
					`"${directory}" should contain JavaScript sources`,
				);

				for (const source of sources) {
					assert.isTrue(
						inputs.has(toPosix(path.join(PROJECT_ROOT, source))),
						`"${source}" should be type-checked`,
					);
				}
			}
		});

		it("should opt every source in each annotated directory into checking", () => {
			const { raw } = parseProjectConfig();

			/*
			 * `include` alone no longer decides what is checked: with
			 * `checkJs` off, a file is only checked if it carries the pragma.
			 * This ties the two halves together, so that widening `include`
			 * without opting the new files in fails here rather than silently
			 * type-checking nothing.
			 */
			for (const directory of annotatedDirectories(raw)) {
				for (const source of sourcesIn(directory)) {
					const firstLine = fs
						.readFileSync(path.join(PROJECT_ROOT, source), "utf8")
						.split(/\r?\n/u)[0];

					assert.strictEqual(
						firstLine,
						CHECK_PRAGMA,
						`"${source}" should start with "${CHECK_PRAGMA}", or it is included but never checked`,
					);
				}
			}
		});

		it("should map an input file to a declaration file under dist/types", () => {
			const { parsed } = parseProjectConfig();
			const input = parsed.fileNames.find(fileName =>
				fileName.endsWith(".js"),
			);
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

		it("should report no declaration-emit errors", () => {
			const { parsed } = parseProjectConfig();
			const program = ts.createProgram(parsed.fileNames, {
				...parsed.options,
				noEmit: true,
			});

			/*
			 * `getPreEmitDiagnostics()` above does not include these, so a
			 * type whose name the emitted declaration cannot express (TS2883,
			 * which `@types/estree` triggers through the token store) passes
			 * that check and still fails the real `tsc --noEmit`.
			 */
			const diagnostics = program.getDeclarationDiagnostics();

			assert.strictEqual(
				diagnostics.length,
				0,
				`declaration emit should be clean:\n${formatDiagnostics(diagnostics)}`,
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

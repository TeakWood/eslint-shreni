/**
 * @fileoverview Guards the hand-authored ambient declarations in
 * `lib/types/vendor.d.ts`.
 *
 * Those declarations are the one place in this project where a type is asserted
 * rather than derived from an implementation, so they are the one place that can
 * be wrong without anything noticing. Nothing in the `tsconfig.json` allowlist
 * requires `esutils`, `@humanwhocodes/module-importer` or `file-entry-cache`
 * yet — the files that do are converted by later beads — which means
 * `npm run lint:types` compiles these blocks but never exercises them. A
 * declaration that no call site touches is green by default.
 *
 * These tests close that gap by compiling probes that mirror the real call
 * sites, and they are deliberately two-sided: every positive probe is paired
 * with a negative one, because a declaration that widened to `any` would pass
 * the positive probe just as happily as a correct one.
 *
 * They also guard the reasons the declarations exist. Each block is a
 * liability that should be deleted the moment upstream ships types, so the
 * suite re-derives from the installed tree that each package still ships none.
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

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const VENDOR_DTS = path.join(REPO_ROOT, "lib/types/vendor.d.ts");

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so that bare specifiers resolve against `node_modules/` exactly as
 * they do for a real source file.
 */
const PROBE_DIR = path.join(REPO_ROOT, "lib");

/**
 * Mirrors the resolution-relevant options of the shipped gate
 * (`tsconfig.base.json`). `NodeNext` matters here: it is what makes
 * `@humanwhocodes/module-importer` resolve through its `exports` map and miss
 * its own declarations, which is the reason that block exists at all.
 */
const COMPILER_OPTIONS = {
	strict: true,
	skipLibCheck: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

const DECLARATION_EXTENSIONS = new Set([
	ts.Extension.Dts,
	ts.Extension.Dcts,
	ts.Extension.Dmts,
]);

/**
 * The three modules this file declares, in the order they appear in
 * `vendor.d.ts` alongside the pre-existing `imurmurhash` block.
 */
const DECLARED_MODULES = [
	"@humanwhocodes/module-importer",
	"esutils",
	"file-entry-cache",
];

/**
 * Compiles synthetic TypeScript sources against the installed `node_modules`,
 * with the real `vendor.d.ts` in the program.
 *
 * Sources are served from memory so the test leaves nothing behind, but the
 * containing directory is real, so `import ... from "esutils"` resolves exactly
 * as it would for a file in `lib/`.
 * @param {Record<string, string>} files Probe file name to contents.
 * @returns {{program: ts.Program, diagnostics: ts.Diagnostic[], fileName: (name: string) => string}} The compiled program and its diagnostics.
 */
function compile(files) {
	/**
	 * Resolves a probe file name to its path inside the repo.
	 * @param {string} name The probe file name.
	 * @returns {string} The absolute path.
	 */
	function absolute(name) {
		return path.join(PROBE_DIR, name);
	}

	const contents = new Map(
		Object.entries(files).map(([name, text]) => [absolute(name), text]),
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

	const program = ts.createProgram(
		[VENDOR_DTS, ...contents.keys()],
		COMPILER_OPTIONS,
		host,
	);

	/*
	 * Only syntactic and semantic diagnostics are collected. Global diagnostics
	 * would include unrelated `lib` noise from the ambient environment, which
	 * says nothing about the probe.
	 */
	const diagnostics = [
		...program.getSyntacticDiagnostics(),
		...program.getSemanticDiagnostics(),
	];

	return { program, diagnostics, fileName: absolute };
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
 * @returns {ts.Program} The compiled program, for further inspection.
 */
function expectClean(name, source) {
	const { program, diagnostics } = compile({ [name]: source });

	assert.strictEqual(
		diagnostics.length,
		0,
		`probe was expected to compile clean but did not:\n${format(diagnostics)}`,
	);

	return program;
}

/**
 * Compiles a probe and asserts the compiler rejected it with a given error.
 *
 * This is the vacuity half of every pair: a declaration that had widened to
 * `any` would accept the probe, so the failure is the assertion.
 * @param {string} name The probe file name.
 * @param {string} source The probe source.
 * @param {number} code The expected TypeScript error code.
 * @returns {void}
 */
function expectError(name, source, code) {
	const { diagnostics } = compile({ [name]: source });

	assert.isNotEmpty(
		diagnostics,
		"probe was expected to be rejected but compiled clean, so the declaration is not constraining anything",
	);
	assert.includeMembers(
		diagnostics.map(diagnostic => diagnostic.code),
		[code],
		`probe was rejected, but not for the expected reason:\n${format(diagnostics)}`,
	);
}

/**
 * Reads the compiler's own rendering of an exported binding's type.
 * @param {ts.Program} program A compiled probe program.
 * @param {string} fileName Absolute path of the probe file.
 * @param {string} binding The exported `const` to look up.
 * @returns {string} The type as `typeToString` renders it.
 */
function typeTextOf(program, fileName, binding) {
	const checker = program.getTypeChecker();
	const source = program.getSourceFile(fileName);
	const moduleSymbol = checker.getSymbolAtLocation(source);
	const symbol = checker
		.getExportsOfModule(moduleSymbol)
		.find(exported => exported.getName() === binding);

	assert.isDefined(symbol, `probe does not export "${binding}"`);

	return checker.typeToString(
		checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration),
	);
}

/**
 * Determines whether a package supplies declarations out of its own tarball.
 *
 * Deliberately the same test `tests/lib/types/dependency-type-availability.js`
 * applies: a resolution landing in `node_modules/@types` does not count,
 * because a DefinitelyTyped package says nothing about the dependency.
 * @param {string} specifier The package name to check.
 * @returns {boolean} `true` if the package ships its own declarations.
 */
function shipsOwnDeclarations(specifier) {
	const { resolvedModule } = ts.resolveModuleName(
		specifier,
		path.join(PROBE_DIR, "resolution-probe.js"),
		{
			allowJs: true,
			moduleResolution: ts.ModuleResolutionKind.Node16,
			module: ts.ModuleKind.Node16,
			target: ts.ScriptTarget.ES2022,
		},
		ts.sys,
		void 0,
		void 0,
		ts.ModuleKind.CommonJS,
	);

	if (
		!resolvedModule ||
		!DECLARATION_EXTENSIONS.has(resolvedModule.extension)
	) {
		return false;
	}

	return !/[\\/]@types[\\/]/u.test(resolvedModule.resolvedFileName);
}

const vendorSource = fs.readFileSync(VENDOR_DTS, "utf8");
const manifest = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("vendor ambient declarations", () => {
	// Each probe spins up a real `tsc` program; the default 2s is tight.
	const PROBE_TIMEOUT = 60000;

	beforeEach(function () {
		this.timeout(PROBE_TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API
	});

	describe("the file itself", () => {
		it("declares every module the epic's phase 0-2 scope needs", () => {
			for (const specifier of DECLARED_MODULES) {
				assert.include(
					vendorSource,
					`declare module "${specifier}" {`,
					`lib/types/vendor.d.ts does not declare "${specifier}"`,
				);
			}
		});

		/*
		 * The file's header promises a reason on every block, because a
		 * hand-written declaration with no stated justification is impossible
		 * for a later reader to retire safely.
		 */
		it("gives every declaration a stated reason", () => {
			const blocks = vendorSource.split(/^declare module /mu).slice(1);

			assert.isAtLeast(blocks.length, DECLARED_MODULES.length);

			for (const [index, block] of blocks.entries()) {
				const specifier = /^"(?<name>[^"]+)"/u.exec(block).groups.name;
				const preceding = vendorSource
					.split(`declare module "${specifier}"`)[0]
					.trimEnd();

				assert.isTrue(
					preceding.endsWith("*/"),
					`the "${specifier}" declaration (block ${index + 1}) is not preceded by a comment`,
				);
				assert.include(
					preceding.slice(preceding.lastIndexOf("/**")),
					"Reason:",
					`the "${specifier}" declaration does not state why it exists`,
				);
			}
		});
	});

	describe("esutils", () => {
		it("still ships no declarations of its own", () => {
			assert.isFalse(
				shipsOwnDeclarations("esutils"),
				"esutils now ships its own types — delete the ambient block in lib/types/vendor.d.ts",
			);
		});

		/*
		 * The whole reason `@types/esutils` was rejected: it declares `strict`
		 * as required, and both real call sites pass one argument. If this ever
		 * becomes a dependency, `func-name-matching.js` stops compiling.
		 */
		it("is not typed by @types/esutils", () => {
			for (const field of [
				"dependencies",
				"devDependencies",
				"peerDependencies",
				"optionalDependencies",
			]) {
				assert.notProperty(
					manifest[field] ?? {},
					"@types/esutils",
					`@types/esutils must not be a ${field} — it declares "strict" as required when it is optional at runtime`,
				);
			}
		});

		it("accepts the one-argument calls func-name-matching.js makes", () => {
			expectClean(
				"esutils-keyword-probe.ts",
				[
					'import * as esutils from "esutils";',
					"",
					"// lib/rules/func-name-matching.js:55-60, verbatim.",
					"export function isIdentifier(name: string, ecmaVersion: number): boolean {",
					"	if (ecmaVersion >= 6) {",
					"		return esutils.keyword.isIdentifierES6(name);",
					"	}",
					"	return esutils.keyword.isIdentifierES5(name);",
					"}",
					"",
					"// The optional second argument is still accepted.",
					"export const strictly = esutils.keyword.isIdentifierES5(",
					'	"await",',
					"	true,",
					");",
				].join("\n"),
			);
		});

		it("still type-checks the identifier predicates", () => {
			expectError(
				"esutils-keyword-negative-probe.ts",
				[
					'import * as esutils from "esutils";',
					"",
					"export const bad = esutils.keyword.isIdentifierES5(42);",
				].join("\n"),
				2345,
			);
		});

		it("gives trailingStatement a real return type rather than any", () => {
			const source = [
				'import * as esutils from "esutils";',
				"",
				"declare const node: {",
				"	type: string;",
				"	range: [number, number];",
				"	loc: {",
				"		start: { line: number; column: number };",
				"		end: { line: number; column: number };",
				"	};",
				"};",
				"",
				"export const trailing = esutils.ast.trailingStatement(node);",
				"",
				"// lib/rules/utils/ast-utils.js:1700 re-exports the function itself.",
				"export const getTrailingStatement = esutils.ast.trailingStatement;",
			].join("\n");

			const program = expectClean("esutils-ast-probe.ts", source);

			assert.strictEqual(
				typeTextOf(
					program,
					path.join(PROBE_DIR, "esutils-ast-probe.ts"),
					"trailing",
				),
				"StatementNode | null",
				"trailingStatement must return the node vocabulary's statement type or null, never any",
			);
		});

		/*
		 * `any` would swallow this silently, which is exactly the outcome the
		 * bead forbids for the one esutils symbol on `ast-utils`'s own export
		 * surface.
		 */
		it("does not let the trailing statement be used as a string", () => {
			expectError(
				"esutils-ast-negative-probe.ts",
				[
					'import * as esutils from "esutils";',
					"",
					"declare const node: {",
					"	type: string;",
					"	range: [number, number];",
					"	loc: {",
					"		start: { line: number; column: number };",
					"		end: { line: number; column: number };",
					"	};",
					"};",
					"",
					"export const bad: string = esutils.ast.trailingStatement(node);",
				].join("\n"),
				2322,
			);
		});
	});

	describe("@humanwhocodes/module-importer", () => {
		/*
		 * The package does ship `dist/module-importer.d.cts` and does set a
		 * top-level `types` field; it is the `exports` map with no `types`
		 * condition that hides them. So this guard has to resolve the way the
		 * compiler does rather than read the manifest, or it would conclude the
		 * block is unnecessary.
		 */
		it("still hides its declarations behind its exports map", () => {
			assert.isFalse(
				shipsOwnDeclarations("@humanwhocodes/module-importer"),
				"@humanwhocodes/module-importer now exposes its types to the compiler — delete the ambient block in lib/types/vendor.d.ts",
			);
		});

		it("compiles the call sites in translate-cli-options.js", () => {
			expectClean(
				"module-importer-probe.ts",
				[
					'import { ModuleImporter } from "@humanwhocodes/module-importer";',
					"",
					"// lib/shared/translate-cli-options.js:115, :37 and :141.",
					"export async function loadPlugin(longName: string): Promise<unknown> {",
					"	const importer = new ModuleImporter();",
					"	const loaded = await importer.import(longName);",
					"",
					'	if (!("default" in loaded)) {',
					"		throw new Error(`${longName} has no default export`);",
					"	}",
					"",
					"	return loaded.default;",
					"}",
					"",
					"export async function loadParser(parser: string): Promise<unknown> {",
					"	return new ModuleImporter().import(parser);",
					"}",
				].join("\n"),
			);
		});

		/*
		 * `resolve()` exists upstream but ESLint never calls it. Declaring only
		 * what is used is the file's stated discipline; this is what enforces
		 * it, and it doubles as proof that `ModuleImporter` is a real class
		 * type rather than an `any` that accepts anything.
		 */
		it("declares only the surface ESLint uses", () => {
			expectError(
				"module-importer-negative-probe.ts",
				[
					'import { ModuleImporter } from "@humanwhocodes/module-importer";',
					"",
					'export const bad = new ModuleImporter().resolve("eslint");',
				].join("\n"),
				2339,
			);
		});
	});

	describe("file-entry-cache", () => {
		it("still ships no declarations of its own", () => {
			assert.isFalse(
				shipsOwnDeclarations("file-entry-cache"),
				"file-entry-cache now ships its own types — delete the ambient block in lib/types/vendor.d.ts",
			);
		});

		it("compiles the full lint-result-cache.js round trip", () => {
			expectClean(
				"file-entry-cache-probe.ts",
				[
					'import * as fileEntryCache from "file-entry-cache";',
					'import type { LintResult } from "./types/core.js";',
					"",
					"// lib/cli-engine/lint-result-cache.js:90.",
					"export function open(location: string, useChecksum: boolean) {",
					"	return fileEntryCache.create(location, void 0, useChecksum);",
					"}",
					"",
					"// :150-167 — read.",
					"export function read(",
					"	cache: ReturnType<typeof open>,",
					"	filePath: string,",
					"	hashOfConfig: string,",
					"): LintResult | null {",
					"	const descriptor = cache.getFileDescriptor(filePath);",
					"",
					"	if (descriptor.notFound) {",
					"		return null;",
					"	}",
					"",
					"	if (",
					"		descriptor.changed ||",
					"		descriptor.meta.hashOfConfig !== hashOfConfig",
					"	) {",
					"		return null;",
					"	}",
					"",
					"	const results = { ...descriptor.meta.results };",
					"",
					"	if (results.source === null) {",
					'		results.source = "reread from disk";',
					"	}",
					"",
					"	return { ...results, source: results.source };",
					"}",
					"",
					"// :185-203 — write. `meta` has to be mutable for this to compile.",
					"export function write(",
					"	cache: ReturnType<typeof open>,",
					"	filePath: string,",
					"	result: LintResult,",
					"	hashOfConfig: string,",
					"): void {",
					"	const descriptor = cache.getFileDescriptor(filePath);",
					"",
					"	if (descriptor && !descriptor.notFound) {",
					"		descriptor.meta.results = { ...result, source: null };",
					"		descriptor.meta.hashOfConfig = hashOfConfig;",
					"	}",
					"}",
					"",
					"// :212.",
					"export function persist(cache: ReturnType<typeof open>): void {",
					"	cache.reconcile();",
					"}",
					"",
					"// `meta` is non-optional, so no undefined check is needed here.",
					"export function errorCount(",
					"	cache: ReturnType<typeof open>,",
					"	filePath: string,",
					"): number {",
					"	return cache.getFileDescriptor(filePath).meta.results.errorCount;",
					"}",
				].join("\n"),
			);
		});

		/*
		 * `meta.results` is the whole reason this block exists. Typed as a bag
		 * — `Record<string, unknown>`, or `any` — the probe below would compile
		 * and `lint-result-cache.js` would be checking nothing about the
		 * payload it stores.
		 */
		it("types meta.results against LintResult rather than a bag", () => {
			expectError(
				"file-entry-cache-negative-probe.ts",
				[
					'import * as fileEntryCache from "file-entry-cache";',
					"",
					"export function bad(location: string, filePath: string) {",
					"	const cache = fileEntryCache.create(location);",
					"",
					"	return cache.getFileDescriptor(filePath).meta.results",
					"		.notALintResultField;",
					"}",
				].join("\n"),
				2339,
			);
		});

		it("keeps the cached result assignable from a real LintResult", () => {
			const program = expectClean(
				"file-entry-cache-shape-probe.ts",
				[
					'import * as fileEntryCache from "file-entry-cache";',
					"",
					"export const results = fileEntryCache",
					'	.create("cache")',
					'	.getFileDescriptor("file.js").meta.results;',
					"",
					"export const messages = results.messages;",
				].join("\n"),
			);

			assert.strictEqual(
				typeTextOf(
					program,
					path.join(PROBE_DIR, "file-entry-cache-shape-probe.ts"),
					"messages",
				),
				"LintMessage[]",
				"the cached result must carry the LintResult vocabulary through to its members",
			);
		});
	});
});

/**
 * @fileoverview Guards the runtime dependency type-availability audit recorded in
 * `.shreni/design/typescript-types-from-jsdoc.md`.
 *
 * The audit decides how much hand-authored ambient typing the JSDoc-to-`.d.ts`
 * conversion has to pay for. It is only useful if it stays true, and it is a
 * markdown table, so nothing stops it from silently going stale when a
 * dependency is added, upgraded, or starts shipping its own declarations.
 *
 * These tests re-derive the facts from the installed tree — via the same
 * `ts.resolveModuleName()` call the compiler itself uses — and fail if the
 * table disagrees with reality.
 * @author Navakanth Gandavarapu
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
const DESIGN_NOTE = path.join(
	REPO_ROOT,
	".shreni/design/typescript-types-from-jsdoc.md",
);

/**
 * Where module resolution is performed from. Any file inside `lib/` gives the
 * same answer; the file does not need to exist.
 */
const CONTAINING_FILE = path.join(REPO_ROOT, "lib", "resolution-probe.js");

/**
 * Mirrors the resolution-relevant options the type-check gate will use.
 * `resolveJsonModule` is required because `lib/shared/ajv.js` and
 * `lib/config/config-loader.js` require JSON across package boundaries.
 */
const COMPILER_OPTIONS = {
	allowJs: true,
	resolveJsonModule: true,
	moduleResolution: ts.ModuleResolutionKind.Node16,
	module: ts.ModuleKind.Node16,
	target: ts.ScriptTarget.ES2022,
};

const DECLARATION_EXTENSIONS = new Set([
	ts.Extension.Dts,
	ts.Extension.Dcts,
	ts.Extension.Dmts,
]);

/**
 * Dependencies that `lib/` reaches through `await import()` rather than
 * `require()`. TypeScript resolves those in ESM mode, and for packages whose
 * `exports` map has no `require` condition that is the only mode that resolves
 * at all.
 */
const ESM_RESOLVED_DEPENDENCIES = new Set(["@humanfs/node"]);

/**
 * The three buckets the audit sorts every runtime dependency into.
 * `ships-types` means the package's own tarball carries the declarations;
 * the other two mean it does not, and differ only in whether DefinitelyTyped
 * has a usable answer.
 */
const CLASSIFICATIONS = new Set([
	"ships-types",
	"needs-@types",
	"needs-ambient",
]);

/**
 * Resolves a bare specifier the way the compiler would.
 * @param {string} specifier The package name to resolve.
 * @returns {ts.ResolvedModuleFull|null} The resolution, or `null` if it failed.
 */
function resolve(specifier) {
	const mode = ESM_RESOLVED_DEPENDENCIES.has(specifier)
		? ts.ModuleKind.ESNext
		: ts.ModuleKind.CommonJS;
	const { resolvedModule } = ts.resolveModuleName(
		specifier,
		CONTAINING_FILE,
		COMPILER_OPTIONS,
		ts.sys,
		void 0,
		void 0,
		mode,
	);

	return resolvedModule ?? null;
}

/**
 * Determines whether a package supplies declarations out of its own tarball.
 *
 * A resolution that lands in `node_modules/@types` does not count: that is a
 * DefinitelyTyped package, which can be installed or uninstalled independently
 * of the dependency itself, so it says nothing about the dependency.
 * @param {string} specifier The package name to check.
 * @returns {boolean} `true` if the package ships its own declarations.
 */
function shipsOwnDeclarations(specifier) {
	const resolved = resolve(specifier);

	if (!resolved || !DECLARATION_EXTENSIONS.has(resolved.extension)) {
		return false;
	}

	return !/[\\/]@types[\\/]/u.test(resolved.resolvedFileName);
}

/**
 * Reads the installed version of a direct dependency.
 * @param {string} specifier The package name.
 * @returns {string} The installed version.
 * @throws {Error} If the package is not installed.
 */
function installedVersion(specifier) {
	const manifest = path.join(
		REPO_ROOT,
		"node_modules",
		specifier,
		"package.json",
	);

	return JSON.parse(fs.readFileSync(manifest, "utf8")).version;
}

/**
 * Extracts the verdict table from the design note.
 *
 * Rows are matched on the classification column, so the other tables in the
 * note (which have different shapes) are ignored rather than needing the
 * section to be located by heading.
 * @param {string} note The design note contents.
 * @returns {Array<{dependency: string, version: string, classification: string}>} The parsed rows.
 */
function parseVerdictTable(note) {
	/*
	 * Column padding is not fixed: Prettier reflows markdown tables to align
	 * the pipes, and the alignment shifts whenever the longest cell changes.
	 * Match on structure and tolerate the whitespace.
	 */
	const rowPattern =
		/^\|\s*`(?<dependency>[^`]+)`\s*\|\s*(?<version>\S+)\s*\|\s*(?<classification>ships-types|needs-@types|needs-ambient)\s*\|/gmu;

	return [...note.matchAll(rowPattern)].map(match => ({
		dependency: match.groups.dependency,
		version: match.groups.version,
		classification: match.groups.classification,
	}));
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("dependency type-availability audit", () => {
	const note = fs.readFileSync(DESIGN_NOTE, "utf8");
	const rows = parseVerdictTable(note);
	const declaredDependencies = Object.keys(
		require("../../../package.json").dependencies,
	);

	it("parses a non-empty verdict table out of the design note", () => {
		assert.isAbove(
			rows.length,
			0,
			"No verdict rows were found. Has the table format in the design note changed?",
		);
	});

	it("classifies every runtime dependency", () => {
		const classified = new Set(rows.map(row => row.dependency));
		const unclassified = declaredDependencies.filter(
			dependency => !classified.has(dependency),
		);

		assert.deepStrictEqual(
			unclassified,
			[],
			"These runtime dependencies are missing from the audit table. Classify them as ships-types / needs-@types / needs-ambient before annotation work depends on them.",
		);
	});

	it("classifies nothing that is not a runtime dependency", () => {
		const runtime = new Set(declaredDependencies);
		const strays = rows
			.map(row => row.dependency)
			.filter(dependency => !runtime.has(dependency));

		assert.deepStrictEqual(
			strays,
			[],
			"These audit rows no longer correspond to a `dependencies` entry in package.json.",
		);
	});

	it("uses only the three known classifications", () => {
		for (const row of rows) {
			assert.isTrue(
				CLASSIFICATIONS.has(row.classification),
				`Unknown classification "${row.classification}" for ${row.dependency}.`,
			);
		}
	});

	describe("recorded versions", () => {
		it("match the installed tree", () => {
			for (const row of rows) {
				assert.strictEqual(
					row.version,
					installedVersion(row.dependency),
					`The audit records ${row.dependency}@${row.version}, but ${installedVersion(row.dependency)} is installed. Re-run the audit for this dependency: an upgrade can change whether it ships declarations.`,
				);
			}
		});
	});

	describe("ships-types", () => {
		it("resolves to declarations inside the package itself", () => {
			const wrong = rows
				.filter(row => row.classification === "ships-types")
				.filter(row => !shipsOwnDeclarations(row.dependency))
				.map(row => row.dependency);

			assert.deepStrictEqual(
				wrong,
				[],
				"These are recorded as shipping their own declarations, but no longer resolve to one. Anything downstream of them is now an implicit `any`.",
			);
		});
	});

	describe("needs-@types and needs-ambient", () => {
		it("ship no declarations of their own", () => {
			const wrong = rows
				.filter(row => row.classification !== "ships-types")
				.filter(row => shipsOwnDeclarations(row.dependency))
				.map(row => row.dependency);

			assert.deepStrictEqual(
				wrong,
				[],
				"These now ship their own declarations. Reclassify them as ships-types and drop the @types package or ambient module standing in for them.",
			);
		});
	});

	describe("needs-ambient", () => {
		it("scopes the required declaration for each entry", () => {
			const ambient = rows.filter(
				row => row.classification === "needs-ambient",
			);

			assert.isAbove(ambient.length, 0);

			for (const row of ambient) {
				assert.include(
					note,
					`#### \`${row.dependency}@${row.version}\``,
					`${row.dependency} is classified needs-ambient but has no section scoping which symbols the ambient declaration must cover.`,
				);
			}
		});
	});

	describe("undeclared @types the type-check gate would depend on", () => {
		/*
		 * These resolve today only because an unrelated dev-dependency happens to
		 * pull them in. The audit calls for declaring them explicitly; this test
		 * exists so that the day one of them stops resolving is not the same day
		 * an unrelated plugin upgrade lands.
		 */
		for (const typesPackage of ["node", "estree", "debug"]) {
			it(`@types/${typesPackage} is resolvable`, () => {
				assert.isTrue(
					fs.existsSync(
						path.join(
							REPO_ROOT,
							"node_modules/@types",
							typesPackage,
						),
					),
					`@types/${typesPackage} is gone. It is not declared in package.json, so it was only ever present transitively — declare it as a devDependency.`,
				);
			});
		}
	});

	describe("JSON imported across package boundaries", () => {
		/*
		 * `lib/shared/ajv.js` and `lib/config/config-loader.js` require JSON out of
		 * other packages, which is what makes `resolveJsonModule` mandatory rather
		 * than optional in the eventual tsconfig.
		 */
		for (const specifier of [
			"ajv/lib/refs/json-schema-draft-04.json",
			"jiti/package.json",
		]) {
			it(`resolves ${specifier} only with resolveJsonModule`, () => {
				assert.isNotNull(
					resolve(specifier),
					`${specifier} no longer resolves with resolveJsonModule enabled.`,
				);

				const withoutFlag = ts.resolveModuleName(
					specifier,
					CONTAINING_FILE,
					{ ...COMPILER_OPTIONS, resolveJsonModule: false },
					ts.sys,
				).resolvedModule;

				assert.isUndefined(
					withoutFlag,
					`${specifier} now resolves without resolveJsonModule; the audit's claim that the flag is mandatory needs revisiting.`,
				);
			});
		}
	});
});

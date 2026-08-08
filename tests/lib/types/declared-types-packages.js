/**
 * @fileoverview Guards the DefinitelyTyped packages the type-check gate depends on.
 *
 * Six runtime dependencies ship no declarations of their own and are typed by a
 * `@types/*` package instead. Nothing `require()`s a `@types` package — the
 * compiler consumes it — so the only thing tying one to the repository is a
 * line in `devDependencies`, and the only thing tying that line to reality is a
 * test like this one.
 *
 * The gate itself cannot do that job here. No file in the `tsconfig.json`
 * allowlist requires any of these six yet, so `npm run lint:types` compiles
 * without ever resolving them: the declaration is green by construction. These
 * tests close the gap the same way `tests/lib/types/vendor.js` does for the
 * hand-written ambients — by compiling probes that mirror the real call sites,
 * two-sided, because a package that resolved to `any` would satisfy a positive
 * probe just as happily as a correct one.
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
const VENDOR_DTS = path.join(REPO_ROOT, "lib/types/vendor.d.ts");
const DESIGN_NOTE = path.join(
	REPO_ROOT,
	".shreni/design/typescript-types-from-jsdoc.md",
);

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so that bare specifiers resolve against `node_modules/` exactly as
 * they do for a real source file.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/**
 * Mirrors the resolution-relevant options of the shipped gate
 * (`tsconfig.base.json`). `types: ["node"]` matters: it is what keeps these
 * `@types` packages out of the ambient global scope, so each probe has to
 * resolve its package through the import it writes — which is the thing under
 * test.
 */
const COMPILER_OPTIONS = {
	strict: true,
	skipLibCheck: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
	types: ["node"],
};

/**
 * The DefinitelyTyped packages this change declares, each paired with the
 * runtime dependency it types, the call sites it exists for, and a two-sided
 * probe.
 *
 * `positive` mirrors what `lib/` actually calls. `negative` asserts a *specific*
 * error code rather than merely "some diagnostic", so a package that widened to
 * `any` fails here instead of sailing through.
 */
const TYPED_PACKAGES = [
	{
		dependency: "cross-spawn",
		version: "6.0.6",
		consumers: [
			"lib/shared/runtime-info.js:53",
			"lib/cli.js:268",
			"bin/eslint.js:72",
		],

		/*
		 * A deliberate major-version skew: `@types/cross-spawn@6` against
		 * `cross-spawn@7`. The consumed surface is only `sync`, which the DT
		 * package types as `typeof child_process.spawnSync` — still correct for
		 * v7. The probe pins exactly that, including the `encoding: "utf8"`
		 * overload that makes `stdout` a string rather than a Buffer.
		 */
		positive: `
			import spawn = require("cross-spawn");

			const result = spawn.sync("node", ["-v"], { encoding: "utf8" });

			export const failure: Error | undefined = result.error;
			export const version: string = result.stdout.trim();
		`,
		negative: `
			import spawn = require("cross-spawn");

			export const wrong: number = spawn.sync("node", ["-v"], {
				encoding: "utf8",
			}).stdout;
		`,
		code: 2322,
	},
	{
		dependency: "esquery",
		version: "1.5.4",
		consumers: ["lib/linter/esquery.js:253", "lib/linter/esquery.js:309"],

		/*
		 * This is the one adoption that is a design decision rather than a free
		 * win: `@types/esquery` types nodes as `estree.Node`, so it speaks the
		 * estree vocabulary at this boundary. That is consistent with the y6r.15
		 * decision — estree is spoken at boundaries, it is just not ESLint's own
		 * node vocabulary — and the probe records the coupling explicitly by
		 * importing `estree` itself.
		 */
		positive: `
			import esquery = require("esquery");
			import type { Node } from "estree";

			declare const node: Node;
			declare const ancestry: Node[];

			const selector = esquery.parse("Identifier");

			export const matched: boolean = esquery.matches(
				node,
				selector,
				ancestry,
				{ visitorKeys: { Identifier: [] } },
			);
		`,
		negative: `
			import esquery = require("esquery");

			export const wrong: number = esquery.parse("Identifier");
		`,
		code: 2322,
	},
	{
		dependency: "glob-parent",
		version: "5.1.3",
		consumers: ["lib/eslint/eslint-helpers.js:589"],
		positive: `
			import globParent = require("glob-parent");

			export const base: string = globParent("lib/**/*.js");
		`,
		negative: `
			import globParent = require("glob-parent");

			export const wrong: number = globParent("lib/**/*.js");
		`,
		code: 2322,
	},
	{
		dependency: "is-glob",
		version: "4.0.4",
		consumers: ["lib/eslint/eslint-helpers.js:174"],
		positive: `
			import isGlob = require("is-glob");

			export const glob: boolean = isGlob("lib/**/*.js");
		`,
		negative: `
			import isGlob = require("is-glob");

			export const wrong: string = isGlob("lib/**/*.js");
		`,
		code: 2322,
	},
	{
		dependency: "json-stable-stringify-without-jsonify",
		version: "1.0.2",
		consumers: [
			"lib/cli-engine/lint-result-cache.js:54",
			"lib/rule-tester/rule-tester.js:22",
			"lib/services/suppressions-service.js:15",
		],
		positive: `
			import stringify = require("json-stable-stringify-without-jsonify");

			export const serialized: string = stringify({ rules: {} });
		`,
		negative: `
			import stringify = require("json-stable-stringify-without-jsonify");

			export const wrong: number = stringify({ rules: {} });
		`,
		code: 2322,
	},
	{
		dependency: "natural-compare",
		version: "1.4.3",
		consumers: ["lib/rules/sort-keys.js:55", "lib/rules/sort-keys.js:58"],
		positive: `
			import naturalCompare = require("natural-compare");

			export const ordering: number = naturalCompare("a", "b");
		`,
		negative: `
			import naturalCompare = require("natural-compare");

			export const wrong: string = naturalCompare("a", "b");
		`,
		code: 2322,
	},
];

/**
 * Compiles a synthetic TypeScript source against the installed `node_modules`.
 *
 * The source is served from memory so the test leaves nothing behind, but the
 * containing directory is real, so `require("is-glob")` resolves exactly as it
 * would for a file in `lib/`.
 * @param {string} source The probe source.
 * @returns {ts.Diagnostic[]} The probe's syntactic and semantic diagnostics.
 */
function compile(source) {
	/*
	 * The host key MUST be forward-slash normalized — `probePath`, never bare
	 * `path.join`. TypeScript normalizes root names and asks the host below for
	 * forward-slash paths on every platform, so a Windows-native key never
	 * matches and the probe is silently dropped from the program.
	 */
	const fileName = probePath(PROBE_DIR, "types-package-probe.ts");
	const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
	const { getSourceFile, fileExists, readFile } = host;

	host.getSourceFile = (name, languageVersion, ...rest) =>
		name === fileName
			? ts.createSourceFile(name, source, languageVersion, true)
			: getSourceFile.call(host, name, languageVersion, ...rest);
	host.fileExists = name => name === fileName || fileExists.call(host, name);
	host.readFile = name =>
		name === fileName ? source : readFile.call(host, name);

	const program = ts.createProgram([fileName], COMPILER_OPTIONS, host);

	assertProbesLoaded(program, [fileName]);

	/*
	 * Only syntactic and semantic diagnostics are collected. Global diagnostics
	 * would include unrelated `lib` noise from the ambient environment, which
	 * says nothing about the probe.
	 */
	return [
		...program.getSyntacticDiagnostics(),
		...program.getSemanticDiagnostics(),
	];
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
 * Reads the installed version of a package.
 * @param {string} specifier The package name.
 * @returns {string} The installed version.
 * @throws {Error} If the package is not installed.
 */
function installedVersion(specifier) {
	return JSON.parse(
		fs.readFileSync(
			path.join(REPO_ROOT, "node_modules", specifier, "package.json"),
			"utf8",
		),
	).version;
}

const manifest = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("declared @types packages", () => {
	// Each probe spins up a real `tsc` program; the default 2s is tight.
	const PROBE_TIMEOUT = 60000;

	beforeEach(function () {
		this.timeout(PROBE_TIMEOUT); // eslint-disable-line no-invalid-this -- Mocha API
	});

	for (const entry of TYPED_PACKAGES) {
		const typesPackage = `@types/${entry.dependency}`;

		describe(typesPackage, () => {
			it("is a declared devDependency", () => {
				assert.property(
					manifest.devDependencies,
					typesPackage,
					`${typesPackage} types ${entry.consumers.join(", ")}. It is consumed by the compiler, not by any require(), so nothing else keeps it installed.`,
				);
			});

			it("is not also a runtime dependency", () => {
				assert.notProperty(
					manifest.dependencies,
					typesPackage,
					`${typesPackage} is compile-time only and must not ship to consumers.`,
				);
			});

			it("is installed at the version the audit verified", () => {
				assert.strictEqual(
					installedVersion(typesPackage),
					entry.version,
					`The audit in .shreni/design/typescript-types-from-jsdoc.md verified ${typesPackage}@${entry.version} against the real call sites. Re-run those probes before recording a different version.`,
				);
			});

			it("types the real call sites", () => {
				const diagnostics = compile(entry.positive);

				assert.strictEqual(
					diagnostics.length,
					0,
					`A probe mirroring ${entry.consumers.join(", ")} was expected to compile clean but did not:\n${format(diagnostics)}`,
				);
			});

			it("constrains those call sites rather than widening to `any`", () => {
				const diagnostics = compile(entry.negative);

				assert.isNotEmpty(
					diagnostics,
					`The negative probe compiled clean, so ${typesPackage} is not constraining anything — an \`any\` would pass the positive probe too.`,
				);
				assert.includeMembers(
					diagnostics.map(diagnostic => diagnostic.code),
					[entry.code],
					`The negative probe was rejected, but not for the expected reason:\n${format(diagnostics)}`,
				);
			});
		});
	}

	describe("coverage of the audit's needs-@types bucket", () => {
		/*
		 * The audit sorts every runtime dependency into ships-types /
		 * needs-@types / needs-ambient. A needs-@types entry has, by definition,
		 * no declarations anywhere unless this repository supplies them — so
		 * every one of them must be answered either by a `@types` devDependency
		 * or by a hand-written block in `lib/types/vendor.d.ts`.
		 *
		 * This is what makes the suite survive its own scope. Adding a new
		 * needs-@types dependency fails it; so does retiring the `imurmurhash`
		 * ambient in favour of `@types/imurmurhash`, unless both halves of that
		 * swap land together.
		 */
		const auditedNeedsTypes = [
			...fs
				.readFileSync(DESIGN_NOTE, "utf8")
				.matchAll(
					/^\|\s*`(?<dependency>[^`]+)`\s*\|\s*\S+\s*\|\s*needs-@types\s*\|/gmu,
				),
		].map(match => match.groups.dependency);

		const vendorSource = fs.readFileSync(VENDOR_DTS, "utf8");

		it("finds the bucket in the design note", () => {
			assert.isAbove(
				auditedNeedsTypes.length,
				0,
				"No needs-@types rows were found. Has the table format in the design note changed?",
			);
		});

		it("answers every entry with a @types package or an ambient block", () => {
			const unanswered = auditedNeedsTypes.filter(
				dependency =>
					!Object.hasOwn(
						manifest.devDependencies,
						`@types/${dependency}`,
					) &&
					!vendorSource.includes(`declare module "${dependency}" {`),
			);

			assert.deepStrictEqual(
				unanswered,
				[],
				"These dependencies ship no declarations and nothing in this repository supplies any. Anything downstream of them is an implicit `any` the moment it enters the allowlist.",
			);
		});

		it("answers each entry exactly once", () => {
			const doubled = auditedNeedsTypes.filter(
				dependency =>
					Object.hasOwn(
						manifest.devDependencies,
						`@types/${dependency}`,
					) &&
					vendorSource.includes(`declare module "${dependency}" {`),
			);

			assert.deepStrictEqual(
				doubled,
				[],
				"These have both a @types package and a hand-written ambient block. The ambient is an escape hatch with no reason to exist once the @types package is declared — delete it.",
			);
		});
	});
});

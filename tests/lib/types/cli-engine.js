/**
 * @fileoverview Guards the annotation of `lib/cli-engine/` — `lint-result-cache.js`
 * and the four built-in formatters.
 *
 * These files sit in the `tsconfig.json` allowlist, so `tsc` compiles them for
 * real. That is not the same as them being typed: an undocumented parameter in
 * a `.js` file is an implicit `any`, and `any` type-checks clean forever. So
 * every positive probe here is paired with a negative one that must be
 * REJECTED, because a signature that had decayed to `any` would accept both.
 *
 * Two claims in this directory are unusual enough to need more than
 * assignability:
 *
 * 1. The formatters have NO inbound `require` edge — they are loaded by name at
 *    runtime (`lib/eslint/eslint.js:1262-1292`), so nothing in the codebase
 *    states their contract except the `@type {Formatter}` on each
 *    `module.exports`. The bead requires that contract to be REFERENCED from
 *    `core.d.ts` rather than inlined, and an inlined structural look-alike is
 *    assignable in both directions — so the check has to read the declared type
 *    NAME and the FILE its symbol came from, not just compile a call.
 * 2. `lint-result-cache.js` stores a lint result whose `source` may be `null`,
 *    a third state `LintResult` cannot express. The stored and the rebuilt
 *    forms must stay distinguishable, or the `null` that tells
 *    `getCachedLintResults` to reread the file from disk becomes invisible.
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
const CLI_ENGINE_DIR = path.join(REPO_ROOT, "lib/cli-engine");

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so that both bare specifiers and the relative `./cli-engine/...`
 * imports resolve exactly as they do for a real source file.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/**
 * The hand-authored ambient declarations. `lint-result-cache.js` cannot be
 * typed without the `file-entry-cache` block, and nothing pulls an ambient
 * block into a program implicitly — the shipped gate gets it from the
 * `tsconfig.json` allowlist, so a probe program has to name it as a root the
 * same way.
 */
const VENDOR_DTS = probePath(REPO_ROOT, "lib/types/vendor.d.ts");

/** The files this bead annotated, plus the one PR #1 already landed. */
const ANNOTATED_FILES = [
	"lib/cli-engine/hash.js",
	"lib/cli-engine/lint-result-cache.js",
	"lib/cli-engine/formatters/html.js",
	"lib/cli-engine/formatters/json-with-metadata.js",
	"lib/cli-engine/formatters/json.js",
	"lib/cli-engine/formatters/stylish.js",
];

/** The four built-in formatters, by module specifier from `lib/`. */
const FORMATTERS = ["html", "json", "json-with-metadata", "stylish"].map(
	name => ({ name, specifier: `./cli-engine/formatters/${name}.js` }),
);

/**
 * Where the formatter contract is required to live.
 *
 * The bead's acceptance criterion is that the contract is "referenced as a
 * named type from core.d.ts, not an inline shape" — which is a claim about a
 * NAME and a FILE, not about a shape.
 */
const FORMATTER_CONTRACT = {
	name: "Formatter",
	file: "lib/types/core.d.ts",
};

/**
 * Mirrors the resolution- and inference-relevant options of the shipped gate
 * (`tsconfig.base.json`).
 *
 * `resolveJsonModule` is not optional here — `lint-result-cache.js` requires
 * the root `package.json` for the version it folds into the config hash.
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
 * Finds the `const probe` declaration a type-reading probe is required to make.
 * @param {ts.SourceFile} sourceFile The compiled probe.
 * @returns {ts.Node} The identifier bound by `const probe`.
 */
function probeDeclaration(sourceFile) {
	/** @type {ts.Node | null} */
	let declaration = null;

	ts.forEachChild(sourceFile, function visit(child) {
		if (
			ts.isVariableDeclaration(child) &&
			child.name.getText() === "probe"
		) {
			declaration = child.name;
		}
		ts.forEachChild(child, visit);
	});

	assert.isNotNull(declaration, "the probe must declare `const probe`");

	return declaration;
}

/**
 * Reads the type of `const probe` and the file it was declared in.
 *
 * Assignability alone cannot make the claim this is used for. A formatter whose
 * export had decayed to `any` would satisfy every "can it be called?" probe in
 * this file, and a hand-inlined `(results: LintResult[], context: …) => string`
 * would satisfy them too — which is exactly the shape the bead forbids. Reading
 * the printed NAME and the DECLARING FILE off the type's symbol is what
 * separates "references the shared contract" from "happens to match it".
 * @param {string} source The probe source. Must declare `const probe`.
 * @returns {{name: string, file: string}} The printed type name and the
 * repo-relative file its symbol was declared in.
 */
function declaredTypeOf(source) {
	const name = "probe-declared-type.ts";
	const { program, diagnostics } = compile({ [name]: source });

	assert.strictEqual(
		diagnostics.length,
		0,
		`the probe must compile before its type can be read:\n${format(diagnostics)}`,
	);

	const checker = program.getTypeChecker();
	const declaration = probeDeclaration(
		program.getSourceFile(probePath(PROBE_DIR, name)),
	);
	const type = checker.getTypeAtLocation(declaration);
	const symbol = type.aliasSymbol ?? type.symbol;

	assert.isDefined(
		symbol,
		`the probe's type is \`${checker.typeToString(type)}\`, which declares nothing — an \`any\` leaking out would look exactly like this`,
	);

	return {
		name: symbol.getName(),
		file: path
			.relative(
				REPO_ROOT,
				symbol.declarations[0].getSourceFile().fileName,
			)
			.replaceAll(path.sep, "/"),
	};
}

/**
 * Reads every `require()` and dynamic `import()` specifier out of a source file.
 * @param {string} filePath Absolute path to a JavaScript file.
 * @returns {string[]} The specifiers, in source order.
 */
function importedSpecifiers(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const specifiers = [];
	const pattern =
		/\b(?:require|import)\(\s*"([^"]+)"\s*\)|@import\s+\{[^}]*\}\s+from\s+"([^"]+)"/gu;
	let match;

	while ((match = pattern.exec(source)) !== null) {
		specifiers.push(match[1] ?? match[2]);
	}

	return specifiers;
}

/**
 * Lists every `.js` file under a directory, recursively.
 * @param {string} directory The directory to walk.
 * @returns {string[]} Absolute paths, in traversal order.
 */
function jsFilesUnder(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			return jsFilesUnder(full);
		}

		return entry.name.endsWith(".js") ? [full] : [];
	});
}

/**
 * A realistic lint result, as `Linter#verify` callers assemble one.
 *
 * Written once and shared by the positive and negative cache probes so that the
 * only difference between them is the member under test.
 */
const LINT_RESULT_LITERAL = `{
	filePath: "/tmp/a.js",
	messages: [],
	suppressedMessages: [],
	errorCount: 0,
	fatalErrorCount: 0,
	warningCount: 0,
	fixableErrorCount: 0,
	fixableWarningCount: 0,
	usedDeprecatedRules: [],
}`;

/** Declarations every `lint-result-cache.js` probe needs. */
const CACHE_PREAMBLE = `import LintResultCache = require("./cli-engine/lint-result-cache.js");
import type { Config, LintResult } from "./types/core.js";

declare const config: Config;
const cache = new LintResultCache("/tmp/.eslintcache", "metadata");
`;

/** Declarations every formatter probe needs. */
const FORMATTER_PREAMBLE = `import type { FormatterContext, LintResult } from "./types/core.js";

declare const results: LintResult[];
declare const context: FormatterContext;
`;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lib/cli-engine type annotations", () => {
	describe("the allowlist", () => {
		/*
		 * `types.js` already checks that the allowlist and the pragmas agree in
		 * both directions. What it cannot check is that these particular files
		 * are converted at all — dropping one would simply shrink the
		 * allowlist, consistently.
		 */
		it("covers lint-result-cache.js and all four formatters", () => {
			const tsconfigPath = path.join(REPO_ROOT, "tsconfig.json");
			const tsconfig = ts.parseConfigFileTextToJson(
				tsconfigPath,
				fs.readFileSync(tsconfigPath, "utf8"),
			);

			assert.isUndefined(tsconfig.error);

			for (const file of ANNOTATED_FILES) {
				assert.include(
					tsconfig.config.files,
					file,
					`${file} must be in the tsconfig.json allowlist`,
				);
				assert.isTrue(
					fs
						.readFileSync(path.join(REPO_ROOT, file), "utf8")
						.startsWith("// @ts-check\n"),
					`${file} must carry a @ts-check pragma to actually be checked`,
				);
			}
		});

		/*
		 * Anti-rot guard. The directory is small and entirely converted right
		 * now; a new file added here without a pragma would otherwise leave the
		 * layer half-annotated with nothing to say so.
		 */
		it("leaves no file in lib/cli-engine unconverted", () => {
			const unconverted = jsFilesUnder(CLI_ENGINE_DIR)
				.map(file =>
					path.relative(REPO_ROOT, file).replaceAll(path.sep, "/"),
				)
				.filter(file => !ANNOTATED_FILES.includes(file));

			assert.deepStrictEqual(
				unconverted,
				[],
				"every file in lib/cli-engine is annotated; a new one must be annotated and added to ANNOTATED_FILES and the tsconfig.json allowlist too",
			);
		});
	});

	describe("the layer invariant", () => {
		/*
		 * This is what made lib/cli-engine annotatable at this point in the
		 * epic: it reaches only the leaf layer and the type vocabulary. A single
		 * `require("../linter/...")` would destroy that, and nothing else in the
		 * repo checks it.
		 */
		it("reaches only lib/shared and lib/types inside lib/", () => {
			const offenders = [];

			for (const filePath of jsFilesUnder(CLI_ENGINE_DIR)) {
				for (const specifier of importedSpecifiers(filePath)) {
					if (!specifier.startsWith(".")) {
						continue;
					}

					const resolved = path.resolve(
						path.dirname(filePath),
						specifier,
					);
					const relative = path.relative(REPO_ROOT, resolved);

					if (!relative.startsWith(`lib${path.sep}`)) {
						continue;
					}

					const allowed = [
						"lib/cli-engine",
						"lib/shared",
						"lib/types",
					];

					if (
						!allowed.some(prefix =>
							relative
								.replaceAll(path.sep, "/")
								.startsWith(`${prefix}/`),
						)
					) {
						offenders.push(
							`${path.relative(REPO_ROOT, filePath).replaceAll(path.sep, "/")} -> ${specifier}`,
						);
					}
				}
			}

			assert.deepStrictEqual(
				offenders,
				[],
				"lib/cli-engine may only reach lib/shared and lib/types inside lib/",
			);
		});
	});

	describe("the formatter contract", () => {
		/*
		 * The bead's sharpest acceptance criterion, and the one no structural
		 * probe can express. A formatter that inlined
		 * `(results: LintResult[], context: FormatterContext) => string` would
		 * pass every call probe below; only the declared NAME and FILE tell the
		 * two apart.
		 */
		for (const { name, specifier } of FORMATTERS) {
			it(`types ${name}.js against the named Formatter type`, () => {
				assert.deepStrictEqual(
					declaredTypeOf(
						`import formatter = require("${specifier}");

						const probe = formatter;
						void probe;`,
					),
					FORMATTER_CONTRACT,
					`${name}.js must reference Formatter from core.d.ts rather than inline the shape — formatters are loaded by name, so this annotation is the only statement of their contract`,
				);
			});
		}

		it("accepts the call loadFormatter makes, for every formatter", () => {
			const calls = FORMATTERS.map(
				({ name, specifier }) =>
					`import ${name.replaceAll("-", "_")} = require("${specifier}");
					const out_${name.replaceAll("-", "_")}: string | Promise<string> = ${name.replaceAll("-", "_")}(results, context);
					void out_${name.replaceAll("-", "_")};`,
			).join("\n");

			expectClean(
				"probe-formatters-call.ts",
				`${FORMATTER_PREAMBLE}\n${calls}`,
			);
		});

		it("rejects results that are not lint results", () => {
			expectError(
				"probe-formatter-bad-results.ts",
				`${FORMATTER_PREAMBLE}
				import stylish = require("./cli-engine/formatters/stylish.js");

				stylish([{ filePath: "/tmp/a.js" }], context);`,
				2740,
			);
		});

		it("rejects a context that is not a formatter context", () => {
			expectError(
				"probe-formatter-bad-context.ts",
				`${FORMATTER_PREAMBLE}
				import html = require("./cli-engine/formatters/html.js");

				html(results, { cwd: 1 });`,
				2322,
			);
		});

		/*
		 * The html reporter is the only formatter that reads rule metadata, and
		 * `rulesMeta` is the member most likely to decay: it is a `Record`, and
		 * a `Record<string, any>` would swallow this.
		 */
		it("keeps html.js reading rulesMeta as rule metadata", () => {
			expectError(
				"probe-formatter-rules-meta.ts",
				`${FORMATTER_PREAMBLE}
				import html = require("./cli-engine/formatters/html.js");

				html(results, {
					cwd: "/tmp",
					rulesMeta: { "no-undef": { docs: { url: 42 } } },
				});`,
				2322,
			);
		});
	});

	describe("lint-result-cache.js", () => {
		it("compiles the full round trip against LintResult", () => {
			expectClean(
				"probe-cache.ts",
				`${CACHE_PREAMBLE}
				const result: LintResult = ${LINT_RESULT_LITERAL};

				cache.setCachedLintResults("/tmp/a.js", config, result);
				const rebuilt: LintResult | null = cache.getCachedLintResults("/tmp/a.js", config);
				cache.reconcile();

				void rebuilt;`,
			);
		});

		/*
		 * The rebuilt form is what callers consume, so it must be `LintResult`
		 * itself — not the cached shape, and not a structural look-alike.
		 */
		it("returns the shared LintResult from getCachedLintResults", () => {
			assert.deepStrictEqual(
				declaredTypeOf(
					`${CACHE_PREAMBLE}
					const probe = cache.getCachedLintResults("/tmp/a.js", config)!;
					void probe;`,
				),
				{ name: "LintResult", file: "lib/types/core.d.ts" },
			);
		});

		/*
		 * The stored form is deliberately NOT `LintResult`: `source` is written
		 * back as `null` rather than dropped, and that `null` is the signal to
		 * reread the file from disk. Collapsing the two would make the signal
		 * unrepresentable — so this asserts they stay distinguishable.
		 */
		it("keeps the stored form distinct from the rebuilt one", () => {
			expectClean(
				"probe-cache-stored.ts",
				`${CACHE_PREAMBLE}
				const stored = cache.getValidCachedLintResults("/tmp/a.js", config)!;
				const source: string | null | undefined = stored.source;
				const filePath: string = stored.filePath;

				void source;
				void filePath;`,
			);
		});

		it("rejects using a stored result where a rebuilt one is required", () => {
			expectError(
				"probe-cache-stored-as-lint-result.ts",
				`${CACHE_PREAMBLE}
				const stored: LintResult = cache.getValidCachedLintResults("/tmp/a.js", config)!;

				void stored;`,
				2322,
			);
		});

		it("rejects a config that is not a Config", () => {
			expectError(
				"probe-cache-bad-config.ts",
				`${CACHE_PREAMBLE}
				cache.getCachedLintResults("/tmp/a.js", "not a config");`,
				2345,
			);
		});

		it("rejects a lint result missing the counts it must carry", () => {
			expectError(
				"probe-cache-bad-result.ts",
				`${CACHE_PREAMBLE}
				cache.setCachedLintResults("/tmp/a.js", config, { filePath: "/tmp/a.js" });`,
				2345,
			);
		});
	});

	describe("hash.js", () => {
		/*
		 * `hash.js` shipped in PR #1 against a hand-written `imurmurhash`
		 * ambient that `y6r.17` replaced with `@types/imurmurhash`. The swap
		 * must leave it typed, and "the gate is green" cannot say so: an
		 * unresolved bare specifier is an implicit `any` that compiles clean
		 * forever.
		 */
		it("still returns a string after the @types/imurmurhash swap", () => {
			expectClean(
				"probe-hash.ts",
				`import hash = require("./cli-engine/hash.js");

				const digest: string = hash("some text");

				void digest;`,
			);
		});

		it("rejects treating a hash as anything but a string", () => {
			expectError(
				"probe-hash-bad.ts",
				`import hash = require("./cli-engine/hash.js");

				const digest: number = hash("some text");

				void digest;`,
				2322,
			);
		});
	});
});

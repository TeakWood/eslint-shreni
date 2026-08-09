/**
 * @fileoverview Guards the annotation of `lib/linter/code-path-analysis/`,
 * excluding `code-path-state.js` (annotated by a later bead).
 *
 * These five files ARE compiled by the shipped gate — they sit in the
 * `tsconfig.json` allowlist — so it is tempting to conclude that `tsc` already
 * validates them. It does not validate the thing that matters. An undocumented
 * parameter in a `.js` file is an implicit `any`, and `any` type-checks clean
 * forever, so "the gate is green" and "the module is typed" stay different
 * claims. Only the second one is worth having, and only these probes assert it.
 *
 * The probes are two-sided for the same reason: a signature that had decayed to
 * `any` would accept the positive probe AND the negative one, so every positive
 * is paired with a rejection that names a specific TypeScript error code.
 *
 * Two claims here cannot be made any other way:
 *
 * 1. The hidden `internal` slots. `code-path-segment.js` and `code-path.js`
 *    install them with `Object.defineProperty(this, "internal", ...)` so they
 *    are non-enumerable, and TypeScript does not read that call as a property
 *    declaration — there is no assignment for inference to work from either.
 *    Both classes therefore declare the slot explicitly. If either declaration
 *    is dropped, `pnpm lint:types` goes red, but if either is loosened to `any`
 *    the gate stays green and only the negative probes below notice.
 *
 * 2. The subtree's require invariant. `lib/languages/js/source-code/source-code.js`
 *    reaches DOWN into this linter subtree, which is only safe because the
 *    subtree depends on nothing but `lib/shared`. Nothing else in the repo
 *    checks that, and a single innocuous `require("../../rules/utils/...")`
 *    would destroy it.
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
const SUBTREE_DIR = path.join(REPO_ROOT, "lib/linter/code-path-analysis");

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so the relative specifiers resolve exactly as they do for a real
 * source file.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/**
 * The hand-authored vocabulary. Nothing pulls a `.d.ts` into a program
 * implicitly; the shipped gate names it in the `tsconfig.json` allowlist, so a
 * probe program has to name it as a root the same way.
 */
const CORE_DTS = probePath(REPO_ROOT, "lib/types/core.d.ts");

/**
 * The five files this bead annotated. `id-generator.js` is deliberately absent:
 * it shipped annotated earlier and is not this bead's work.
 */
const ANNOTATED_FILES = [
	"lib/linter/code-path-analysis/code-path-analyzer.js",
	"lib/linter/code-path-analysis/code-path-segment.js",
	"lib/linter/code-path-analysis/code-path.js",
	"lib/linter/code-path-analysis/debug-helpers.js",
	"lib/linter/code-path-analysis/fork-context.js",
];

/**
 * The one file in this directory the bead deliberately left alone.
 *
 * The suite asserts it is still unannotated — see the note at that test. This
 * is the "test that knows how it will die" pattern the rest of
 * `tests/lib/types/` uses: the day `code-path-state.js` is converted, this
 * suite fails with a message saying so instead of silently going stale.
 */
const DEFERRED_FILE = "lib/linter/code-path-analysis/code-path-state.js";

/**
 * Mirrors the resolution- and inference-relevant options of the shipped gate
 * (`tsconfig.base.json`).
 *
 * `checkJs` stays off for the same reason the gate keeps it off — and it
 * matters more here than elsewhere, because this subtree requires
 * `code-path-state.js`, which is not annotated yet. A probe must not be able to
 * fail because of an unconverted file downstream.
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

	const roots = [CORE_DTS, ...contents.keys()];
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
 * Resolves where each member of a `const probe: ...` intersection was declared.
 *
 * Structural checks cannot tell "speaks the shared vocabulary" apart from
 * "happens to match its shape" — a hand-inlined object is assignable in both
 * directions, and `typeToString` prints the local alias name (`Node`) rather
 * than what it expands to. Walking the checker's intersection members and
 * reading the FILE each was declared in is what actually pins the claim.
 * @param {string} source The probe source. Must declare `const probe`.
 * @returns {{name: string, file: string}[]} One entry per intersection member,
 * with the file path relative to the repo root.
 */
function intersectionMembersOf(source) {
	const name = "probe-vocabulary.ts";
	const { program, diagnostics } = compile({ [name]: source });

	assert.strictEqual(
		diagnostics.length,
		0,
		`the probe must compile before its type can be read:\n${format(diagnostics)}`,
	);

	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(probePath(PROBE_DIR, name));
	let type = null;

	ts.forEachChild(sourceFile, function visit(node) {
		if (ts.isVariableDeclaration(node) && node.name.getText() === "probe") {
			type = checker.getTypeAtLocation(node.name);
		}
		ts.forEachChild(node, visit);
	});

	assert.isNotNull(type, "the probe must declare `const probe`");
	assert.isTrue(
		type.isIntersection(),
		"the node view is expected to be an intersection of the shared base with this module's interim widening",
	);

	return type.types.map(member => ({
		name: member.symbol.getName(),
		file: path
			.relative(
				REPO_ROOT,
				member.symbol.declarations[0].getSourceFile().fileName,
			)
			.replaceAll(path.sep, "/"),
	}));
}

/**
 * Reads every `require()` and dynamic `import()` specifier out of a source file.
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

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lib/linter/code-path-analysis type annotations", () => {
	describe("the subtree invariant", () => {
		/*
		 * `lib/languages/js/source-code/source-code.js` requires
		 * `code-path-analyzer.js` — a languages/ file reaching into a linter/
		 * subtree. That is only safe because this subtree depends on nothing
		 * but `lib/shared`, and nothing else in the repo checks it.
		 */
		it("requires nothing inside lib/ except lib/shared", () => {
			const offenders = [];
			const libDir = path.join(REPO_ROOT, "lib");
			const sharedDir = path.join(libDir, "shared");

			/*
			 * `lib/types/` is the hand-authored vocabulary every annotated
			 * file names; it holds no runtime code, so naming it is not a
			 * dependency. Everything else inside `lib/` is, including a JSDoc
			 * `import("...")` type reference — a type edge out of this subtree
			 * is worth catching too.
			 */
			const typesDir = path.join(libDir, "types");

			for (const entry of fs.readdirSync(SUBTREE_DIR)) {
				if (!entry.endsWith(".js")) {
					continue;
				}

				const filePath = path.join(SUBTREE_DIR, entry);

				for (const specifier of importedSpecifiers(filePath)) {
					if (!specifier.startsWith(".")) {
						continue;
					}

					const resolved = path.resolve(SUBTREE_DIR, specifier);

					if (!resolved.startsWith(`${libDir}${path.sep}`)) {
						continue;
					}

					const insideSubtree = resolved.startsWith(
						`${SUBTREE_DIR}${path.sep}`,
					);
					const insideShared = resolved.startsWith(
						`${sharedDir}${path.sep}`,
					);
					const insideTypes = resolved.startsWith(
						`${typesDir}${path.sep}`,
					);

					if (!insideSubtree && !insideShared && !insideTypes) {
						offenders.push(
							`lib/linter/code-path-analysis/${entry} -> ${specifier}`,
						);
					}
				}
			}

			assert.deepStrictEqual(
				offenders,
				[],
				"code-path-analysis must depend on nothing inside lib/ but lib/shared — that is what makes it safe for lib/languages/ to reach down into it",
			);
		});
	});

	describe("the allowlist", () => {
		/*
		 * `types.js` already checks that the allowlist and the pragmas agree in
		 * both directions. What it cannot check is that these five particular
		 * files are converted at all — dropping one would simply shrink the
		 * allowlist, consistently.
		 */
		it("covers all five files, each with a pragma", () => {
			const tsconfigPath = path.join(REPO_ROOT, "tsconfig.json");
			const tsconfig = ts.parseConfigFileTextToJson(
				tsconfigPath,
				fs.readFileSync(tsconfigPath, "utf8"),
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

		/*
		 * This suite compiles with `checkJs: false` precisely because
		 * `code-path-state.js` is not converted yet, and the ESCAPE HATCH in
		 * `code-path-analyzer.js#preprocess` widens `pushForkContext` for the
		 * same reason. Both become dead weight the moment it lands, so fail
		 * loudly then rather than leaving two stale workarounds behind.
		 */
		it("still leaves code-path-state.js to its own bead", () => {
			assert.isFalse(
				fs
					.readFileSync(path.join(REPO_ROOT, DEFERRED_FILE), "utf8")
					.startsWith("// @ts-check\n"),
				`${DEFERRED_FILE} is now annotated. Retire the pushForkContext widening in code-path-analyzer.js#preprocess, then delete this test.`,
			);
		});
	});

	describe("the hidden `internal` slots", () => {
		it("declares a segment's slot with real member types", () => {
			expectClean(
				"probe-segment-internal.ts",
				`import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const segment: CodePathSegment;

				const used: boolean = segment.internal.used;
				const looped: CodePathSegment[] = segment.internal.loopedPrevSegments;

				void used;
				void looped;`,
			);
		});

		it("rejects misreading a segment's slot", () => {
			expectError(
				"probe-segment-internal-bad.ts",
				`import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const segment: CodePathSegment;

				const used: number = segment.internal.used;

				void used;`,
				2322,
			);
		});

		/*
		 * `nodes` is written only while debug dumping is on, so it is declared
		 * optional and `debug-helpers.js` asserts it away in the one branch
		 * that can reach it. Declaring it required would let any reader treat
		 * it as always present.
		 */
		it("keeps the debug-only `nodes` member optional", () => {
			expectError(
				"probe-segment-nodes.ts",
				`import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const segment: CodePathSegment;

				const count: number = segment.internal.nodes.length;

				void count;`,
				18048,
			);
		});

		it("declares a code path's slot so getState returns the state", () => {
			expectClean(
				"probe-codepath-internal.ts",
				`import CodePath = require("./linter/code-path-analysis/code-path.js");
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const codePath: CodePath;

				const initial: CodePathSegment = CodePath.getState(codePath).initialSegment;
				const passthrough: CodePathSegment = codePath.initialSegment;

				void initial;
				void passthrough;`,
			);
		});

		it("rejects asking for the state of something that is not a code path", () => {
			expectError(
				"probe-codepath-internal-bad.ts",
				`import CodePath = require("./linter/code-path-analysis/code-path.js");

				CodePath.getState("not a code path");`,
				2345,
			);
		});
	});

	describe("code-path-analyzer.js", () => {
		/*
		 * The bead's "node.type dispatch uses the vocabulary" criterion. A
		 * structural check cannot distinguish this from a hand-rolled node
		 * shape that happens to match, so read the DECLARED type name: the
		 * intersection's left operand must be `ASTNode` from `core.d.ts`.
		 */
		it("takes its nodes from the shared vocabulary", () => {
			const members = intersectionMembersOf(
				`import CodePathAnalyzer = require("./linter/code-path-analysis/code-path-analyzer.js");

				declare const probe: Parameters<CodePathAnalyzer["enterNode"]>[0];

				void probe;`,
			);

			assert.deepStrictEqual(
				members.find(member => member.name === "ASTNode"),
				{ name: "ASTNode", file: "lib/types/core.d.ts" },
				"the node this module dispatches on must be the ASTNode from lib/types/core.d.ts, widened — not a shape of this module's own invention",
			);
		});

		it("carries the guarantees ASTNode makes, through the widening", () => {
			expectClean(
				"probe-analyzer-node.ts",
				`import CodePathAnalyzer = require("./linter/code-path-analysis/code-path-analyzer.js");
				import type { SourceLocation, SourceRange } from "./types/core.js";

				declare const node: Parameters<CodePathAnalyzer["enterNode"]>[0];
				declare const analyzer: CodePathAnalyzer;

				const type: string = node.type;
				const range: SourceRange = node.range;
				const loc: SourceLocation = node.loc;

				analyzer.enterNode(node);
				analyzer.leaveNode(node);

				void type;
				void range;
				void loc;`,
			);
		});

		it("types the wrapped event generator", () => {
			expectClean(
				"probe-analyzer.ts",
				`import CodePathAnalyzer = require("./linter/code-path-analysis/code-path-analyzer.js");
				import type { ASTNode } from "./types/core.js";

				void new CodePathAnalyzer({
					enterNode(entered: ASTNode) { void entered; },
					leaveNode(left: ASTNode) { void left; },
					emit(eventName, args) { void eventName; void args; },
				});`,
			);
		});

		it("rejects an event generator that is missing a method", () => {
			expectError(
				"probe-analyzer-bad-generator.ts",
				`import CodePathAnalyzer = require("./linter/code-path-analysis/code-path-analyzer.js");

				void new CodePathAnalyzer({
					enterNode() {},
					leaveNode() {},
				});`,
				2345,
			);
		});

		it("rejects entering something that is not a node", () => {
			expectError(
				"probe-analyzer-bad-node.ts",
				`import CodePathAnalyzer = require("./linter/code-path-analysis/code-path-analyzer.js");

				declare const analyzer: CodePathAnalyzer;

				analyzer.enterNode("Program");`,
				2345,
			);
		});
	});

	describe("code-path.js", () => {
		it("types both traverseSegments forms", () => {
			expectClean(
				"probe-traverse-segments.ts",
				`import CodePath = require("./linter/code-path-analysis/code-path.js");
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const codePath: CodePath;
				declare const first: CodePathSegment;

				codePath.traverseSegments((segment, controller) => {
					const id: string = segment.id;

					controller.skip();
					controller.break();

					void id;
				});

				codePath.traverseSegments({ first }, segment => {
					void segment.reachable;
				});`,
			);
		});

		it("rejects a traversal option that is not a segment", () => {
			expectError(
				"probe-traverse-segments-bad-option.ts",
				`import CodePath = require("./linter/code-path-analysis/code-path.js");

				declare const codePath: CodePath;

				codePath.traverseSegments({ first: "s1" }, () => {});`,
				2322,
			);
		});

		it("rejects a controller method the walk does not have", () => {
			expectError(
				"probe-traverse-segments-bad-controller.ts",
				`import CodePath = require("./linter/code-path-analysis/code-path.js");

				declare const codePath: CodePath;

				codePath.traverseSegments((segment, controller) => {
					void segment;
					controller.stop();
				});`,
				2339,
			);
		});
	});

	describe("fork-context.js", () => {
		it("types the factories as producing segments", () => {
			expectClean(
				"probe-fork-context.ts",
				`import ForkContext = require("./linter/code-path-analysis/fork-context.js");
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");
				import IdGenerator = require("./linter/code-path-analysis/id-generator.js");

				const context = ForkContext.newRoot(new IdGenerator("s"));
				const next: CodePathSegment[] = context.makeNext(0, -1);
				const head: CodePathSegment[] = context.head;
				const empty: boolean = context.empty;

				context.add(next);

				void head;
				void empty;`,
			);
		});

		it("rejects a fork index that is not a number", () => {
			expectError(
				"probe-fork-context-bad-index.ts",
				`import ForkContext = require("./linter/code-path-analysis/fork-context.js");
				import IdGenerator = require("./linter/code-path-analysis/id-generator.js");

				ForkContext.newRoot(new IdGenerator("s")).makeNext("first", -1);`,
				2345,
			);
		});
	});

	describe("debug-helpers.js", () => {
		it("types the DOT builder and its Object.create(null) trace map", () => {
			expectClean(
				"probe-debug-helpers.ts",
				`import debug = require("./linter/code-path-analysis/debug-helpers.js");
				import CodePath = require("./linter/code-path-analysis/code-path.js");
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const codePath: CodePath;
				declare const traceMap: Record<string, CodePathSegment>;

				const dot: string = debug.makeDotArrows(codePath, traceMap);
				const enabled: boolean = debug.enabled;

				void dot;
				void enabled;`,
			);
		});

		it("rejects a trace map keyed on the wrong value type", () => {
			expectError(
				"probe-debug-helpers-bad-map.ts",
				`import debug = require("./linter/code-path-analysis/debug-helpers.js");
				import CodePath = require("./linter/code-path-analysis/code-path.js");

				declare const codePath: CodePath;

				void debug.makeDotArrows(codePath, { s1: "not a segment" });`,
				2322,
			);
		});
	});
});

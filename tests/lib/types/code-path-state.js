/**
 * @fileoverview Guards the annotation of
 * `lib/linter/code-path-analysis/code-path-state.js`.
 *
 * At 2,300 lines this is the largest file in `lib/`, and the hard part of it is
 * not the size — it is that `this.loopContext` is polymorphic. Five loop forms
 * share one stack slot, they store genuinely different things, and the code
 * already tells them apart informally by reading a `type` string. The
 * annotation makes that a real discriminated union, and this suite is what
 * asserts it IS one rather than five shapes flattened into an optional-
 * everything object that would type-check just as quietly.
 *
 * The file is in the `tsconfig.json` allowlist, so `pnpm lint:types` compiles
 * it — which is exactly why these probes are needed and not redundant. An
 * undocumented parameter in a `.js` file is an implicit `any`, and `any`
 * type-checks clean forever: "the gate is green" and "the module is typed" stay
 * different claims. Only the second is worth having.
 *
 * Every positive probe is therefore paired with a rejection naming a SPECIFIC
 * TypeScript error code. A union collapsed to `any`, or a discriminant widened
 * to `string`, accepts both halves of a one-sided test.
 *
 * Two things here can only be checked this way:
 *
 * 1. The discrimination itself. Narrowing on `context.type` must reach the
 *    variant's own members AND must reject the members of a sibling variant.
 *    A single wide shape passes the first and fails only the second.
 * 2. The `makeUnreachable()` arity defect in `popTryContext()`. That call is
 *    wrong upstream too and was deliberately left alone, because segment ids
 *    are observable to rules. The guard below fails if someone fixes it
 *    without retiring the note that explains why it was not fixed.
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
const STATE_FILE = "lib/linter/code-path-analysis/code-path-state.js";
const ANALYZER_FILE = "lib/linter/code-path-analysis/code-path-analyzer.js";

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
 * Mirrors the resolution- and inference-relevant options of the shipped gate
 * (`tsconfig.base.json`). `checkJs` stays off for the same reason the gate
 * keeps it off: a probe must not be able to fail because of an unconverted file
 * somewhere downstream.
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
 * Prints the DECLARED type of `const probe` in a source, as the checker names it.
 *
 * Structural checks cannot tell "speaks the declared vocabulary" apart from
 * "happens to match its shape": an inlined object literal type is assignable in
 * both directions and passes every structural probe. Reading the NAME the
 * checker prints is the only way to pin which declaration is in use.
 * @param {string} source The probe source. Must declare `const probe`.
 * @returns {string} The type as `checker.typeToString` renders it.
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
	const sourceFile = program.getSourceFile(probePath(PROBE_DIR, name));
	let printed = null;

	ts.forEachChild(sourceFile, function visit(node) {
		if (ts.isVariableDeclaration(node) && node.name.getText() === "probe") {
			printed = checker.typeToString(
				checker.getTypeAtLocation(node.name),
			);
		}
		ts.forEachChild(node, visit);
	});

	assert.isNotNull(printed, "the probe must declare `const probe`");

	return printed;
}

/**
 * Reads a source file from the repo.
 * @param {string} relativePath Repo-relative path.
 * @returns {string} The file's contents.
 */
function read(relativePath) {
	return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/** A probe preamble importing the state class. Every probe below needs it. */
const IMPORT_STATE = `import CodePathState = require("./linter/code-path-analysis/code-path-state.js");`;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lib/linter/code-path-analysis/code-path-state.js type annotations", () => {
	describe("the allowlist", () => {
		/*
		 * `types.js` already checks that the allowlist and the pragmas agree in
		 * both directions. What it cannot check is that THIS file is converted
		 * at all — dropping it would simply shrink the allowlist, consistently.
		 */
		it("names the file, and the file carries a pragma", () => {
			const tsconfigPath = path.join(REPO_ROOT, "tsconfig.json");
			const tsconfig = ts.parseConfigFileTextToJson(
				tsconfigPath,
				fs.readFileSync(tsconfigPath, "utf8"),
			);

			assert.isUndefined(tsconfig.error);
			assert.include(tsconfig.config.files, STATE_FILE);
			assert.isTrue(
				read(STATE_FILE).startsWith("// @ts-check\n"),
				`${STATE_FILE} must carry a @ts-check pragma to actually be checked`,
			);
		});

		/*
		 * `code-path-analyzer.js` carried an intersection that re-declared
		 * `pushForkContext` with an optional parameter, purely because this
		 * file was unannotated and its JSDoc made the parameter required. That
		 * is now stated at the source, so the workaround has to be gone — a
		 * stale widening is worse than none, because it reads as a real
		 * constraint.
		 */
		it("has let the analyzer retire its interim pushForkContext widening", () => {
			assert.notInclude(
				read(ANALYZER_FILE),
				"pushForkContext(forkLeavingPath?: boolean)",
				"code-path-state.js now declares the parameter optional itself, so the widening in code-path-analyzer.js#preprocess is dead weight",
			);
		});
	});

	describe("the loop context union", () => {
		/*
		 * The heart of the bead. `type` must be a literal per variant, and
		 * narrowing on it must reach that variant's own members.
		 */
		it("narrows to a variant's own members on `type`", () => {
			expectClean(
				"probe-loop-narrowing.ts",
				`${IMPORT_STATE}
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const state: CodePathState;

				const context = state.loopContext;

				if (context?.type === "DoWhileStatement") {
					// Only a do-while carries these two.
					const entry: CodePathSegment[] | null = context.entrySegments;
					const empty: boolean = context.continueForkContext.empty;

					void entry;
					void empty;
				} else if (context?.type === "ForStatement") {
					const update: CodePathSegment[] | null = context.updateSegments;

					void update;
				} else if (context?.type === "ForOfStatement") {
					const left: CodePathSegment[] | null = context.leftSegments;

					void left;
				}`,
			);
		});

		/*
		 * The other half. One flattened shape with everything optional would
		 * pass the probe above and this one too, which is what makes this the
		 * load-bearing assertion of the suite.
		 *
		 * TS2551 rather than TS2339: a `for-of` context has `leftSegments`,
		 * near enough to `entrySegments` that the compiler offers it as a
		 * suggestion, which is the "did you mean" flavour of the same error.
		 */
		it("rejects a do-while member read off a for-of context", () => {
			expectError(
				"probe-loop-narrowing-bad.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				const context = state.loopContext;

				if (context?.type === "ForOfStatement") {
					void context.entrySegments;
				}`,
				2551,
			);
		});

		it("rejects a for member read off a while context", () => {
			expectError(
				"probe-loop-narrowing-bad-for.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				const context = state.loopContext;

				if (context?.type === "WhileStatement") {
					void context.updateSegments;
				}`,
				2339,
			);
		});

		/*
		 * `continueDestSegments` is the one member declared on the shared base
		 * rather than per variant, because `makeContinue()` reads it before it
		 * knows which loop it has. It must stay readable on every member — a
		 * union where only four variants declare it fails here.
		 */
		it("keeps continueDestSegments readable on the whole union", () => {
			expectClean(
				"probe-continue-dest.ts",
				`${IMPORT_STATE}
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const state: CodePathState;

				const context = state.loopContext;

				if (context && context.continueDestSegments) {
					const dest: CodePathSegment[] = context.continueDestSegments;

					void dest;
				}`,
			);
		});

		it("takes the loop type from the declared vocabulary, not a bare string", () => {
			assert.strictEqual(
				declaredTypeOf(
					`${IMPORT_STATE}

					declare const probe: Parameters<CodePathState["pushLoopContext"]>[0];

					void probe;`,
				),
				"LoopContextType",
				"pushLoopContext must take the declared discriminant, not `string` — a bare string would let a typo through and would make the `default: throw` arm meaningless",
			);
		});

		it("rejects pushing a loop type that has no context class", () => {
			expectError(
				"probe-push-loop-bad.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				state.pushLoopContext("SwitchStatement", null);`,
				2345,
			);
		});
	});

	describe("the choice context", () => {
		it("takes the choice kind from the declared vocabulary", () => {
			assert.strictEqual(
				declaredTypeOf(
					`${IMPORT_STATE}

					declare const probe: Parameters<CodePathState["pushChoiceContext"]>[0];

					void probe;`,
				),
				"ChoiceKind",
			);
		});

		it("rejects a choice kind that is not one of the five", () => {
			expectError(
				"probe-push-choice-bad.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				state.pushChoiceContext("&", false);`,
				2345,
			);
		});
	});

	describe("the try context", () => {
		/*
		 * `position` drives every branch in `popTryContext()`,
		 * `makeCatchBlock()` and `makeFinallyBlock()`. Widening it to `string`
		 * would leave all of those comparing against arbitrary text.
		 */
		it("declares the traversal position as its three values", () => {
			expectClean(
				"probe-try-position.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				const context = state.tryContext;

				if (context) {
					const position: "try" | "catch" | "finally" = context.position;

					void position;
				}`,
			);
		});

		it("rejects a traversal position the state machine never reaches", () => {
			expectError(
				"probe-try-position-bad.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				declare const context: NonNullable<CodePathState["tryContext"]>;

				context.position = "done";`,
				2322,
			);
		});

		/*
		 * `returnedForkContext` is `null` exactly when the `try` has no
		 * `finally`, and the file leans on that in three places. Declaring it
		 * non-null would make all three reads look safe when they are only
		 * safe because of a `hasFinalizer` test.
		 */
		it("keeps the returned fork context nullable", () => {
			expectError(
				"probe-try-returned.ts",
				`${IMPORT_STATE}

				declare const context: NonNullable<CodePathState["tryContext"]>;

				void context.returnedForkContext.empty;`,
				18047,
			);
		});
	});

	describe("the context stacks", () => {
		/*
		 * Every stack pointer is nullable, and that is deliberate: four helpers
		 * in the file walk these chains and test for the end of one. Declaring
		 * them non-null would silence those reads and make the loop
		 * termination read as dead code.
		 *
		 * One `it` per field rather than a loop inside one: each of these
		 * builds a whole `tsc` program, and the repo's gate runs mocha under
		 * c8 with a 10s per-test timeout, which five compilations in a single
		 * test would blow.
		 */
		for (const [field, type] of [
			["choiceContext", "ChoiceContext | null"],
			["switchContext", "SwitchContext | null"],
			["tryContext", "TryContext | null"],
			["breakContext", "BreakContext | null"],
			["chainContext", "ChainContext | null"],
		]) {
			it(`declares ${field} as nullable`, () => {
				assert.strictEqual(
					declaredTypeOf(
						`${IMPORT_STATE}

						declare const probe: CodePathState["${field}"];

						void probe;`,
					),
					type,
					`${field} must stay nullable — the stack walks in this file test for the end of the chain`,
				);
			});
		}

		/*
		 * The checker prints the alias rather than expanding it, which is the
		 * stronger result: it pins that the field is declared as the shared
		 * `LoopContext` union and not as a hand-inlined shape that happens to
		 * match. What that union CONTAINS is what the narrowing probes above
		 * establish.
		 */
		it("declares the loop stack as the shared LoopContext union", () => {
			assert.strictEqual(
				declaredTypeOf(
					`${IMPORT_STATE}

					declare const probe: CodePathState["loopContext"];

					void probe;`,
				),
				"LoopContext | null",
			);
		});
	});

	describe("the final segment sinks", () => {
		/*
		 * `returnedForkContext` and `thrownForkContext` are arrays handed
		 * straight to rules through `CodePath#returnedSegments` and
		 * `#thrownSegments`, and they also have to answer `add()` because
		 * `getReturnContext()`/`getThrowContext()` may return a real
		 * `ForkContext` instead. Both halves have to hold.
		 */
		it("types them as segment arrays that also take segments", () => {
			expectClean(
				"probe-sinks.ts",
				`${IMPORT_STATE}
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");

				declare const state: CodePathState;
				declare const segments: CodePathSegment[];

				const returned: CodePathSegment[] = state.returnedForkContext;
				const thrown: CodePathSegment[] = state.thrownForkContext;
				const first: CodePathSegment = state.finalSegments[0];

				state.returnedForkContext.add(segments);
				state.thrownForkContext.add(segments);

				void returned;
				void thrown;
				void first;`,
			);
		});

		it("rejects adding something that is not a segment array", () => {
			expectError(
				"probe-sinks-bad.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				state.thrownForkContext.add("s1");`,
				2345,
			);
		});
	});

	describe("the traversal entry points", () => {
		it("types the constant-test hooks and the label arguments", () => {
			expectClean(
				"probe-entry-points.ts",
				`${IMPORT_STATE}
				import ForkContext = require("./linter/code-path-analysis/fork-context.js");
				import CodePathSegment = require("./linter/code-path-analysis/code-path-segment.js");
				import IdGenerator = require("./linter/code-path-analysis/id-generator.js");

				const state = new CodePathState(new IdGenerator("s"), (from, to) => {
					const ids: string[] = [from.id, to.id];

					void ids;
				});

				state.makeWhileTest(true);
				state.makeDoWhileTest(void 0);
				state.makeForTest(false);

				state.makeBreak(null);
				state.makeContinue("outer");
				state.pushSwitchContext(true, null);

				// The one optional parameter; the analyzer omits it too.
				const pushed: ForkContext = state.pushForkContext();
				const head: CodePathSegment[] = state.headSegments;

				void pushed;
				void head;`,
			);
		});

		it("rejects a constant test value that is not boolean", () => {
			expectError(
				"probe-while-test-bad.ts",
				`${IMPORT_STATE}

				declare const state: CodePathState;

				state.makeWhileTest("true");`,
				2345,
			);
		});

		it("rejects a looped callback that does not take segments", () => {
			expectError(
				"probe-looped-callback-bad.ts",
				`${IMPORT_STATE}
				import IdGenerator = require("./linter/code-path-analysis/id-generator.js");

				void new CodePathState(new IdGenerator("s"), (from: string) => {
					void from;
				});`,
				2345,
			);
		});
	});

	describe("the escape hatches", () => {
		/*
		 * The bead requires every escape hatch to carry an inline reason, and
		 * "there is at least one ESCAPE HATCH comment somewhere" does not
		 * check that: a cast added later, sitting undocumented among the
		 * documented ones, would pass. So this locates every JSDoc cast
		 * expression in the file and requires a marker above it.
		 *
		 * The window is generous because one comment legitimately covers a
		 * short run of casts — the two segment sinks in the constructor, the
		 * three reads in `makeFirstThrowablePathInTryOrCatchBlock()`. It is
		 * not so generous that an undocumented cast in a different method
		 * borrows the previous method's reason.
		 */
		it("puts a marked reason above every cast in the file", () => {
			const lines = read(STATE_FILE).split("\n");
			const isCast = /\/\*\*\s*@type\s*\{.*\}\s*\*\/\s*\(/u;
			const markers = [];
			const undocumented = [];

			lines.forEach((line, index) => {
				if (line.includes("ESCAPE HATCH")) {
					markers.push(index);
				}
				if (isCast.test(line)) {
					const nearest = markers.at(-1);

					if (nearest === void 0 || index - nearest > 30) {
						undocumented.push(`${index + 1}: ${line.trim()}`);
					}
				}
			});

			assert.isAbove(
				markers.length,
				0,
				"the annotation does use assertions; they must be marked",
			);
			assert.deepStrictEqual(
				undocumented,
				[],
				"every type assertion in this file must sit under a comment marked ESCAPE HATCH saying why it holds",
			);
		});

		/*
		 * The blunter instruments. Each suppresses a diagnostic without saying
		 * anything about why suppressing it was safe, and `@ts-nocheck` would
		 * silently undo the whole conversion while leaving the pragma and the
		 * allowlist entry in place.
		 */
		it("uses no blanket suppression", () => {
			const source = read(STATE_FILE);

			for (const suppression of [
				"@ts-ignore",
				"@ts-expect-error",
				"@ts-nocheck",
			]) {
				assert.notInclude(
					source,
					suppression,
					`${suppression} suppresses a diagnostic without stating why it is safe; use a documented assertion instead`,
				);
			}
		});

		/*
		 * The two reasons a reader is most likely to try to "simplify" away.
		 * Both guard tests the runtime depends on: dropping either turns a
		 * documented assertion into a wrong one.
		 */
		it("keeps the notes that name their load-bearing runtime guard", () => {
			const source = read(STATE_FILE);

			/*
			 * Matched as single-line fragments: Prettier reflows these comment
			 * blocks, so a phrase that spans a wrapped line breaks the moment
			 * the surrounding text changes length.
			 */
			assert.include(
				source,
				"test above is what makes this safe: do not remove it.",
			);
			assert.include(
				source,
				"The `context === this` test is what makes this safe: do not remove",
			);
		});
	});

	describe("the makeUnreachable() arity defect", () => {
		/*
		 * A test that knows how it will die. `popTryContext()` calls
		 * `makeUnreachable()` with no arguments and discards the result, so the
		 * statement does nothing but consume segment ids — and segment ids are
		 * observable to rules through `CodePathSegment#id`, which is why this
		 * annotation bead described the defect instead of fixing it. Upstream
		 * ESLint carries the same line.
		 *
		 * If a later change fixes the call, this fails and says so, rather than
		 * leaving a long note behind explaining a problem that no longer
		 * exists.
		 */
		it("still describes the call it deliberately did not fix", () => {
			const source = read(STATE_FILE);

			assert.include(
				source,
				"forkContext.makeUnreachable();",
				"if the zero-argument call has been corrected, delete the LATENT DEFECT note and the receiver widening above it, and delete this test",
			);
			assert.include(
				source,
				"NOT FIXED HERE: segment ids are observable to rules",
				"the widening must keep saying why the call was left alone; without it the cast reads as an accident",
			);
		});
	});
});

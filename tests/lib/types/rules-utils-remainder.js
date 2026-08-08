/**
 * @fileoverview Guards the annotation of the rest of `lib/rules/utils/` —
 * `char-source.js`, `fix-tracker.js` and the five `unicode/` helpers.
 *
 * All seven ARE compiled by the shipped gate, so the obvious conclusion is that
 * `npm run lint:types` already validates them. It does not. An undocumented
 * parameter in a `.js` file is an implicit `any`, and `any` type-checks clean
 * forever — "the gate is green" and "the module is typed" are different claims,
 * and only the probes below assert the second. Every positive probe is
 * therefore paired with a negative one that must be REJECTED with a SPECIFIC
 * error code, because a signature that had decayed to `any` would accept both.
 *
 * Three things here outlive the bead:
 *
 * 1. `no exported signature is any`, which walks each module's exports through
 *    the compiler's own type checker rather than a hand-written list, so decay
 *    fails the suite wherever it happens.
 * 2. `speaks core.d.ts, not an inlined shape`, which reads the declared
 *    parameter types of `FixTracker` off the checker and requires them to be
 *    the named `RuleFixer` / `SourceCode` / `RuleFix` from the vocabulary. A
 *    structurally-equivalent inline shape would satisfy every other probe here
 *    and fail this one, which is exactly the acceptance criterion.
 * 3. `one node vocabulary`, which fails the day `ast-utils.js` retires its
 *    interim `Node` view — `fix-tracker.js` derives its own node type from
 *    that one rather than restating it, and this is what makes the coupling
 *    visible instead of silent.
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
const TSCONFIG_PATH = path.join(REPO_ROOT, "tsconfig.json");
const CHAR_SOURCE = "lib/rules/utils/char-source.js";
const FIX_TRACKER = "lib/rules/utils/fix-tracker.js";
const AST_UTILS = "lib/rules/utils/ast-utils.js";

/**
 * The seven files this bead annotated. `keywords.js`, `code-path-utils.js`,
 * `regular-expressions.js` and `lazy-loading-rule-map.js` shipped earlier and
 * are deliberately absent — `ast-utils.js` has its own suite.
 */
const ANNOTATED_FILES = [
	CHAR_SOURCE,
	FIX_TRACKER,
	"lib/rules/utils/unicode/index.js",
	"lib/rules/utils/unicode/is-combining-character.js",
	"lib/rules/utils/unicode/is-emoji-modifier.js",
	"lib/rules/utils/unicode/is-regional-indicator-symbol.js",
	"lib/rules/utils/unicode/is-surrogate-pair.js",
];

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so that both bare specifiers and the relative `./rules/...` imports
 * resolve exactly as they do for a real source file.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/**
 * The hand-authored ambient declarations. `fix-tracker.js` requires
 * `ast-utils.js`, which cannot be typed without the `esutils` block, and
 * nothing pulls an ambient block into a program implicitly — the shipped gate
 * gets it from the `tsconfig.json` allowlist, so a probe program has to name it
 * as a root the same way.
 */
const VENDOR_DTS = probePath(REPO_ROOT, "lib/types/vendor.d.ts");

/**
 * Mirrors the resolution- and inference-relevant options of the shipped gate
 * (`tsconfig.base.json`).
 *
 * `checkJs` stays off for the same reason the gate keeps it off: a probe must
 * not be able to fail because of an unconverted file somewhere downstream.
 * JSDoc types are read regardless — that flag controls error reporting, not
 * inference, which is exactly what makes these probes meaningful.
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
 * The shared probe header.
 *
 * Every type a probe needs is DERIVED from the modules under test rather than
 * spelled out. That is deliberate: spelling them out would let a probe keep
 * passing after the signature it is meant to guard had drifted, because the
 * probe would be asserting against the test's idea of the type rather than the
 * module's. The only exception is `ASTNode`, which is named from `core.d.ts`
 * because the point of one probe is that it is NOT what `fix-tracker.js` takes.
 */
const PREAMBLE = `
import FixTracker = require("./rules/utils/fix-tracker.js");
import * as charSource from "./rules/utils/char-source.js";
import * as unicode from "./rules/utils/unicode/index.js";
import * as astUtils from "./rules/utils/ast-utils.js";
import type { ASTNode, RuleFix, RuleFixer, SourceCode, SourceRange } from "./types/core.js";

type NodeArg = NonNullable<Parameters<typeof astUtils.getUpperFunction>[0]>;
type NodeOrTokenArg = Parameters<FixTracker["remove"]>[0];

declare const fixer: RuleFixer;
declare const sourceCode: SourceCode;
declare const node: NodeArg;
declare const nodeOrToken: NodeOrTokenArg;
declare const astNode: ASTNode;
declare const range: SourceRange;
declare const tracker: FixTracker;
`;

/**
 * Compiles a probe and asserts it produces no diagnostics.
 * @param {string} name The probe file name.
 * @param {string} source The probe source, appended to `PREAMBLE`.
 * @returns {void}
 */
function expectClean(name, source) {
	const { diagnostics } = compile({ [name]: PREAMBLE + source });

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
 * @param {string} source The probe source, appended to `PREAMBLE`.
 * @param {number} code The expected TypeScript error code.
 * @returns {void}
 */
function expectError(name, source, code) {
	const { diagnostics } = compile({ [name]: PREAMBLE + source });

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
 * The exported surface of a module, as the compiler sees it.
 *
 * Read off a probe that imports the module rather than by `require`ing it, so
 * what comes back is the DECLARED surface — the thing dependents inherit — and
 * not the runtime one.
 * @param {string} specifier The module specifier, relative to `lib/`.
 * @returns {{checker: ts.TypeChecker, exports: ts.Symbol[], location: ts.Node}} The checker, the export symbols and a node to resolve them at.
 */
function moduleExports(specifier) {
	const name = "module-surface.ts";
	const { program } = compile({
		[name]: `import * as surfaceModule from "${specifier}";\nexport const surface = surfaceModule;\n`,
	});
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(probePath(PROBE_DIR, name));

	assert.isDefined(sourceFile, "the probe was not pulled into the program");

	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

	assert.isDefined(moduleSymbol, "the probe has no module symbol");

	const [surface] = checker.getExportsOfModule(moduleSymbol);

	assert.strictEqual(surface.getName(), "surface");

	return {
		checker,
		exports: checker
			.getTypeOfSymbolAtLocation(surface, sourceFile)
			.getProperties(),
		location: sourceFile,
	};
}

/**
 * Whether a type is `any`, or an array of `any`.
 *
 * A bare `any` is the obvious decay, but `any[]` in a parameter or return
 * position hides just as much, so it counts too.
 * @param {ts.TypeChecker} checker The program's type checker.
 * @param {ts.Type} type The type to inspect.
 * @returns {boolean} `true` if the type is `any` or an array of `any`.
 */
function isAnyish(checker, type) {
	if (type.flags & ts.TypeFlags.Any) {
		return true;
	}

	if (checker.isArrayType(type)) {
		const [element] = checker.getTypeArguments(
			/** @type {ts.TypeReference} */ (type),
		);

		return Boolean(element && element.flags & ts.TypeFlags.Any);
	}

	return false;
}

/**
 * Collects every `any` reachable on a module's exported signatures.
 * @param {string} specifier The module specifier, relative to `lib/`.
 * @returns {string[]} One entry per decayed parameter or return type.
 */
function anyOffenders(specifier) {
	const { checker, exports, location } = moduleExports(specifier);
	const offenders = [];

	for (const symbol of exports) {
		const type = checker.getTypeOfSymbolAtLocation(symbol, location);

		if (isAnyish(checker, type)) {
			offenders.push(`${symbol.getName()} is any`);
			continue;
		}

		for (const signature of type.getCallSignatures()) {
			for (const parameter of signature.getParameters()) {
				if (
					isAnyish(
						checker,
						checker.getTypeOfSymbolAtLocation(parameter, location),
					)
				) {
					offenders.push(
						`${symbol.getName()}(${parameter.getName()}) is any`,
					);
				}
			}

			if (isAnyish(checker, signature.getReturnType())) {
				offenders.push(`${symbol.getName()}() returns any`);
			}
		}
	}

	return offenders;
}

/**
 * The declared type of one `FixTracker` member, as the compiler prints it.
 *
 * Printing rather than structurally comparing is the point: a hand-inlined
 * `{ replaceTextRange(...): ... }` would be structurally identical to
 * `RuleFixer` and satisfy every other probe in this file. Only the printed
 * name distinguishes "uses the vocabulary" from "happens to match it".
 * @param {string} expression A probe expression to read the type of.
 * @returns {string} The type as `checker.typeToString` renders it.
 */
function declaredTypeOf(expression) {
	const name = "declared-type.ts";
	const { program } = compile({
		[name]: `${PREAMBLE}\nexport const probed = ${expression};\n`,
	});
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(probePath(PROBE_DIR, name));

	assert.isDefined(sourceFile, "the probe was not pulled into the program");

	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	const probed = checker
		.getExportsOfModule(moduleSymbol)
		.find(symbol => symbol.getName() === "probed");

	assert.isDefined(probed, "the probe expression produced no export");

	return checker.typeToString(
		checker.getTypeOfSymbolAtLocation(probed, sourceFile),
	);
}

/**
 * Reads a repo file.
 * @param {string} relativePath The path relative to the repository root.
 * @returns {string} The file contents.
 */
function readSource(relativePath) {
	return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lib/rules/utils remainder type annotations", () => {
	describe("the allowlist", () => {
		/*
		 * `types.js` already checks that the allowlist and the pragmas agree in
		 * both directions. What it cannot check is that these seven particular
		 * files are converted at all — dropping one would simply shrink the
		 * allowlist, consistently.
		 */
		it("covers all seven files", () => {
			const tsconfig = ts.parseConfigFileTextToJson(
				TSCONFIG_PATH,
				readSource("tsconfig.json"),
			);

			assert.isUndefined(tsconfig.error);

			for (const file of ANNOTATED_FILES) {
				assert.include(
					tsconfig.config.files,
					file,
					`${file} is annotated but nothing in the gate compiles it`,
				);
				assert.isTrue(
					readSource(file).startsWith("// @ts-check\n"),
					`${file} must carry a @ts-check pragma to actually be checked`,
				);
			}
		});

		/*
		 * A file can sit in the allowlist, carry the pragma, and still be
		 * unchecked if it silences the checker. None of these seven needs to.
		 */
		it("uses no blanket suppression", () => {
			for (const file of ANNOTATED_FILES) {
				const source = readSource(file);

				for (const directive of [
					"@ts-nocheck",
					"@ts-ignore",
					"@ts-expect-error",
				]) {
					assert.notInclude(
						source,
						directive,
						`${file} suppresses the checker with ${directive}`,
					);
				}
			}
		});
	});

	describe("the exported surfaces", () => {
		it("has no `any` in char-source.js", () => {
			assert.deepStrictEqual(
				anyOffenders("./rules/utils/char-source.js"),
				[],
			);
		});

		it("has no `any` in unicode/index.js", () => {
			assert.deepStrictEqual(
				anyOffenders("./rules/utils/unicode/index.js"),
				[],
			);
		});

		it("re-exports exactly the four unicode helpers", () => {
			const { exports } = moduleExports("./rules/utils/unicode/index.js");

			assert.deepStrictEqual(
				exports.map(symbol => symbol.getName()).sort(),
				[
					"isCombiningCharacter",
					"isEmojiModifier",
					"isRegionalIndicatorSymbol",
					"isSurrogatePair",
				],
			);
		});
	});

	describe("the unicode helpers", () => {
		it("take character codes and return booleans", () => {
			expectClean(
				"unicode-ok.ts",
				`const combining: boolean = unicode.isCombiningCharacter(0x0301);
const emoji: boolean = unicode.isEmojiModifier(0x1f3fb);
const regional: boolean = unicode.isRegionalIndicatorSymbol(0x1f1e6);
const pair: boolean = unicode.isSurrogatePair(0xd800, 0xdc00);
void [combining, emoji, regional, pair];
`,
			);
		});

		it("reject a string where a character code belongs", () => {
			expectError(
				"unicode-string-arg.ts",
				`void unicode.isCombiningCharacter("\\u0301");\n`,
				2345,
			);
		});

		it("reject a missing surrogate-pair argument", () => {
			expectError(
				"unicode-arity.ts",
				`void unicode.isSurrogatePair(0xd800);\n`,
				2554,
			);
		});

		it("do not let a predicate result stand in for a string", () => {
			expectError(
				"unicode-return.ts",
				`const wrong: string = unicode.isEmojiModifier(0x1f3fb);\nvoid wrong;\n`,
				2322,
			);
		});
	});

	describe("char-source.js", () => {
		it("parses a string literal into located code units", () => {
			expectClean(
				"char-source-ok.ts",
				`const units = charSource.parseStringLiteral("'a\\\\n'");
const start: number = units[0].start;
const end: number = units[0].end;
const length: number = units[0].length;
const source: string = units[0].source;
void [start, end, length, source];
`,
			);
		});

		it("parses a template token into located code units", () => {
			expectClean(
				"char-source-template-ok.ts",
				`const units = charSource.parseTemplateToken("\`a\`");
const start: number = units[0].start;
void start;
`,
			);
		});

		/*
		 * The two parsers take the raw source text INCLUDING its delimiters. A
		 * decayed signature would happily accept the token node a caller has in
		 * hand instead.
		 */
		it("reject a non-string source", () => {
			expectError(
				"char-source-bad-arg.ts",
				`void charSource.parseStringLiteral(nodeOrToken);\n`,
				2345,
			);
		});

		it("keeps the code unit's source text a string", () => {
			expectError(
				"char-source-unit-source.ts",
				`const wrong: number = charSource.parseStringLiteral("''")[0].source;\nvoid wrong;\n`,
				2322,
			);
		});

		/*
		 * `end` and `length` are getters. If either lost its `@type` the
		 * emitted declaration would still have the member, so a positive probe
		 * alone would not notice.
		 */
		it("keeps the derived offsets numeric", () => {
			expectError(
				"char-source-unit-end.ts",
				`const wrong: string = charSource.parseStringLiteral("''")[0].end;\nvoid wrong;\n`,
				2322,
			);
		});
	});

	describe("fix-tracker.js", () => {
		it("constructs from a fixer and a source code", () => {
			expectClean(
				"fix-tracker-ok.ts",
				`const built = new FixTracker(fixer, sourceCode);\nvoid built;\n`,
			);
		});

		it("rejects a fixer that is not a RuleFixer", () => {
			expectError(
				"fix-tracker-bad-fixer.ts",
				`void new FixTracker({}, sourceCode);\n`,
				2345,
			);
		});

		it("returns the tracker from every retain method, for chaining", () => {
			expectClean(
				"fix-tracker-chain.ts",
				`const fix: RuleFix = new FixTracker(fixer, sourceCode)
	.retainEnclosingFunction(node)
	.retainSurroundingTokens(nodeOrToken)
	.retainRange(range)
	.replaceTextRange(range, "x");
void fix;
`,
			);
		});

		/*
		 * `SourceRange` is the tuple `[number, number]`. A decayed signature —
		 * or one that had settled for `number[]` — would take three.
		 */
		it("requires a two-element range", () => {
			expectError(
				"fix-tracker-range-arity.ts",
				`void tracker.retainRange([0, 1, 2]);\n`,
				2345,
			);
		});

		it("produces a fix, not a string", () => {
			expectError(
				"fix-tracker-fix-return.ts",
				`const wrong: string = tracker.remove(nodeOrToken);\nvoid wrong;\n`,
				2322,
			);
		});

		/*
		 * THE acceptance criterion for this file, and the one probe that a
		 * structurally-identical inlined shape would fail. Everything else here
		 * is structural and would pass either way.
		 */
		describe("speaks core.d.ts, not an inlined shape", () => {
			it("takes the vocabulary's RuleFixer", () => {
				assert.strictEqual(
					declaredTypeOf("new FixTracker(fixer, sourceCode).fixer"),
					"RuleFixer",
				);
			});

			it("takes the vocabulary's SourceCode", () => {
				assert.strictEqual(
					declaredTypeOf(
						"new FixTracker(fixer, sourceCode).sourceCode",
					),
					"SourceCode",
				);
			});

			it("returns the vocabulary's fix shape", () => {
				assert.strictEqual(
					declaredTypeOf('tracker.replaceTextRange(range, "x")'),
					"Fix",
				);
			});

			/*
			 * `retainedRange` starts as `null`. Left to inference it would be
			 * typed `null` outright and every assignment to it would be an
			 * error, so the annotation is load-bearing rather than decorative.
			 */
			it("keeps the retained range a nullable tuple", () => {
				assert.strictEqual(
					declaredTypeOf("tracker.retainedRange"),
					"SourceRange | null",
				);
			});
		});

		/*
		 * A test that knows how it will die. `fix-tracker.js` derives its node
		 * type from `ast-utils.js` rather than restating one, so that the two
		 * files cannot drift apart. When the closed node union lands and
		 * `ast-utils.js` retires its interim `Node` view, this fails and names
		 * the follow-up instead of leaving the derivation to rot.
		 */
		describe("one node vocabulary", () => {
			it("takes the node view ast-utils.js exports", () => {
				expectClean(
					"fix-tracker-node-ok.ts",
					`void tracker.retainEnclosingFunction(node);\n`,
				);
			});

			it("does not accept a bare ASTNode while that view is wider", () => {
				assert.isTrue(
					readSource(AST_UTILS).includes(
						"@typedef {ASTNode & NodeMembers} Node",
					),
					"ast-utils.js no longer widens ASTNode. Retire the derived `Node` typedef in fix-tracker.js and take `ASTNode` directly — then delete this test.",
				);

				expectError(
					"fix-tracker-node-bad.ts",
					`void tracker.retainEnclosingFunction(astNode);\n`,
					2345,
				);
			});
		});
	});

	describe("the documented escape hatches", () => {
		/*
		 * Three casts in `char-source.js` and one annotation in
		 * `fix-tracker.js` are the only places either file overrides the
		 * checker. The bead requires each to carry its reason inline; this
		 * asserts the reasons are still there, since a later edit that keeps
		 * the cast and drops the comment leaves the gate green.
		 *
		 * The count is checked as well as the wording, so a FOURTH cast added
		 * later cannot slip in undocumented behind three intact comments.
		 */
		it("explains every widening in char-source.js", () => {
			const source = readSource(CHAR_SOURCE);

			assert.lengthOf(
				source.match(/ESCAPE HATCH/gu) ?? [],
				3,
				"a widening was added or removed in char-source.js; give the new one an ESCAPE HATCH comment and update this count",
			);

			for (const reason of [
				"so it admits no index access",
				"`RegExpExecArray#groups` is typed `| undefined`",
				"`String#match` is typed `RegExpMatchArray | null`",
			]) {
				assert.include(
					source,
					reason,
					"each widening in char-source.js must keep the comment giving its reason",
				);
			}
		});

		it("explains the retainedRange annotation in fix-tracker.js", () => {
			assert.include(
				readSource(FIX_TRACKER),
				"would type it `null` and reject every later assignment",
				"the reason for annotating `retainedRange` must stay next to the annotation",
			);
		});

		/*
		 * The table exists to be prototype-less. The type widening at its read
		 * site is only safe because of that, so the runtime property is worth
		 * pinning next to the type one.
		 */
		it("keeps the escape-sequence table prototype-less", () => {
			assert.include(
				readSource(CHAR_SOURCE),
				"__proto__: null",
				"SIMPLE_ESCAPE_SEQUENCES must stay prototype-less; the widening at its read site assumes it",
			);
		});
	});
});

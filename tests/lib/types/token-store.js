/**
 * @fileoverview Guards the annotation of
 * `lib/languages/js/source-code/token-store/` — all thirteen files, `cursors.js`
 * included.
 *
 * These files ARE compiled by the shipped gate, so it is tempting to conclude
 * that `tsc` already validates them. It does not validate the thing that
 * matters. An undocumented parameter in a `.js` file is an implicit `any`, and
 * `any` type-checks clean forever — so "the gate is green" and "the module is
 * typed" stay different claims, and only these probes assert the second. That
 * gap is at its widest in `cursors.js`, whose factories return a cursor built
 * from an instance field: un-annotated they returned `any`, and every
 * assignability probe below would have passed while asserting nothing.
 *
 * Four claims here cannot be made any other way:
 *
 * 1. The OVERLOAD FAMILIES. Every public getter's result type is decided by its
 *    option argument: only the object form with `includeComments: true` can
 *    yield a `Comment`. Collapsing a family back to one signature over the
 *    widened `SkipOptions`/`CountOptions` union leaves `pnpm lint:types` at exit
 *    0 while silently forcing every caller to handle a `Comment` that cannot
 *    occur. Each family is therefore probed twice: the token-only form must be
 *    assignable to `Token`, and the comment-inclusive form must NOT be.
 *
 * 2. The symbol-keyed slots. All of `TokenStore`'s state lives in computed
 *    `Symbol()` keys, and `INDEX_MAP` is built with `Object.create(null)`, so
 *    without an explicit `@type` it would be `any` — and would take every index
 *    lookup in the file with it, invisibly. The slot types are read off the
 *    checker rather than asserted structurally.
 *
 * 3. The cursor factories. `createBaseCursor` picks its class from an instance
 *    field and `createCursor` then wraps the result under three independent
 *    flags, so the concrete class is one of six. The claim being guarded is
 *    that both are typed through the SHARED CURSOR INTERFACE — the type each
 *    returns is read off the checker and its DECLARING FILE asserted to be
 *    `cursor.js`, which neither `any` nor a hand-rolled look-alike can satisfy.
 *
 * 4. The layer invariant. This subtree is annotated at all only because it
 *    depends on nothing inside `lib/` but `lib/shared`; one innocuous
 *    `require("../../../rules/utils/...")` would destroy that, and nothing else
 *    in the repo checks it.
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
const SUBTREE = "lib/languages/js/source-code/token-store";
const SUBTREE_DIR = path.join(REPO_ROOT, SUBTREE);

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

/** Every file in the subtree. All thirteen are annotated. */
const ANNOTATED_FILES = [
	`${SUBTREE}/backward-token-comment-cursor.js`,
	`${SUBTREE}/backward-token-cursor.js`,
	`${SUBTREE}/cursor.js`,
	`${SUBTREE}/cursors.js`,
	`${SUBTREE}/decorative-cursor.js`,
	`${SUBTREE}/filter-cursor.js`,
	`${SUBTREE}/forward-token-comment-cursor.js`,
	`${SUBTREE}/forward-token-cursor.js`,
	`${SUBTREE}/index.js`,
	`${SUBTREE}/limit-cursor.js`,
	`${SUBTREE}/padded-token-cursor.js`,
	`${SUBTREE}/skip-cursor.js`,
	`${SUBTREE}/utils.js`,
];

/**
 * Mirrors the resolution- and inference-relevant options of the shipped gate
 * (`tsconfig.base.json`).
 *
 * `checkJs` stays off for the same reason the gate keeps it off: a probe must
 * not be able to fail because of an unconverted file somewhere downstream. The
 * probes below therefore read what these files DECLARE, which is what `checkJs`
 * does not affect.
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

/** The subtree path as a probe file sees it, relative to `lib/`. */
const FROM_LIB = SUBTREE.slice("lib/".length);

/** Every probe below opens with these two lines. */
const PREAMBLE = `import TokenStore = require("./${SUBTREE.slice("lib/".length)}/index.js");
	import type { ASTNode, Comment, CountOptions, SkipOptions, Token } from "./types/core.js";
	declare const store: TokenStore;
	declare const node: ASTNode;
	declare const other: ASTNode;
	void store; void node; void other;
	`;

/**
 * The extra declarations the cursor-factory probes need. Appended to
 * `PREAMBLE` by the probes that use it.
 */
const CURSORS_PREAMBLE = `import cursors = require("./${FROM_LIB}/cursors.js");
	import type { IndexMap } from "./${FROM_LIB}/utils.js";
	import type { TokenFilter } from "./types/core.js";
	declare const tokens: Token[];
	declare const comments: Comment[];
	declare const indexMap: IndexMap;
	declare const filter: TokenFilter;
	void cursors; void tokens; void comments; void indexMap; void filter;
	`;

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
 * @param {string} source The probe body, appended to `PREAMBLE`.
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
 * @param {string} source The probe body, appended to `PREAMBLE`.
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
 * Assignability alone cannot make the claim this is used for. A factory that
 * returned `any` would satisfy every "is it a cursor?" probe in this file, and
 * `typeToString` on its own prints whatever local alias is in scope — a
 * hand-rolled look-alike declared in `cursors.js` would print `Cursor` too.
 * Reading the DECLARING FILE off the type's symbol is what pins the value to
 * the shared interface in `cursor.js`.
 * @param {string} source The probe source. Must declare `const probe`.
 * @returns {{name: string, file: string}} The printed type name and the
 * repo-relative file its symbol was declared in.
 */
function declaredTypeOf(source) {
	const name = "probe-declared-type.ts";
	const { program, diagnostics } = compile({ [name]: PREAMBLE + source });

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

	assert.isDefined(
		type.symbol,
		`the probe's type is \`${checker.typeToString(type)}\`, which declares nothing — an \`any\` leaking out of the factory would look exactly like this`,
	);

	return {
		name: checker.typeToString(type),
		file: path
			.relative(
				REPO_ROOT,
				type.symbol.declarations[0].getSourceFile().fileName,
			)
			.replaceAll(path.sep, "/"),
	};
}

/**
 * Resolves where each member of a `type Probe = ...` union was declared.
 *
 * Structural checks cannot tell "speaks the shared vocabulary" apart from
 * "happens to match its shape" — a hand-inlined object is assignable in both
 * directions — and `typeToString` prints the local alias name rather than what
 * it expands to. Walking the checker's union members and reading the FILE each
 * was declared in is what actually pins the claim.
 * @param {string} source The probe source. Must declare `const probe`.
 * @returns {{name: string, file: string}[]} One entry per union member, with the
 * file path relative to the repo root, sorted by name.
 */
function unionMembersOf(source) {
	const name = "probe-vocabulary.ts";
	const { program, diagnostics } = compile({ [name]: PREAMBLE + source });

	assert.strictEqual(
		diagnostics.length,
		0,
		`the probe must compile before its type can be read:\n${format(diagnostics)}`,
	);

	const checker = program.getTypeChecker();
	const type = checker.getTypeAtLocation(
		probeDeclaration(program.getSourceFile(probePath(PROBE_DIR, name))),
	);

	assert.isTrue(
		type.isUnion(),
		"the accepted node type is expected to be a union of the shared vocabulary's node and token shapes",
	);

	return type.types
		.map(member => ({
			name: member.symbol.getName(),
			file: path
				.relative(
					REPO_ROOT,
					member.symbol.declarations[0].getSourceFile().fileName,
				)
				.replaceAll(path.sep, "/"),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads the declared type of every symbol-keyed property on `TokenStore`.
 *
 * The slots are `Symbol()`-keyed, so the checker names them after the module
 * const they were declared with (`__@TOKENS@…`). Reading them off the checker
 * is the only way to see that they carry real types: nothing outside the class
 * can name them, and a slot that decayed to `any` would leave the gate green.
 * @returns {Record<string, string>} Slot name (`TOKENS`, `COMMENTS`,
 * `INDEX_MAP`) to the printed type.
 */
function symbolSlotTypes() {
	const name = "probe-slots.ts";
	const { program, diagnostics } = compile({
		[name]: `${PREAMBLE}const probe = store;\nvoid probe;`,
	});

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
	/** @type {Record<string, string>} */
	const slots = {};

	for (const property of type.getProperties()) {
		const match = /^__@([A-Z_]+)@\d+$/u.exec(property.escapedName);

		if (match) {
			slots[match[1]] = checker.typeToString(
				checker.getTypeOfSymbolAtLocation(property, declaration),
			);
		}
	}

	return slots;
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

/**
 * Reads the parsed `tsconfig.json`.
 * @returns {{files: string[]}} The parsed configuration.
 */
function readTsconfig() {
	const tsconfigPath = path.join(REPO_ROOT, "tsconfig.json");
	const tsconfig = ts.parseConfigFileTextToJson(
		tsconfigPath,
		fs.readFileSync(tsconfigPath, "utf8"),
	);

	assert.isUndefined(tsconfig.error);

	return tsconfig.config;
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lib/languages/js/source-code/token-store type annotations", () => {
	describe("the layer invariant", () => {
		/*
		 * This subtree could be annotated before anything above it precisely
		 * because it is an L1 layer: `lib/shared` and the vocabulary are its
		 * only edges inside `lib/`. A single require into `lib/rules/` or
		 * `lib/linter/` would invert the annotation order silently.
		 */
		it("requires nothing inside lib/ except lib/shared", () => {
			const offenders = [];
			const libDir = path.join(REPO_ROOT, "lib");
			const sharedDir = path.join(libDir, "shared");

			/*
			 * `lib/types/` is the hand-authored vocabulary every annotated file
			 * names; it holds no runtime code, so naming it is not a
			 * dependency. Everything else inside `lib/` is, including a JSDoc
			 * `import("...")` type reference — a type edge out of this subtree
			 * is worth catching too.
			 */
			const typesDir = path.join(libDir, "types");

			for (const entry of fs.readdirSync(SUBTREE_DIR)) {
				if (!entry.endsWith(".js")) {
					continue;
				}

				for (const specifier of importedSpecifiers(
					path.join(SUBTREE_DIR, entry),
				)) {
					if (!specifier.startsWith(".")) {
						continue;
					}

					const resolved = path.resolve(SUBTREE_DIR, specifier);

					if (!resolved.startsWith(`${libDir}${path.sep}`)) {
						continue;
					}

					const allowed = [SUBTREE_DIR, sharedDir, typesDir].some(
						dir => resolved.startsWith(`${dir}${path.sep}`),
					);

					if (!allowed) {
						offenders.push(`${SUBTREE}/${entry} -> ${specifier}`);
					}
				}
			}

			assert.deepStrictEqual(
				offenders,
				[],
				"token-store must depend on nothing inside lib/ but lib/shared — that is what makes it annotatable ahead of every layer above it",
			);
		});
	});

	describe("the allowlist", () => {
		/*
		 * `types.js` already checks that the allowlist and the pragmas agree in
		 * both directions. What it cannot check is that these twelve particular
		 * files are converted at all — dropping one would simply shrink the
		 * allowlist, consistently.
		 */
		it("covers all thirteen files, each with a pragma", () => {
			const tsconfig = readTsconfig();

			for (const file of ANNOTATED_FILES) {
				assert.include(tsconfig.files, file);
				assert.isTrue(
					fs
						.readFileSync(path.join(REPO_ROOT, file), "utf8")
						.startsWith("// @ts-check\n"),
					`${file} must carry a @ts-check pragma to actually be checked`,
				);
			}
		});

		/*
		 * The inverse of the guard that stood here while `cursors.js` was
		 * deferred. `index.js` used to restate the factory's two methods in a
		 * structural typedef, because an un-annotated `cursors.js` inferred as
		 * `any`; now that the file is annotated, the typedef must DERIVE from
		 * the export instead. A restatement would compile just as well and
		 * drift silently the first time a factory method changes.
		 */
		it("derives the factory type in index.js rather than restating it", () => {
			const indexSource = fs.readFileSync(
				path.join(REPO_ROOT, `${SUBTREE}/index.js`),
				"utf8",
			);

			assert.include(
				indexSource,
				"@typedef {typeof cursors.forward} CursorFactory",
				"index.js must take the factory type from the export it actually calls",
			);
			assert.notInclude(
				indexSource,
				"@typedef {object} CursorFactory",
				"the structural restatement existed only while cursors.js was un-annotated; a second declaration of the same shape can now drift from it",
			);
		});
	});

	describe("the shared vocabulary", () => {
		it("takes the nodes its getters accept from lib/types/core.d.ts", () => {
			assert.deepStrictEqual(
				unionMembersOf(
					`declare const probe: Parameters<TokenStore["getFirstToken"]>[0];
					void probe;`,
				),
				[
					{ name: "ASTNode", file: "lib/types/core.d.ts" },
					{ name: "Comment", file: "lib/types/core.d.ts" },
					{ name: "Token", file: "lib/types/core.d.ts" },
				],
				"the getters must accept the NodeOrToken from lib/types/core.d.ts — not a shape of this module's own invention",
			);
		});

		it("carries the guarantees Token and Comment make", () => {
			expectClean(
				"probe-vocabulary-members.ts",
				`import type { SourceLocation, SourceRange } from "./types/core.js";

				declare const token: Token;
				declare const comment: Comment;

				const range: SourceRange = token.range;
				const loc: SourceLocation = comment.loc;
				const value: string = comment.value;

				void range; void loc; void value;`,
			);
		});

		it("returns comments, not tokens, from the comment getters", () => {
			expectClean(
				"probe-comment-getters.ts",
				`const before: Comment[] = store.getCommentsBefore(node);
				const after: Comment[] = store.getCommentsAfter(node);
				const inside: Comment[] = store.getCommentsInside(node);
				const exists: boolean = store.commentsExistBetween(node, other);

				void before; void after; void inside; void exists;`,
			);
		});
	});

	describe("the symbol-keyed internal slots", () => {
		it("declares all three with real types", () => {
			assert.deepStrictEqual(symbolSlotTypes(), {
				TOKENS: "Token[]",
				COMMENTS: "Comment[]",
				INDEX_MAP: "IndexMap",
			});
		});

		it("types the index map so a wrong-shaped one is rejected", () => {
			expectError(
				"probe-index-map-bad.ts",
				`import { getFirstIndex } from "./${SUBTREE.slice("lib/".length)}/utils.js";

				declare const tokens: Token[];

				void getFirstIndex(tokens, { 0: "not an index" }, 0);`,
				2322,
			);
		});
	});

	describe("the single-token overload families", () => {
		/*
		 * The token-only half. Every one of these forms leaves
		 * `includeComments` off, so none of them can produce a `Comment` — and
		 * a caller that has to widen to `Token | Comment` anyway has lost the
		 * whole benefit of the family.
		 */
		it("narrows to Token for the forms that cannot yield a comment", () => {
			expectClean(
				"probe-skip-token-only.ts",
				`declare const filter: (t: Token | Comment) => boolean;

				const bare: Token | null = store.getFirstToken(node);
				const skipped: Token | null = store.getFirstToken(node, 2);
				const filtered: Token | null = store.getFirstToken(node, filter);
				const objectForm: Token | null = store.getFirstToken(node, { skip: 1 });
				const explicitlyOff: Token | null = store.getLastToken(node, { includeComments: false });
				const before: Token | null = store.getTokenBefore(node);
				const after: Token | null = store.getTokenAfter(node, 1);
				const firstBetween: Token | null = store.getFirstTokenBetween(node, other);
				const lastBetween: Token | null = store.getLastTokenBetween(node, other, filter);
				const byRangeStart: Token | null = store.getTokenByRangeStart(0);

				void bare; void skipped; void filtered; void objectForm;
				void explicitlyOff; void before; void after;
				void firstBetween; void lastBetween; void byRangeStart;`,
			);
		});

		/*
		 * The other half, and the one that makes the first non-vacuous: with a
		 * single widened signature both probes would pass, because everything
		 * would return `Token | Comment | null`.
		 */
		it("widens to Token | Comment once includeComments is asked for", () => {
			expectClean(
				"probe-skip-comment-inclusive.ts",
				`const first: Token | Comment | null = store.getFirstToken(node, { includeComments: true });
				const byRangeStart: Token | Comment | null = store.getTokenByRangeStart(0, { includeComments: true });

				void first; void byRangeStart;`,
			);
			expectError(
				"probe-skip-comment-inclusive-bad.ts",
				`const first: Token | null = store.getFirstToken(node, { includeComments: true });

				void first;`,
				2322,
			);
		});

		it("still accepts an argument known only as SkipOptions", () => {
			expectClean(
				"probe-skip-forwarded.ts",
				`declare const options: SkipOptions;

				const forwarded: Token | Comment | null = store.getTokenBefore(node, options);

				void forwarded;`,
			);
		});

		it("rejects an option object with an unrelated key", () => {
			expectError(
				"probe-skip-bad-key.ts",
				`void store.getFirstToken(node, { includeComment: true });`,
				2769,
			);
		});
	});

	describe("the multi-token overload families", () => {
		it("narrows to Token[] for the forms that cannot yield a comment", () => {
			expectClean(
				"probe-count-token-only.ts",
				`declare const filter: (t: Token | Comment) => boolean;

				const first: Token[] = store.getFirstTokens(node);
				const counted: Token[] = store.getLastTokens(node, 2);
				const filtered: Token[] = store.getTokensBefore(node, filter);
				const objectForm: Token[] = store.getTokensAfter(node, { count: 1 });
				const firstBetween: Token[] = store.getFirstTokensBetween(node, other);
				const lastBetween: Token[] = store.getLastTokensBetween(node, other, 1);

				void first; void counted; void filtered; void objectForm;
				void firstBetween; void lastBetween;`,
			);
		});

		it("widens to (Token | Comment)[] once includeComments is asked for", () => {
			expectClean(
				"probe-count-comment-inclusive.ts",
				`const tokens: (Token | Comment)[] = store.getFirstTokens(node, { includeComments: true });

				void tokens;`,
			);
			expectError(
				"probe-count-comment-inclusive-bad.ts",
				`const tokens: Token[] = store.getFirstTokens(node, { includeComments: true });

				void tokens;`,
				2322,
			);
		});

		it("still accepts an argument known only as CountOptions", () => {
			expectClean(
				"probe-count-forwarded.ts",
				`declare const options: CountOptions;

				const forwarded: (Token | Comment)[] = store.getTokensAfter(node, options);

				void forwarded;`,
			);
		});
	});

	describe("the padding overload families", () => {
		/*
		 * `getTokens` and `getTokensBetween` read a NUMBER as padding rather
		 * than as `count`, which is why they need their own option shapes. A
		 * family built from `TokenOnlyCountOptions` would type
		 * `getTokens(node, 2, 2)` as a count query.
		 */
		it("accepts the deprecated numeric padding form and returns Token[]", () => {
			expectClean(
				"probe-padding.ts",
				`const padded: Token[] = store.getTokens(node, 1, 2);
				const paddedBefore: Token[] = store.getTokens(node, 1);
				const all: Token[] = store.getTokens(node);
				const between: Token[] = store.getTokensBetween(node, other, 1);
				const allBetween: Token[] = store.getTokensBetween(node, other);

				void padded; void paddedBefore; void all;
				void between; void allBetween;`,
			);
		});

		it("widens to (Token | Comment)[] once includeComments is asked for", () => {
			expectClean(
				"probe-padding-comment-inclusive.ts",
				`const tokens: (Token | Comment)[] = store.getTokens(node, { includeComments: true });
				const between: (Token | Comment)[] = store.getTokensBetween(node, other, { includeComments: true });

				void tokens; void between;`,
			);
			expectError(
				"probe-padding-comment-inclusive-bad.ts",
				`const tokens: Token[] = store.getTokens(node, { includeComments: true });

				void tokens;`,
				2322,
			);
		});

		it("rejects an option object where only padding is accepted", () => {
			expectError(
				"probe-padding-bad.ts",
				`void store.getTokens(node, 1, { includeComments: true });`,
				2769,
			);
		});
	});

	describe("the cursor protocol", () => {
		/*
		 * `cursor.js` IS the declared cursor interface — every concrete cursor
		 * reaches it through `extends`, and `index.js` types the cursors it
		 * builds as a `Cursor` rather than as the structural union of the
		 * concrete classes. If the base stopped declaring `current`, the
		 * subclasses would each infer their own and the relationship would
		 * become structural again.
		 */
		it("declares current, getOneToken and getAllTokens on the base", () => {
			expectClean(
				"probe-cursor-base.ts",
				`import Cursor = require("./${SUBTREE.slice("lib/".length)}/cursor.js");
				import FilterCursor = require("./${SUBTREE.slice("lib/".length)}/filter-cursor.js");
				import ForwardTokenCursor = require("./${SUBTREE.slice("lib/".length)}/forward-token-cursor.js");
				import PaddedTokenCursor = require("./${SUBTREE.slice("lib/".length)}/padded-token-cursor.js");

				declare const cursor: Cursor;

				const current: Token | Comment | null = cursor.current;
				const one: Token | Comment | null = cursor.getOneToken();
				const all: (Token | Comment)[] = cursor.getAllTokens();
				const moved: boolean = cursor.moveNext();

				// Every concrete cursor is usable wherever the base is.
				declare const filterCursor: FilterCursor;
				declare const forwardCursor: ForwardTokenCursor;
				declare const paddedCursor: PaddedTokenCursor;
				const asBase: Cursor[] = [filterCursor, forwardCursor, paddedCursor];

				void current; void one; void all; void moved; void asBase;`,
			);
		});

		/*
		 * The token-only cursors override both shorthands with narrower
		 * returns, which is what lets `getTokens`' padding overloads claim
		 * `Token[]` rather than the base's `(Token | Comment)[]`.
		 */
		it("narrows the token-only cursor's shorthands to Token", () => {
			expectClean(
				"probe-cursor-narrow.ts",
				`import ForwardTokenCursor = require("./${SUBTREE.slice("lib/".length)}/forward-token-cursor.js");

				declare const cursor: ForwardTokenCursor;

				const one: Token | null = cursor.getOneToken();
				const all: Token[] = cursor.getAllTokens();

				void one; void all;`,
			);
		});

		it("rejects decorating something that is not a cursor", () => {
			expectError(
				"probe-cursor-decorate-bad.ts",
				`import FilterCursor = require("./${SUBTREE.slice("lib/".length)}/filter-cursor.js");

				void new FilterCursor("not a cursor", () => true);`,
				2345,
			);
		});

		it("rejects a filter predicate that does not take a token", () => {
			expectError(
				"probe-cursor-filter-bad.ts",
				`import FilterCursor = require("./${SUBTREE.slice("lib/".length)}/filter-cursor.js");
				import Cursor = require("./${SUBTREE.slice("lib/".length)}/cursor.js");

				declare const cursor: Cursor;

				void new FilterCursor(cursor, (n: number) => n > 0);`,
				2345,
			);
		});
	});

	describe("the cursor factories", () => {
		/** What both factory methods must hand back. */
		const SHARED_INTERFACE = {
			name: "Cursor",
			file: `${SUBTREE}/cursor.js`,
		};

		/*
		 * `createBaseCursor` reads its constructor out of an instance field, so
		 * the class it instantiates is a runtime value. Naming the field's type
		 * by the interface every cursor class satisfies is what keeps the
		 * result a real type instead of an inferred `any`.
		 */
		it("builds a base cursor typed by the shared interface", () => {
			assert.deepStrictEqual(
				declaredTypeOf(
					`${CURSORS_PREAMBLE}const probe = cursors.forward.createBaseCursor(tokens, comments, indexMap, 0, -1, true);
					void probe;`,
				),
				SHARED_INTERFACE,
				"createBaseCursor must be declared against cursor.js — the class it picks is an instance field, so nothing else can describe both branches",
			);
		});

		/*
		 * And the six-way case: filter, skip and count each add a decorator
		 * independently, so the concrete class is decided by three runtime
		 * flags. `Cursor` is the honest answer — every one of the six is one,
		 * and it is the whole surface `index.js` consumes.
		 */
		it("builds a decorated cursor typed by the same interface", () => {
			assert.deepStrictEqual(
				declaredTypeOf(
					`${CURSORS_PREAMBLE}const probe = cursors.backward.createCursor(tokens, comments, indexMap, 0, -1, false, filter, 1, 2);
					void probe;`,
				),
				SHARED_INTERFACE,
			);
		});

		/*
		 * The instance fields themselves. These hold CLASSES, and a class-valued
		 * field is exactly the kind of slot that infers as `any` when its
		 * `@param` is missing.
		 */
		it("holds base cursor classes in its instance fields", () => {
			assert.deepStrictEqual(
				declaredTypeOf(
					`${CURSORS_PREAMBLE}const probe = new cursors.forward.TokenCommentCursor(tokens, comments, indexMap, 0, -1);
					void probe;`,
				),
				SHARED_INTERFACE,
			);
			expectError(
				"probe-factory-class-arity.ts",
				`${CURSORS_PREAMBLE}void new cursors.backward.TokenCursor(tokens);`,
				2554,
			);
		});

		/*
		 * The half that makes the three above non-vacuous. While `cursors.js`
		 * was un-annotated both methods returned `any`, and `any` is assignable
		 * to everything — so every positive probe would have passed against a
		 * module that declared nothing at all.
		 */
		it("returns a cursor and not an any", () => {
			expectError(
				"probe-factory-not-any.ts",
				`${CURSORS_PREAMBLE}const probe: number = cursors.forward.createCursor(tokens, comments, indexMap, 0, -1, false, null, 0, -1);

				void probe;`,
				2322,
			);
		});

		it("rejects a filter that is not a token predicate", () => {
			expectError(
				"probe-factory-filter-bad.ts",
				`${CURSORS_PREAMBLE}void cursors.forward.createCursor(tokens, comments, indexMap, 0, -1, false, (n: number) => n > 0, 0, -1);`,
				2345,
			);
		});

		/*
		 * The result must not be narrower than the interface either. Declaring
		 * the decorated union would let a caller believe a `filter` argument
		 * guarantees a `FilterCursor`, which the skip and count flags can wrap
		 * away.
		 */
		it("does not promise a particular decorator", () => {
			expectError(
				"probe-factory-not-narrow.ts",
				`${CURSORS_PREAMBLE}import FilterCursor = require("./${FROM_LIB}/filter-cursor.js");

				const probe: FilterCursor = cursors.forward.createCursor(tokens, comments, indexMap, 0, -1, false, filter, 0, -1);

				void probe;`,
				2739,
			);
		});
	});

	describe("the escape hatches", () => {
		/*
		 * Asserting that SOME cast is documented is nearly vacuous. The check
		 * that matters is mechanical: for every JSDoc cast in the subtree, find
		 * the standalone block comment immediately above it and require an
		 * `ESCAPE HATCH` marker inside THAT block — not merely somewhere in a
		 * line window, which a cast could satisfy by sitting near an unrelated
		 * marker. A cast is also required to be close to its block, so a new
		 * undocumented cast dropped a few lines under a documented one fails
		 * and names its own line.
		 */
		it("documents every JSDoc cast with a stated reason", () => {
			/** How far a cast may sit from the block that explains it. */
			const MAX_DISTANCE = 12;
			const undocumented = [];

			for (const file of ANNOTATED_FILES) {
				const lines = fs
					.readFileSync(path.join(REPO_ROOT, file), "utf8")
					.split("\n");

				lines.forEach((line, index) => {
					if (!/@type\s*\{[^}]*\}\s*\*\/\s*\(/u.test(line)) {
						return;
					}

					// The nearest line above that closes a standalone block.
					let end = index - 1;

					while (end >= 0 && lines[end].trim() !== "*/") {
						end -= 1;
					}

					let start = end;

					while (
						start >= 0 &&
						!lines[start].trim().startsWith("/*")
					) {
						start -= 1;
					}

					const block =
						start < 0 ? "" : lines.slice(start, end + 1).join("\n");

					if (
						!block.includes("ESCAPE HATCH") ||
						index - end > MAX_DISTANCE
					) {
						undocumented.push(`${file}:${index + 1}`);
					}
				});
			}

			assert.deepStrictEqual(
				undocumented,
				[],
				"every JSDoc cast in token-store must sit directly under a block comment whose ESCAPE HATCH note states why it is safe",
			);
		});
	});
});

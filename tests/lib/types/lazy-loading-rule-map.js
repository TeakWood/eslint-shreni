/**
 * @fileoverview Guards the annotation of `lib/rules/utils/lazy-loading-rule-map.js`.
 *
 * This class deliberately breaks the contract of the class it extends: it
 * stores `() => Rule` loader thunks but hands back resolved rules, and it
 * poisons `set`, `clear` and `delete` on the prototype while re-pointing
 * `[Symbol.iterator]` at `entries`. `Map<K, V>` has one type parameter serving
 * both the read and the write side, so no instantiation describes both halves
 * and the annotation has to CHOOSE. The bead's requirement is that it choose
 * the READ side — what callers observe — and bridge the store with documented
 * assertions.
 *
 * `npm run lint:types` cannot check that choice. It compiles this file, so the
 * obvious conclusion is that the gate already validates it; it does not. The
 * base was previously instantiated as `Map<string, any>`, which type-checks
 * clean forever AND leaks `any` out of every member this class does not
 * override — most visibly `[Symbol.iterator]`, where `for (const [id, rule] of
 * rules)` typed `rule` as `any`. "The gate is green" and "the read API is
 * honest" are different claims and only the probes below assert the second.
 *
 * Three things here outlive the bead:
 *
 * 1. `the read API`, which pins the PRINTED type of every member a caller can
 *    read. A base widened back to `any` prints `any` and fails, where a
 *    structural probe would have passed.
 * 2. `for...of yields resolved rules`, the single probe that separates
 *    `Map<string, Rule>` from every other instantiation — `[Symbol.iterator]`
 *    is inherited, never declared here, so it is right only as a consequence
 *    of the base's type argument.
 * 3. `the poisoned members`, which pins at RUNTIME the three claims the class
 *    comment makes about the prototype. The comment explains why those
 *    inherited signatures cannot be corrected; if the poisoning ever went
 *    away, the explanation would become a lie that nothing else would catch.
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

const {
	LazyLoadingRuleMap,
} = require("../../../lib/rules/utils/lazy-loading-rule-map");

/*
 * `set` is poisoned by the FIRST construction, not at module load —
 * `super(...iterable)` calls `this.set()`, so it cannot be removed any earlier.
 * `lib/rules/index.js` is the singleton that performs that one construction;
 * requiring it here makes the poisoning a fact by the time any test runs,
 * whichever order this file is loaded in. It is a no-op when another suite has
 * already loaded it, which is the normal case in a full run.
 */
require("../../../lib/rules");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUBJECT = "lib/rules/utils/lazy-loading-rule-map.js";

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so that the relative `./rules/...` import resolves exactly as it does
 * for a real source file.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/**
 * The hand-authored ambient declarations. Nothing pulls an ambient block into a
 * program implicitly — the shipped gate gets it from the `tsconfig.json`
 * allowlist, so a probe program has to name it as a root the same way.
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
 * `Rule` is a local interface rather than anything from `core.d.ts` on purpose:
 * this class is generic over the rule type and never names one, so a probe that
 * imported a rule vocabulary would be testing that vocabulary instead.
 */
const PREAMBLE = `
import { LazyLoadingRuleMap } from "./rules/utils/lazy-loading-rule-map.js";

interface Rule {
    readonly ruleName: string;
}

declare const loaders: [string, () => Rule][];
declare const rules: LazyLoadingRuleMap<Rule>;
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
 * The declared types of several probe expressions, as the compiler prints them.
 *
 * Printing rather than structurally comparing is the point. Every member below
 * is either inherited from `Map` or overridden here, so a structural check
 * cannot tell `Map<string, Rule>` from `Map<string, any>` — `any` satisfies any
 * structural assertion that is written. The printed type cannot.
 *
 * All the expressions share one compilation: the repo's gate runs mocha under a
 * 10s per-test timeout and each `ts.createProgram` over `lib/` costs a
 * meaningful fraction of a second.
 * @param {Record<string, string>} expressions Probe name to expression.
 * @returns {Record<string, string>} The same keys, mapped to printed types.
 */
function declaredTypes(expressions) {
	const name = "declared-types.ts";
	const body = Object.entries(expressions)
		.map(([key, expression]) => `export const ${key} = ${expression};`)
		.join("\n");
	const { program } = compile({ [name]: `${PREAMBLE}\n${body}\n` });
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(probePath(PROBE_DIR, name));

	assert.isDefined(sourceFile, "the probe was not pulled into the program");

	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	const printed = {};

	for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
		printed[symbol.getName()] = checker.typeToString(
			checker.getTypeOfSymbolAtLocation(symbol, sourceFile),
		);
	}

	return printed;
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

describe("lazy-loading-rule-map type annotations", () => {
	describe("the allowlist", () => {
		it("compiles the subject and checks it", () => {
			const tsconfig = ts.parseConfigFileTextToJson(
				path.join(REPO_ROOT, "tsconfig.json"),
				readSource("tsconfig.json"),
			);

			assert.isUndefined(tsconfig.error);
			assert.include(
				tsconfig.config.files,
				SUBJECT,
				`${SUBJECT} is annotated but nothing in the gate compiles it`,
			);
			assert.isTrue(
				readSource(SUBJECT).startsWith("// @ts-check\n"),
				`${SUBJECT} must carry a @ts-check pragma to actually be checked`,
			);
		});

		/*
		 * A file can sit in the allowlist, carry the pragma, and still be
		 * unchecked if it silences the checker. This one does not need to: the
		 * imprecision is confined to assertions, which are visible.
		 */
		it("uses no blanket suppression", () => {
			const source = readSource(SUBJECT);

			for (const directive of [
				"@ts-nocheck",
				"@ts-ignore",
				"@ts-expect-error",
			]) {
				assert.notInclude(
					source,
					directive,
					`${SUBJECT} suppresses the checker with ${directive}`,
				);
			}
		});
	});

	describe("the read API", () => {
		/*
		 * The acceptance criterion of the bead, made mechanical. Every entry
		 * is a member a caller can READ; none may print `any`, and the tuple
		 * members must carry `Rule` rather than the stored `() => Rule`.
		 */
		it("describes resolved rules, not the loader thunks behind them", () => {
			assert.deepStrictEqual(
				declaredTypes({
					got: 'rules.get("semi")',
					iterated: "[...rules][0]",
					valued: "[...rules.values()][0]",
					entried: "[...rules.entries()][0]",
					keyed: "[...rules.keys()][0]",
					counted: "rules.size",
					asked: 'rules.has("semi")',
				}),
				{
					got: "Rule | undefined",
					iterated: "[string, Rule]",
					valued: "Rule",
					entried: "[string, Rule]",
					keyed: "string",
					counted: "number",
					asked: "boolean",
				},
			);
		});

		/*
		 * The constructor is the one place the THUNK type is the honest one,
		 * and it must not have been dragged along with the read side.
		 */
		it("still takes loader thunks at construction", () => {
			assert.deepStrictEqual(
				declaredTypes({
					built: "new LazyLoadingRuleMap(loaders)",
					takes: "((...args: ConstructorParameters<typeof LazyLoadingRuleMap<Rule>>) => args)",
					visits: "(rules.forEach)",
				}),
				{
					built: "LazyLoadingRuleMap<Rule>",
					takes: "(loaders: [string, () => Rule][]) => [loaders: [string, () => Rule][]]",
					visits: "(callbackFn: (rule: Rule, ruleId: string, map: LazyLoadingRuleMap<Rule>) => void, thisArg?: any) => void",
				},
			);
		});

		it("accepts every read a caller can make", () => {
			expectClean(
				"read-api-ok.ts",
				`const map = new LazyLoadingRuleMap(loaders);
const one: Rule | undefined = map.get("semi");
const names: string[] = [...map.keys()];
const all: Rule[] = [...map.values()];
const pairs: [string, Rule][] = [...map.entries()];
const spread: [string, Rule][] = [...map];

for (const [ruleId, rule] of map) {
    const both: string = ruleId + rule.ruleName;
}

map.forEach((rule, ruleId, self) => {
    const echoed: string = ruleId + rule.ruleName + String(self.size);
});
`,
			);
		});
	});

	describe("the poisoned members", () => {
		/*
		 * `[Symbol.iterator]` is INHERITED — this class never declares it — so
		 * it is typed correctly only as a consequence of the base being
		 * instantiated with the read type. That makes this the one probe that
		 * separates `Map<string, Rule>` from every other choice, including the
		 * `Map<string, any>` this file previously carried, under which the
		 * assignment below compiled clean.
		 */
		it("types for...of as resolved rules rather than any", () => {
			expectError(
				"iterator-not-any.ts",
				`for (const [, rule] of rules) {
    const leaked: string = rule;
}
`,
				2322,
			);
		});

		it("types the values iterator as resolved rules", () => {
			expectError(
				"values-not-any.ts",
				"const leaked: string = [...rules.values()][0];\n",
				2322,
			);
		});

		it("types the forEach callback as resolved rules", () => {
			expectError(
				"foreach-not-any.ts",
				`rules.forEach(rule => {
    const leaked: string = rule;
});
`,
				2322,
			);
		});

		it("rejects rules where the constructor wants loaders", () => {
			expectError(
				"constructor-wants-thunks.ts",
				`declare const rule: Rule;

const built = new LazyLoadingRuleMap<Rule>([["semi", rule]]);
`,
				2322,
			);
		});

		/*
		 * The class comment explains that `set`, `clear` and `delete` keep
		 * `Map`'s callable signatures because a subclass member must stay
		 * assignable to the base's (TS2415), and that `[Symbol.iterator]` is
		 * an alias for `entries`. Those are claims about the RUNTIME, and the
		 * compiler cannot see any of them. If the poisoning were ever removed,
		 * the explanation would silently become false.
		 */
		it("really are poisoned on the prototype", () => {
			/*
			 * `clear` and `delete` are poisoned at module load and `set` by the
			 * one construction this file forces at require time, so nothing is
			 * constructed here. It could not be: `new Map(iterable)` reads
			 * `set` off the receiver BEFORE it iterates, so even
			 * `new LazyLoadingRuleMap([])` throws `TypeError` once the
			 * prototype is poisoned — which is the poisoning itself, observed
			 * from the outside.
			 */
			for (const member of ["set", "clear", "delete"]) {
				assert.isUndefined(
					LazyLoadingRuleMap.prototype[member],
					`${member} is documented as poisoned but is still callable`,
				);
			}

			assert.strictEqual(
				LazyLoadingRuleMap.prototype[Symbol.iterator],
				LazyLoadingRuleMap.prototype.entries,
				"[Symbol.iterator] is documented as an alias for entries",
			);
		});

		/*
		 * And the read API is not merely a type claim either: the store holds
		 * thunks, so a map that handed back what it was given would fail here.
		 */
		it("hands back what the loaders return", () => {
			/*
			 * `super(...iterable)` calls `this.set()`, so a map can only be
			 * built while `set` is intact — and the constructor removes it
			 * again on the way out, which means only the FIRST construction in
			 * a process can carry entries — and `lib/rules/index.js`, required
			 * at the top of this file, has already spent it. So restore `set`
			 * here rather than depending on winning a race with the rest of
			 * the test run. The assertion below checks the constructor takes
			 * it away again.
			 */
			Object.defineProperty(LazyLoadingRuleMap.prototype, "set", {
				configurable: true,
				writable: true,
				value: Map.prototype.set,
			});

			let calls = 0;
			const rule = { ruleName: "semi" };
			const map = new LazyLoadingRuleMap([
				[
					"semi",
					() => {
						calls += 1;
						return rule;
					},
				],
			]);

			assert.isUndefined(
				LazyLoadingRuleMap.prototype.set,
				"the constructor must poison `set` again on the way out",
			);
			assert.strictEqual(map.get("semi"), rule);
			assert.deepStrictEqual([...map], [["semi", rule]]);
			assert.deepStrictEqual([...map.values()], [rule]);
			assert.strictEqual(calls, 3);
		});
	});

	describe("the escape hatches", () => {
		/*
		 * The bead permits assertions here and requires each to state the JS
		 * idiom that forced it. A fixed line window would be the wrong shape
		 * for that check in both directions, so this walks up to the block
		 * comment that actually precedes the cast and requires the marker
		 * inside THAT block — a new, undocumented cast cannot inherit its
		 * neighbour's reason.
		 */
		it("document every JSDoc cast with a stated reason", () => {
			/** How far a cast may sit from the block that explains it. */
			const MAX_DISTANCE = 12;
			const lines = readSource(SUBJECT).split("\n");
			const undocumented = [];
			let casts = 0;

			lines.forEach((line, index) => {
				if (!/@type\s*\{.*\}\s*\*\/\s*\(/u.test(line)) {
					return;
				}

				casts += 1;

				// The nearest line above that closes a standalone block.
				let end = index - 1;

				while (end >= 0 && lines[end].trim() !== "*/") {
					end -= 1;
				}

				let start = end;

				while (start >= 0 && !lines[start].trim().startsWith("/*")) {
					start -= 1;
				}

				const block =
					start < 0 ? "" : lines.slice(start, end + 1).join("\n");

				if (
					!block.includes("ESCAPE HATCH") ||
					index - end > MAX_DISTANCE
				) {
					undocumented.push(`${SUBJECT}:${index + 1}`);
				}
			});

			assert.deepStrictEqual(
				undocumented,
				[],
				"every JSDoc cast must sit under a block comment whose ESCAPE HATCH note states why it is safe",
			);

			/*
			 * Five sites touch the backing store — the constructor plus the
			 * four readers — and each bridges through `unknown`, so ten cast
			 * expressions is the whole budget. A sixth site means the class
			 * grew a member the class comment does not account for.
			 */
			assert.strictEqual(
				casts,
				10,
				"the number of assertions changed; re-read the class comment before adjusting this number",
			);
		});
	});
});

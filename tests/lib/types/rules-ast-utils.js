/**
 * @fileoverview Guards the annotation of `lib/rules/utils/ast-utils.js` — the
 * file with 193 inbound edges, whose type quality gates roughly 75% of `lib/`.
 *
 * This file IS compiled by the shipped gate, so the obvious conclusion is that
 * `npm run lint:types` already validates it. It does not. An undocumented
 * parameter in a `.js` file is an implicit `any`, and `any` type-checks clean
 * forever — "the gate is green" and "the module is typed" are different claims,
 * and only the probes below assert the second.
 *
 * Two things here outlive the bead:
 *
 * 1. `no exported signature is any`, which walks every one of the module's 94
 *    exports through the compiler's own type checker rather than trusting a
 *    hand-written list. A signature that decays to `any` in any future edit
 *    fails it, wherever the decay happens.
 * 2. `the interim node view` at the bottom, which fails the day the real node
 *    union lands in `core.d.ts` and tells the reader to retire the `Node`
 *    typedef in `ast-utils.js`. Without it the widening would quietly outlive
 *    its reason.
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
const AST_UTILS = "lib/rules/utils/ast-utils.js";
const AST_UTILS_PATH = path.join(REPO_ROOT, AST_UTILS);
const CORE_DTS_PATH = path.join(REPO_ROOT, "lib/types/core.d.ts");

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path inside
 * `lib/` so that both bare specifiers and the relative `./rules/...` import
 * resolve exactly as they do for a real source file.
 */
const PROBE_DIR = probePath(REPO_ROOT, "lib");

/**
 * The hand-authored ambient declarations. `ast-utils.js` cannot be typed
 * without the `esutils` block — `getTrailingStatement` is that block's
 * `ast.trailingStatement` — and nothing pulls an ambient block into a program
 * implicitly. The shipped gate gets it from the `tsconfig.json` allowlist, so a
 * probe program has to name it as a root the same way.
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
 * The preamble every probe shares: the module under test, plus aliases for the
 * three parameter types the probes need.
 *
 * The aliases are derived from the module's own signatures with `Parameters<>`
 * rather than spelled out. That is deliberate: spelling them out would let a
 * probe keep passing after the signature it is meant to guard had drifted,
 * because the probe would be asserting against the test's idea of the type
 * rather than the module's.
 */
const PREAMBLE = `
import * as astUtils from "./rules/utils/ast-utils.js";

type NodeArg = NonNullable<Parameters<typeof astUtils.isFunction>[0]>;
type SourceCodeArg = Parameters<typeof astUtils.isParenthesised>[0];
type TokenArg = Parameters<typeof astUtils.isCommaToken>[0];

declare const node: NodeArg;
declare const sourceCode: SourceCodeArg;
declare const token: TokenArg;
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
 * Every export of `ast-utils.js`, paired with its type as the compiler sees it.
 *
 * Read off a probe that imports the module, rather than by `require`ing it, so
 * what comes back is the declared surface — the thing the 193 dependents will
 * inherit — and not the runtime one. Going through an import also keeps the
 * module's JSDoc `@typedef`s out of the result: those are type-only exports of
 * the file, not members of the value it exports.
 * @returns {{checker: ts.TypeChecker, exports: ts.Symbol[], location: ts.Node}} The checker, the export symbols and a node to resolve them at.
 */
function moduleExports() {
	const name = "module-surface.ts";
	const { program } = compile({
		[name]: `import * as astUtils from "./rules/utils/ast-utils.js";\nexport const surface = astUtils;\n`,
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
 * Whether a type is `any`, or an array or promise of `any`.
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

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("lib/rules/utils/ast-utils.js type annotations", () => {
	describe("the allowlist", () => {
		/*
		 * `types.js` already checks that the allowlist and the pragmas agree in
		 * both directions. What it cannot check is that this particular file is
		 * converted at all — dropping it would simply shrink the allowlist,
		 * consistently.
		 */
		it("covers the chokepoint file", () => {
			const text = fs.readFileSync(
				path.join(REPO_ROOT, "tsconfig.json"),
				"utf8",
			);
			const tsconfig = ts.parseConfigFileTextToJson(
				path.join(REPO_ROOT, "tsconfig.json"),
				text,
			);

			assert.isUndefined(tsconfig.error);
			assert.include(tsconfig.config.files, AST_UTILS);
		});

		it("carries a `// @ts-check` pragma", () => {
			const source = fs.readFileSync(AST_UTILS_PATH, "utf8");

			assert.match(
				source,
				/^\/\/ @ts-check\n/u,
				"the pragma is what makes the file checked; the allowlist alone does not",
			);
		});

		it("uses no blanket suppression", () => {
			const source = fs.readFileSync(AST_UTILS_PATH, "utf8");

			assert.notInclude(source, "@ts-nocheck");
			assert.notInclude(source, "@ts-ignore");
			assert.notInclude(source, "@ts-expect-error");
		});
	});

	describe("the exported surface", () => {
		it("declares all 94 exports", () => {
			const { exports } = moduleExports();

			assert.strictEqual(exports.length, 94);
		});

		/*
		 * The acceptance criterion this bead is judged on, asserted against the
		 * compiler rather than by reading the source. Every parameter and every
		 * return type of every exported signature is walked, so a decay to
		 * `any` anywhere on the surface fails here even if the gate stays green.
		 */
		it("has no `any` in any exported signature", () => {
			const { checker, exports, location } = moduleExports();
			const offenders = [];

			for (const symbol of exports) {
				const type = checker.getTypeOfSymbolAtLocation(
					symbol,
					location,
				);

				if (isAnyish(checker, type)) {
					offenders.push(`${symbol.getName()} is any`);
					continue;
				}

				for (const signature of type.getCallSignatures()) {
					for (const parameter of signature.getParameters()) {
						const parameterType = checker.getTypeOfSymbolAtLocation(
							parameter,
							location,
						);

						if (isAnyish(checker, parameterType)) {
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

			assert.deepStrictEqual(
				offenders,
				[],
				"193 files inherit these signatures; an `any` here is invisible to the gate but propagates to all of them",
			);
		});

		it("declares every export that is not a function", () => {
			const { checker, exports, location } = moduleExports();
			const constants = exports
				.filter(symbol => {
					const type = checker.getTypeOfSymbolAtLocation(
						symbol,
						location,
					);

					return type.getCallSignatures().length === 0;
				})
				.map(symbol => symbol.getName())
				.sort();

			assert.deepStrictEqual(constants, [
				"COMMENTS_IGNORE_PATTERN",
				"ECMASCRIPT_GLOBALS",
				"LINEBREAKS",
				"LINEBREAK_MATCHER",
				"SHEBANG_MATCHER",
				"STATEMENT_LIST_PARENTS",
			]);
		});
	});

	describe("node predicates", () => {
		it("accept a node", () => {
			expectClean(
				"predicate-ok.ts",
				`const result: boolean = astUtils.isFunction(node);\nvoid result;\n`,
			);
		});

		it("reject a value that is not a node", () => {
			expectError(
				"predicate-bad.ts",
				`astUtils.isFunction("FunctionDeclaration");\n`,
				2345,
			);
		});

		it("reject a node where a string was expected", () => {
			expectError(
				"operator-bad.ts",
				`astUtils.isLogicalAssignmentOperator(node);\n`,
				2345,
			);
		});
	});

	describe("token predicates", () => {
		/*
		 * These are handed to the token store as filters. `TokenFilter` takes
		 * `Token | Comment`, and under `strictFunctionTypes` a predicate that
		 * accepted only `Token` would not be assignable there — so this probe
		 * is what pins the widening in the `AnyToken` typedef.
		 */
		it("are assignable as token-store filters", () => {
			expectClean(
				"filter-ok.ts",
				`sourceCode.getTokenAfter(node, astUtils.isCommaToken);\n` +
					`const result: boolean = astUtils.isCommentToken(token);\n` +
					`void result;\n`,
			);
		});

		it("do not accept a node predicate as a filter", () => {
			expectError(
				"filter-bad.ts",
				`sourceCode.getTokenAfter(node, astUtils.isFunction);\n`,
				2345,
			);
		});

		it("keep the negated forms typed", () => {
			expectError(
				"negated-bad.ts",
				`astUtils.isNotCommaToken(node);\n`,
				2345,
			);
		});
	});

	describe("return types", () => {
		/*
		 * The bead's named criterion: `getTrailingStatement` is
		 * `esutils.ast.trailingStatement`, re-exported straight from the
		 * ambient block, and it must not come through as `any`. The negative
		 * probe is the one that matters — an `any` return satisfies the
		 * positive one too.
		 */
		it("give getTrailingStatement a real node type", () => {
			expectClean(
				"trailing-ok.ts",
				`const statement: { type: string } | null =\n` +
					`\tastUtils.getTrailingStatement(node);\n` +
					`void statement;\n`,
			);
		});

		it("do not let getTrailingStatement return any", () => {
			expectError(
				"trailing-bad.ts",
				`const statement: number = astUtils.getTrailingStatement(node);\nvoid statement;\n`,
				2322,
			);
		});

		it("keep getStaticPropertyName nullable", () => {
			expectError(
				"static-name-bad.ts",
				`const name: string = astUtils.getStaticPropertyName(node);\nvoid name;\n`,
				2322,
			);
		});

		it("give getPrecedence a number", () => {
			expectClean(
				"precedence-ok.ts",
				`const level: number = astUtils.getPrecedence(node);\nvoid level;\n`,
			);
			expectError(
				"precedence-bad.ts",
				`const level: string = astUtils.getPrecedence(node);\nvoid level;\n`,
				2322,
			);
		});

		it("give getFunctionNameWithKind a string", () => {
			expectError(
				"kind-bad.ts",
				`const kind: number = astUtils.getFunctionNameWithKind(node);\nvoid kind;\n`,
				2322,
			);
		});

		it("give getDirectivePrologue a list of nodes", () => {
			expectClean(
				"prologue-ok.ts",
				`const directives: { type: string }[] =\n` +
					`\tastUtils.getDirectivePrologue(node);\n` +
					`void directives;\n`,
			);
		});
	});

	describe("multi-argument signatures", () => {
		it("type the isDefaultThisBinding options bag", () => {
			expectClean(
				"this-binding-ok.ts",
				`astUtils.isDefaultThisBinding(node, sourceCode, {\n` +
					`\tcapIsConstructor: false,\n` +
					`});\n`,
			);
		});

		it("reject a wrongly typed isDefaultThisBinding option", () => {
			expectError(
				"this-binding-bad.ts",
				`astUtils.isDefaultThisBinding(node, sourceCode, {\n` +
					`\tcapIsConstructor: "no",\n` +
					`});\n`,
				2322,
			);
		});

		it("let canTokensBeAdjacent take strings or tokens", () => {
			expectClean(
				"adjacent-ok.ts",
				`astUtils.canTokensBeAdjacent("a", token);\n` +
					`astUtils.canTokensBeAdjacent(token, "b");\n`,
			);
		});

		it("reject a non-token for canTokensBeAdjacent", () => {
			expectError(
				"adjacent-bad.ts",
				`astUtils.canTokensBeAdjacent(1, "b");\n`,
				2345,
			);
		});

		it("type getNameLocationInGlobalDirectiveComment's comment argument", () => {
			expectError(
				"global-directive-bad.ts",
				`astUtils.getNameLocationInGlobalDirectiveComment(\n` +
					`\tsourceCode,\n` +
					`\tnode,\n` +
					`\t"foo",\n` +
					`);\n`,
				2345,
			);
		});
	});

	describe("the interim node view", () => {
		/*
		 * A test that knows how it will die.
		 *
		 * `ast-utils.js` widens `ASTNode` with a local `Node` typedef because
		 * `core.d.ts` carries only the union's base — `type` is a bare `string`
		 * there and no per-node members exist. The moment the real union lands,
		 * that widening becomes both unnecessary and wrong, and this test is
		 * what says so instead of letting it sit there forever.
		 */
		it("is still the only node vocabulary available", () => {
			const core = fs.readFileSync(CORE_DTS_PATH, "utf8");

			assert.match(
				core,
				/export interface ASTNode \{\n(?:[^}]*\n)?\t\/\*\* The node's kind\. Becomes a string-literal discriminant in the union\. \*\/\n\ttype: string;/u,
				"`ASTNode.type` is no longer a bare `string`, so the node union has landed: delete the `Node` and `NodeMembers` typedefs in lib/rules/utils/ast-utils.js and replace every `Node` there with `ASTNode`",
			);
		});

		it("documents its own retirement", () => {
			const source = fs.readFileSync(AST_UTILS_PATH, "utf8");

			assert.include(
				source,
				"RETIREMENT:",
				"the widening must say how it is removed, or it outlives its reason",
			);
		});
	});
});

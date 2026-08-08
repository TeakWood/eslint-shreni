/**
 * @fileoverview Guards the AST node vocabulary decision recorded in
 * `.shreni/design/typescript-types-from-jsdoc.md`.
 *
 * The decision — hand-author the node vocabulary in `lib/types/` rather than
 * adopt `@types/estree` — rests on a set of concrete divergences between what
 * espree actually produces and what `@types/estree` declares. Those are facts
 * about two installed packages, so an upgrade of either can invalidate the
 * reasoning without anybody noticing: the note is markdown, and markdown does
 * not fail CI.
 *
 * These tests re-derive every load-bearing claim from the installed tree and
 * from the real compiler. If `@types/estree` starts declaring `range` as
 * required, or espree stops emitting `Hashbang` comments, the argument for
 * hand-authoring weakens and these tests say so.
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
const espree = require("espree");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DESIGN_NOTE = path.join(
	REPO_ROOT,
	".shreni/design/typescript-types-from-jsdoc.md",
);

/**
 * Where the synthetic probe files are placed. They are never written to disk —
 * the compiler host below serves them from memory — but they need a path
 * inside the repo so that bare specifiers resolve against `node_modules/`.
 */
const PROBE_DIR = path.join(REPO_ROOT, "lib");

/**
 * Mirrors the resolution-relevant options of the shipped gate, including
 * `skipLibCheck`, which `tsconfig.base.json` sets. That flag is not incidental
 * here: it is what makes a failed `declare module "estree"` augmentation
 * silent rather than an error, which is one of the reasons the hybrid
 * candidate was rejected.
 */
const COMPILER_OPTIONS = {
	strict: true,
	skipLibCheck: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
};

/**
 * Compiles synthetic TypeScript sources against the installed `node_modules`.
 *
 * Sources are served from memory so the test leaves nothing behind, but the
 * containing directory is real, so `import ... from "estree"` resolves exactly
 * as it would for a file in `lib/`.
 * @param {Record<string, string>} files Probe file name to contents.
 * @param {ts.CompilerOptions} [overrides] Compiler options to merge in.
 * @returns {{program: ts.Program, diagnostics: ts.Diagnostic[], fileName: (name: string) => string}} The compiled program and its diagnostics.
 */
function compile(files, overrides = {}) {
	const options = { ...COMPILER_OPTIONS, ...overrides };

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

	const host = ts.createCompilerHost(options, true);
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

	const program = ts.createProgram([...contents.keys()], options, host);

	/*
	 * Only semantic and syntactic diagnostics are collected. Global
	 * diagnostics would include unrelated `lib` noise from the ambient
	 * environment, which says nothing about the probe.
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
 * Reads the string-literal members of a union type declared in a probe.
 *
 * Used to enumerate `Node["type"]` and `Comment["type"]` out of
 * `@types/estree` rather than restating them, so an upgrade that adds or
 * removes a node type is picked up automatically.
 * @param {string} expression The type expression to expand.
 * @returns {string[]} The sorted literal members.
 */
function literalUnionMembers(expression) {
	const probe = "ast-vocabulary-union-probe.ts";
	const { program, fileName } = compile({
		[probe]: `import type * as ESTree from "estree";\ndeclare const probed: ${expression};\nexport { probed };\n`,
	});
	const checker = program.getTypeChecker();
	const source = program.getSourceFile(fileName(probe));

	let members = null;

	ts.forEachChild(source, node => {
		if (!ts.isVariableStatement(node)) {
			return;
		}
		for (const declaration of node.declarationList.declarations) {
			const type = checker.getTypeAtLocation(declaration.name);
			const parts = type.isUnion() ? type.types : [type];

			members = parts
				.map(part => checker.typeToString(part).replace(/"/gu, ""))
				.sort();
		}
	});

	assert.isNotNull(members, `Failed to expand the type \`${expression}\`.`);

	return members;
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("AST node vocabulary decision", () => {
	const note = fs.readFileSync(DESIGN_NOTE, "utf8");

	describe("what espree produces versus what @types/estree declares", () => {
		let espreeTypes, estreeTypes;

		before(() => {
			espreeTypes = Object.keys(espree.Syntax).sort();
			estreeTypes = literalUnionMembers("ESTree.Node['type']");
		});

		it("estree's node vocabulary is a strict subset of espree's", () => {
			const missingFromEspree = estreeTypes.filter(
				type => !espreeTypes.includes(type),
			);

			assert.deepStrictEqual(
				missingFromEspree,
				[],
				"@types/estree now declares node types espree cannot produce. The divergence table in the design note lists only espree-side extras and needs a second column.",
			);
		});

		it("espree produces node types estree does not declare", () => {
			const extras = espreeTypes.filter(
				type => !estreeTypes.includes(type),
			);

			assert.isAbove(
				extras.length,
				0,
				"espree and @types/estree now agree on the node vocabulary. Divergence #6 in the design note is stale — re-open the decision.",
			);

			/*
			 * Recorded rather than merely counted: the JSX block is the part
			 * that makes the estree union unusable as ESLint's vocabulary, and
			 * a silent change in this set should be read before it is accepted.
			 */
			for (const expected of [
				"JSXElement",
				"JSXFragment",
				"JSXIdentifier",
				"ImportAttribute",
			]) {
				assert.include(
					extras,
					expected,
					`espree no longer reports ${expected} in its Syntax vocabulary.`,
				);
			}
		});

		it("estree's Comment type cannot express espree's Hashbang", () => {
			const commentTypes = literalUnionMembers("ESTree.Comment['type']");

			assert.notInclude(
				commentTypes,
				"Hashbang",
				"@types/estree now declares Hashbang comments. Divergence #7 in the design note is resolved upstream.",
			);
		});

		it("espree really does emit Hashbang comments", () => {
			const ast = espree.parse("#!/usr/bin/env node\nx;\n", {
				ecmaVersion: "latest",
				comment: true,
				range: true,
				loc: true,
			});

			assert.include(
				ast.comments.map(comment => comment.type),
				"Hashbang",
				"espree stopped emitting Hashbang comments, so divergence #7 no longer bites.",
			);
		});

		it("espree really does emit a commonjs sourceType", () => {
			const ast = espree.parse("x;", {
				ecmaVersion: "latest",
				sourceType: "commonjs",
			});

			assert.strictEqual(ast.sourceType, "commonjs");
			assert.notInclude(
				literalUnionMembers("ESTree.Program['sourceType']"),
				"commonjs",
				"@types/estree now allows a commonjs sourceType. Divergence #8 in the design note is resolved upstream.",
			);
		});

		it("espree attaches range and loc to every node, which estree makes optional", () => {
			const ast = espree.parse("if (a) { b; }", {
				ecmaVersion: "latest",
				range: true,
				loc: true,
			});

			assert.isArray(ast.range);
			assert.isObject(ast.loc);

			/*
			 * This is divergence #1/#2, and it is the expensive one: `lib/`
			 * dereferences `.range` and `.loc` unconditionally at well over a
			 * thousand sites, none of which compile against an optional field.
			 */
			const { diagnostics } = compile({
				"ast-vocabulary-optional-probe.ts": [
					'import type { Node } from "estree";',
					"export function startOf(node: Node): number {",
					"\treturn node.range[0];",
					"}",
					"export function startLine(node: Node): number {",
					"\treturn node.loc.start.line;",
					"}",
					"",
				].join("\n"),
			});

			assert.deepStrictEqual(
				diagnostics.map(diagnostic => diagnostic.code).sort(),
				[18048, 18049],
				`Expected @types/estree's optional range and loc to reject an unconditional read. Got:\n${format(diagnostics)}`,
			);
		});
	});

	describe("candidate (a) — @types/estree adopted directly", () => {
		it("fails on the shapes lib/ actually contains", () => {
			const { diagnostics } = compile({
				"ast-vocabulary-candidate-a.ts": [
					'import type { Node } from "estree";',

					// ~985 `.parent` reads across lib/.
					"export function isCallee(node: Node): boolean {",
					'\treturn node.parent.type === "CallExpression";',
					"}",

					// espree emits JSX when ecmaFeatures.jsx is on.
					"export function isJSX(node: Node): boolean {",
					'\treturn node.type === "JSXElement";',
					"}",

					// ast-utils.js references TS-ESTree node types at 14 sites.
					"export function isTSNode(node: Node): boolean {",
					'\treturn node.type === "TSPropertySignature";',
					"}",
					"",
				].join("\n"),
			});

			const codes = diagnostics.map(diagnostic => diagnostic.code).sort();

			assert.deepStrictEqual(
				codes,
				[2339, 2367, 2367],
				`Expected @types/estree to reject node.parent and the JSX/TS-ESTree comparisons. Got:\n${format(diagnostics)}`,
			);
		});
	});

	describe("candidate (c) — the estree hybrid", () => {
		it("cannot strengthen range from optional to required, and says nothing under skipLibCheck", () => {
			const files = {
				"ast-vocabulary-augment.d.ts": [
					/*
					 * The top-level import is what makes this file a module, and
					 * therefore makes the block below a module *augmentation*.
					 * Without it, `declare module "estree"` is an ambient module
					 * declaration that replaces the real one outright.
					 */
					'import type * as ESTree from "estree";',
					"export type { ESTree };",
					'declare module "estree" {',
					"\tinterface BaseNodeWithoutComments {",
					"\t\trange: [number, number];",
					"\t}",
					"}",
					"",
				].join("\n"),
				"ast-vocabulary-augment-use.ts": [
					'import type { Node } from "estree";',
					'import "./ast-vocabulary-augment.d.ts";',
					"export function startOf(node: Node): number {",
					"\treturn node.range[0];",
					"}",
					"",
				].join("\n"),
			};

			const withSkipLibCheck = compile(files, {
				allowImportingTsExtensions: true,
			});

			/*
			 * The augmentation does not apply — `range` is still optional — and
			 * the only diagnostic is at the use site. Nothing points at the
			 * augmentation itself, so an author reading a green build would
			 * conclude the declaration took effect.
			 */
			assert.deepStrictEqual(
				withSkipLibCheck.diagnostics.map(diagnostic => diagnostic.code),
				[18048],
				`Expected the augmentation to be silently ignored under skipLibCheck. Got:\n${format(withSkipLibCheck.diagnostics)}`,
			);

			const withoutSkipLibCheck = compile(files, {
				allowImportingTsExtensions: true,
				skipLibCheck: false,
			});

			/*
			 * With `skipLibCheck: false` the compiler does explain itself
			 * (TS2717 / TS2687). The shipped gate sets `skipLibCheck: true`,
			 * which is why the hybrid's failure mode is silence.
			 */
			assert.include(
				withoutSkipLibCheck.diagnostics.map(
					diagnostic => diagnostic.code,
				),
				2717,
				`Expected TS2717 once lib checking is on. Got:\n${format(withoutSkipLibCheck.diagnostics)}`,
			);

			/*
			 * Read with TypeScript's own parser rather than `require()`:
			 * `tsconfig.base.json` carries comments, so it is JSONC.
			 */
			const baseConfig = ts.readConfigFile(
				path.join(REPO_ROOT, "tsconfig.base.json"),
				ts.sys.readFile,
			);

			assert.isUndefined(
				baseConfig.error,
				"tsconfig.base.json could not be parsed.",
			);
			assert.strictEqual(
				baseConfig.config.compilerOptions.skipLibCheck,
				true,
				"tsconfig.base.json no longer sets skipLibCheck. The hybrid candidate was rejected partly because that flag hides a broken augmentation — re-check the reasoning.",
			);
		});

		it("does not carry ESLint's additions into child nodes when the union is intersected", () => {
			const { diagnostics } = compile({
				"ast-vocabulary-candidate-c.ts": [
					'import type * as ESTree from "estree";',
					"type ESLintNode = ESTree.Node & {",
					"\tparent: ESLintNode;",
					"\trange: [number, number];",
					"};",

					// The node itself is fine...
					"export function self(node: ESLintNode): number {",
					"\treturn node.range[0];",
					"}",

					// ...but a child reached by field access is a plain estree node.
					"export function child(node: ESLintNode): number {",
					'\tif (node.type === "IfStatement") {',
					"\t\treturn node.test.range[0];",
					"\t}",
					"\treturn 0;",
					"}",
					"",
				].join("\n"),
			});

			assert.deepStrictEqual(
				diagnostics.map(diagnostic => diagnostic.code),
				[18048],
				`Expected the intersection to leave child nodes un-extended. Got:\n${format(diagnostics)}`,
			);
		});
	});

	describe("candidate (b) — the adopted hand-authored vocabulary", () => {
		it("supports every shape the rejected candidates could not", () => {
			const { diagnostics } = compile({
				"ast-vocabulary-candidate-b.ts": [
					"interface Position { line: number; column: number }",
					"interface SourceLocation { start: Position; end: Position }",
					"interface BaseNode {",
					"\trange: [number, number];",
					"\tloc: SourceLocation;",
					"\tparent: Node;",
					"}",
					'interface Identifier extends BaseNode { type: "Identifier"; name: string }',
					'interface ExpressionStatement extends BaseNode { type: "ExpressionStatement"; expression: Node; directive?: string }',
					'interface JSXIdentifier extends BaseNode { type: "JSXIdentifier"; name: string }',
					'interface TSPropertySignature extends BaseNode { type: "TSPropertySignature"; key: Node; computed: boolean }',
					'interface TSMethodSignature extends BaseNode { type: "TSMethodSignature"; key: Node; computed: boolean }',
					"type Node =",
					"\t| Identifier",
					"\t| ExpressionStatement",
					"\t| JSXIdentifier",
					"\t| TSPropertySignature",
					"\t| TSMethodSignature;",

					// 1. range / loc / parent read unconditionally.
					"export function pos(node: Node): number {",
					"\treturn node.range[0] + node.loc.start.line + node.parent.range[1];",
					"}",

					// 2. isDirective — unnarrowable under @types/estree.
					"export function isDirective(node: Node): boolean {",
					'\treturn node.type === "ExpressionStatement" && typeof node.directive === "string";',
					"}",

					// 3. JSX and TS-ESTree comparisons are legal and narrow.
					"export function isJSX(node: Node): boolean {",
					'\treturn node.type === "JSXIdentifier";',
					"}",
					"export function tsKey(node: Node): Node | null {",
					"\tswitch (node.type) {",
					'\t\tcase "TSPropertySignature":',
					'\t\tcase "TSMethodSignature":',
					"\t\t\treturn node.key;",
					"\t\tdefault:",
					"\t\t\treturn null;",
					"\t}",
					"}",
					"",
				].join("\n"),
			});

			assert.deepStrictEqual(
				diagnostics.map(diagnostic => diagnostic.code),
				[],
				`The adopted vocabulary shape no longer compiles clean:\n${format(diagnostics)}`,
			);
		});

		it("stays assignable to estree at the eslint-scope / eslint-utils boundary", () => {
			/*
			 * The hand-authored nodes never reach the compiler as `estree.Node`
			 * by accident — they reach it because `eslint-scope` and
			 * `@eslint-community/eslint-utils` declare their own signatures in
			 * estree's vocabulary. Interop only holds while our shapes mirror
			 * estree's, including its three-way split of `Literal`.
			 */
			const { diagnostics } = compile({
				"ast-vocabulary-interop.ts": [
					'import type * as ESTree from "estree";',
					"interface Base {",
					"\trange: [number, number];",
					"\tloc: ESTree.SourceLocation;",
					"\tparent: Node;",
					"}",
					'interface Identifier extends Base { type: "Identifier"; name: string }',
					'interface SimpleLiteral extends Base { type: "Literal"; value: string | number | boolean | null; raw?: string }',
					'interface RegExpLiteral extends Base { type: "Literal"; value?: RegExp | null; regex: { pattern: string; flags: string }; raw?: string }',
					'interface BigIntLiteral extends Base { type: "Literal"; value?: bigint | null; bigint: string; raw?: string }',
					"type Node = Identifier | SimpleLiteral | RegExpLiteral | BigIntLiteral;",
					"export function toESTree(node: Node): ESTree.Node {",
					"\treturn node;",
					"}",
					"",
				].join("\n"),
			});

			assert.deepStrictEqual(
				diagnostics.map(diagnostic => diagnostic.code),
				[],
				`The hand-authored vocabulary is no longer assignable to estree's, which breaks interop with eslint-scope and eslint-utils:\n${format(diagnostics)}`,
			);
		});

		it("cannot use an open fallback member, which is why the union is closed", () => {
			/*
			 * The obvious way to keep the vocabulary open — a member whose
			 * `type` is `string` — destroys narrowing on every other member,
			 * so third-party node types are declared individually instead.
			 */
			const { diagnostics } = compile({
				"ast-vocabulary-open-union.ts": [
					"interface Base { range: [number, number] }",
					'interface Identifier extends Base { type: "Identifier"; name: string }',
					"interface UnknownNode extends Base { type: string }",
					"type Node = Identifier | UnknownNode;",
					"export function name(node: Node): string {",
					'\treturn node.type === "Identifier" ? node.name : "";',
					"}",
					"",
				].join("\n"),
			});

			assert.deepStrictEqual(
				diagnostics.map(diagnostic => diagnostic.code),
				[2339],
				`Expected an open fallback member to defeat narrowing. Got:\n${format(diagnostics)}`,
			);
		});
	});

	describe("the real consumers the decision was validated against", () => {
		it("ast-utils.js still references TS-ESTree node types", () => {
			const astUtils = fs.readFileSync(
				path.join(REPO_ROOT, "lib/rules/utils/ast-utils.js"),
				"utf8",
			);
			const referenced = [
				...new Set(
					[...astUtils.matchAll(/\bTS[A-Z][A-Za-z]+\b/gu)].map(
						match => match[0],
					),
				),
			];

			assert.isAbove(
				referenced.length,
				0,
				"ast-utils.js no longer references TS-ESTree node types. The vocabulary no longer needs to declare them, and the argument against a pure espree union weakens.",
			);
		});

		it("code-path-analyzer.js still shares case bodies across node types", () => {
			const analyzer = fs.readFileSync(
				path.join(
					REPO_ROOT,
					"lib/linter/code-path-analysis/code-path-analyzer.js",
				),
				"utf8",
			);

			/*
			 * The `AssignmentPattern` arm of `isIdentifierReference` reads a
			 * `key` property that no AssignmentPattern has. It is recorded in
			 * the design note as a latent defect the vocabulary surfaces; this
			 * assertion fails once it is fixed, which is the cue to drop that
			 * paragraph from the note.
			 */
			assert.include(
				analyzer,
				'case "AssignmentPattern":\n\t\t\treturn parent.key !== node;',
				"The AssignmentPattern arm of isIdentifierReference has changed. If it was fixed, remove the latent-defect paragraph from the design note.",
			);
		});
	});

	describe("the design note", () => {
		it("records the decision and the rejected alternatives", () => {
			/*
			 * Matched as whole heading lines, not substrings: a prefix match
			 * would still pass after a heading is renamed, which is exactly
			 * the drift this test exists to catch.
			 */
			const headings = new Set(
				[...note.matchAll(/^#{2,3} .+$/gmu)].map(match =>
					match[0].trim(),
				),
			);

			for (const required of [
				"## Phase 0 spike — the AST node vocabulary decision",
				"### Divergences, enumerated",
				"### Candidate (a) — adopt `@types/estree` directly: rejected",
				"### Candidate (c) — an estree hybrid: rejected in all three forms",
				"### Candidate (b) — hand-authored: adopted",
				"### The `node.type` discrimination strategy",
				"### `@types/estree` stays an explicit devDependency",
				"### Consistency with not adopting `@eslint/core`",
			]) {
				assert.isTrue(
					headings.has(required),
					`The design note is missing the "${required}" section.`,
				);
			}
		});

		it("classifies every enumerated divergence as additive or contradictory", () => {
			/*
			 * Column padding is not fixed — Prettier reflows markdown tables to
			 * align the pipes whenever the longest cell changes — so this
			 * matches on structure and tolerates the whitespace.
			 */
			const rowPattern =
				/^\|\s*(?<index>\d+)\s*\|(?<cells>.*)\|\s*(?<classification>additive|contradictory)\s*\|\s*$/gmu;
			const rows = [...note.matchAll(rowPattern)];

			assert.isAbove(
				rows.length,
				0,
				"No classified divergence rows were found. Has the table format changed?",
			);

			assert.deepStrictEqual(
				rows.map(row => Number(row.groups.index)),
				rows.map((_, index) => index + 1),
				"The divergence table's index column is not contiguous from 1.",
			);
		});
	});
});

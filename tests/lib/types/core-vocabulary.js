/**
 * @fileoverview Guards the rule/config half of `lib/types/core.d.ts`.
 *
 * `npm run lint:types` cannot validate any of these declarations. The gate is a
 * `files` allowlist, and none of the modules these types describe —
 * `linter.js`, `config.js`, `source-code.js`, `rule-fixer.js` — is in it yet;
 * they are converted by later beads. A vocabulary authored ahead of its
 * consumers compiles clean by construction, so `tsc` being green says nothing
 * about whether the shapes are right.
 *
 * These tests close that gap two ways.
 *
 * 1. COMPILE PROBES, deliberately two-sided. Every positive probe is paired
 *    with a negative one, because a declaration that had widened to `any` would
 *    satisfy the positive probe just as happily as a correct one. The negative
 *    is the assertion that the type constrains something.
 * 2. RE-DERIVATION. Where a declared shape is a claim about an implementation —
 *    `RuleFixer`'s method list, `LinterOptions`' keys, `SourceType`'s values —
 *    the claim is recomputed from the implementation on every run, so the
 *    declaration fails loudly the day the code moves underneath it rather than
 *    drifting silently.
 *
 * @author Silpi
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { assert } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const espree = require("espree");

const { flatConfigSchema } = require("../../../lib/config/flat-config-schema");
const {
	validateLanguageOptions,
} = require("../../../lib/languages/js/validate-language-options");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CORE_DTS = path.join(REPO_ROOT, "lib/types/core.d.ts");
const RULE_FIXER_JS = path.join(REPO_ROOT, "lib/linter/rule-fixer.js");
const SOURCE_CODE_JS = path.join(
	REPO_ROOT,
	"lib/languages/js/source-code/source-code.js",
);

/**
 * Probes are served from memory but need a path inside `lib/` so that
 * `./types/core.js` and bare specifiers resolve exactly as they would for a
 * real source file.
 */
const PROBE_DIR = path.join(REPO_ROOT, "lib");

/**
 * Mirrors the resolution-relevant options of the shipped gate
 * (`tsconfig.base.json`).
 */
const COMPILER_OPTIONS = {
	strict: true,
	skipLibCheck: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

/**
 * Compiles synthetic TypeScript sources against the installed `node_modules`,
 * with the real `core.d.ts` in the program.
 * @param {Record<string, string>} files Probe file name to contents.
 * @returns {{program: ts.Program, diagnostics: ts.Diagnostic[]}} The compiled
 * program and its diagnostics.
 */
function compile(files) {
	const contents = new Map(
		Object.entries(files).map(([name, text]) => [
			path.join(PROBE_DIR, name),
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

	const program = ts.createProgram(
		[CORE_DTS, ...contents.keys()],
		COMPILER_OPTIONS,
		host,
	);

	const diagnostics = [
		...program.getSyntacticDiagnostics(),
		...program.getSemanticDiagnostics(),
	];

	return { program, diagnostics };
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
 * Wraps probe source in the import every probe needs.
 * @param {string} names The vocabulary names to import.
 * @param {string} body The probe body.
 * @returns {string} The probe source.
 */
function probe(names, body) {
	return `import type { ${names} } from "./types/core.js";\n${body}\nexport {};\n`;
}

/**
 * Compiles a probe and asserts it produces no diagnostics.
 * @param {string} names The vocabulary names to import.
 * @param {string} body The probe body.
 * @returns {void}
 */
function expectClean(names, body) {
	const { diagnostics } = compile({ "__probe.ts": probe(names, body) });

	assert.strictEqual(
		diagnostics.length,
		0,
		`probe was expected to compile clean but did not:\n${format(diagnostics)}`,
	);
}

/**
 * Compiles a probe and asserts the compiler rejected it with a given error.
 *
 * This is the vacuity half of every pair: a declaration widened to `any` would
 * accept the probe, so the rejection is the assertion.
 * @param {string} names The vocabulary names to import.
 * @param {string} body The probe body.
 * @param {number} code The expected TypeScript error code.
 * @returns {void}
 */
function expectError(names, body, code) {
	const { diagnostics } = compile({ "__probe.ts": probe(names, body) });

	assert.isNotEmpty(
		diagnostics,
		"probe was expected to be rejected but compiled clean, so the declaration is not constraining anything",
	);
	assert.includeMembers(
		diagnostics.map(diagnostic => diagnostic.code),
		[code],
		`probe was rejected, but not for the expected reason:\n${format(diagnostics)}`,
	);
}

/** A program containing only `core.d.ts`, for reading the declarations back. */
const coreProgram = ts.createProgram([CORE_DTS], COMPILER_OPTIONS);
const coreChecker = coreProgram.getTypeChecker();
const coreExports = coreChecker.getExportsOfModule(
	coreChecker.getSymbolAtLocation(coreProgram.getSourceFile(CORE_DTS)),
);

/**
 * Looks up an exported type by name.
 * @param {string} name The exported type name.
 * @returns {ts.Type} The declared type.
 */
function declaredType(name) {
	const symbol = coreExports.find(exported => exported.getName() === name);

	assert.isDefined(symbol, `core.d.ts does not export "${name}"`);

	return coreChecker.getDeclaredTypeOfSymbol(symbol);
}

/**
 * The property names of an exported interface.
 * @param {string} name The exported interface name.
 * @returns {string[]} The property names, sorted.
 */
function memberNamesOf(name) {
	return declaredType(name)
		.getProperties()
		.map(property => property.getName())
		.sort();
}

/**
 * The string-literal members of an exported union type.
 * @param {string} name The exported type alias name.
 * @returns {string[]} The literal values, sorted.
 */
function stringMembersOf(name) {
	const type = declaredType(name);
	const parts = type.isUnion() ? type.types : [type];

	return parts
		.filter(part => part.isStringLiteral())
		.map(part => part.value)
		.sort();
}

/**
 * Whether the real language-options validator rejects a `sourceType`.
 * @param {string} sourceType The value to try.
 * @returns {boolean} `true` if the validator rejected it.
 */
function rejectsSourceType(sourceType) {
	try {
		validateLanguageOptions({ sourceType });
		return false;
	} catch (error) {
		return /Key "sourceType"/u.test(error.message);
	}
}

/**
 * Reads the method names off a class declaration in a JavaScript source file,
 * so a declared surface can be compared against the real one.
 * @param {string} filePath Absolute path to the source file.
 * @param {string} className The class to read.
 * @returns {string[]} The public method names, sorted.
 */
function classMethodNames(filePath, className) {
	const source = ts.createSourceFile(
		filePath,
		fs.readFileSync(filePath, "utf8"),
		ts.ScriptTarget.ES2022,
		true,
	);

	const declaration = source.statements.find(
		statement =>
			ts.isClassDeclaration(statement) &&
			statement.name &&
			statement.name.text === className,
	);

	assert.isDefined(declaration, `${filePath} has no class ${className}`);

	return declaration.members
		.filter(
			member =>
				ts.isMethodDeclaration(member) &&
				ts.isIdentifier(member.name) &&
				!ts.isPrivateIdentifier(member.name),
		)
		.map(member => member.name.text)
		.sort();
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("core type vocabulary", () => {
	describe("exported names", () => {
		/*
		 * The results half landed first and is depended on by the 25 already
		 * annotated sources. Deleting or renaming any of it is a breaking
		 * change that this bead had no licence to make.
		 */
		const RESULTS_HALF = [
			"SourceRange",
			"Position",
			"SourceLocation",
			"SeverityLevel",
			"SeverityName",
			"SeverityString",
			"Severity",
			"EcmaVersion",
			"Fix",
			"LintSuggestion",
			"LintMessage",
			"LintSuppression",
			"SuppressedLintMessage",
			"MessageCounts",
			"LintTimes",
			"LintStats",
			"DeprecatedInfo",
			"DeprecatedRuleUse",
			"LintResult",
		];

		const RULE_CONFIG_HALF = [
			// rules
			"RuleDefinition",
			"RuleModule",
			"RuleContext",
			"RuleFixer",
			"RuleFix",
			"ReportDescriptor",

			// source code and languages
			"SourceCode",
			"Language",
			"LanguageOptions",

			// config
			"Config",
			"ConfigObject",
			"ConfigArrayEntry",

			// parsing and processing
			"Parser",
			"ParserOptions",
			"Processor",

			// formatters
			"Formatter",
		];

		it("still exports every type from the results half", () => {
			const names = coreExports.map(symbol => symbol.getName());

			assert.includeMembers(names, RESULTS_HALF);
		});

		it("exports every type this bead is responsible for", () => {
			const names = coreExports.map(symbol => symbol.getName());

			assert.includeMembers(names, RULE_CONFIG_HALF);
		});

		it("names the formatter contract rather than inlining it", () => {
			const formatter = declaredType("Formatter");

			assert.isNotEmpty(
				formatter.getCallSignatures(),
				"Formatter must be a callable type",
			);
		});
	});

	describe("AST seam", () => {
		/*
		 * Divergences #1 and #2 from the y6r.15 spike, and the entire reason
		 * @types/estree was rejected as the vocabulary. estree declares both
		 * optional; ESLint forces them on. If these ever become optional here,
		 * the 791 `.range` and 573 `.loc` reads across lib/ each need a guard.
		 */
		it("requires range and loc on every node", () => {
			expectClean(
				"ASTNode",
				"declare const node: ASTNode;\nconst start: number = node.range[0];\nconst line: number = node.loc.start.line;\nvoid start;\nvoid line;",
			);
		});

		it("rejects a node that omits range", () => {
			expectError(
				"ASTNode",
				'const node: ASTNode = { type: "Identifier", loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }, parent: null };\nvoid node;',
				2741,
			);
		});

		it("rejects an estree-shaped node, whose range is optional", () => {
			expectError(
				"ASTNode, SourceRange, SourceLocation",
				[
					"declare const estreeish: {",
					"	type: string;",
					"	range?: SourceRange;",
					"	loc: SourceLocation;",
					"	parent: ASTNode | null;",
					"};",
					"const node: ASTNode = estreeish;",
					"void node;",
				].join("\n"),
				2322,
			);
		});

		// Divergence #3: estree has no `parent` at all.
		it("carries parent, and parent reaches back into the vocabulary", () => {
			expectClean(
				"ASTNode",
				"declare const node: ASTNode;\nconst end: number | undefined = node.parent?.range[1];\nvoid end;",
			);
		});

		it("treats parent as nullable rather than always present", () => {
			expectError(
				"ASTNode",
				"declare const node: ASTNode;\nconst end: number = node.parent.range[1];\nvoid end;",
				18047,
			);
		});

		/*
		 * Strategy point 4: tokens and comments are a separate vocabulary, not
		 * members of the node union. A Token has no `parent`, so accepting one
		 * where a node is expected would be a real bug.
		 */
		it("keeps tokens out of the node vocabulary", () => {
			expectError(
				"ASTNode, Token",
				"declare const token: Token;\nconst node: ASTNode = token;\nvoid node;",
				2741,
			);
		});

		it("accepts a token or a comment wherever the fixer takes one", () => {
			expectClean(
				"NodeOrToken, Token, Comment, ASTNode",
				"declare const token: Token;\ndeclare const comment: Comment;\ndeclare const node: ASTNode;\nconst all: NodeOrToken[] = [token, comment, node];\nvoid all;",
			);
		});

		// Divergence #9: estree declares only "script" | "module".
		it('accepts sourceType "commonjs" on the Program root', () => {
			expectClean(
				"Program",
				'declare const program: Program;\nconst isCommonJS = program.sourceType === "commonjs";\nvoid isCommonJS;',
			);
		});

		it("rejects an unknown sourceType", () => {
			expectError(
				"Program",
				'declare const program: Program;\nconst bogus = program.sourceType === "amd";\nvoid bogus;',
				2367,
			);
		});
	});

	describe("rules", () => {
		it("accepts a rule shaped like a real core rule", () => {
			expectClean(
				"RuleDefinition",
				[
					"const rule: RuleDefinition = {",
					'	meta: { type: "problem", docs: { description: "d", recommended: true, url: "u" }, fixable: null, schema: [], messages: { unexpected: "Unexpected." } },',
					"	create(context) {",
					"		return {",
					"			DebuggerStatement(node) {",
					'				context.report({ node, messageId: "unexpected" });',
					"			},",
					"		};",
					"	},",
					"};",
					"void rule;",
				].join("\n"),
			);
		});

		/*
		 * `createRuleListeners` (linter.js:399-407) throws for anything without
		 * a `create` method, so a rule type that accepted one would describe a
		 * rule the linter rejects at runtime.
		 */
		it("rejects a rule with no create method", () => {
			expectError(
				"RuleDefinition",
				'const rule: RuleDefinition = { meta: { type: "problem" } };\nvoid rule;',
				2741,
			);
		});

		it("requires exactly one of message and messageId", () => {
			expectClean(
				"ReportDescriptor, ASTNode",
				'declare const node: ASTNode;\nconst a: ReportDescriptor = { node, message: "m" };\nconst b: ReportDescriptor = { node, messageId: "id" };\nvoid a;\nvoid b;',
			);
		});

		it("rejects a report carrying both message and messageId", () => {
			expectError(
				"ReportDescriptor, ASTNode",
				'declare const node: ASTNode;\nconst descriptor: ReportDescriptor = { node, message: "m", messageId: "id" };\nvoid descriptor;',
				2322,
			);
		});

		it("rejects a report carrying neither a node nor a loc", () => {
			expectError(
				"ReportDescriptor",
				'const descriptor: ReportDescriptor = { message: "m" };\nvoid descriptor;',
				2322,
			);
		});

		/*
		 * normalizeFixes (file-report.js:262-278) tests `Symbol.iterator in fix`
		 * and merges, so generators and arrays are both supported forms. A fixer
		 * type that only allowed a single fix would reject correct rules.
		 */
		it("accepts every form a fix function may return", () => {
			expectClean(
				"ReportFixer, SourceRange",
				[
					'const single: ReportFixer = fixer => fixer.replaceTextRange([0, 1], "x");',
					'const many: ReportFixer = fixer => [fixer.remove({ type: "T", range: [0, 1] as SourceRange, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }, parent: null })];',
					"const none: ReportFixer = () => null;",
					"void single;",
					"void many;",
					"void none;",
				].join("\n"),
			);
		});

		it("rejects a fix function that returns something else", () => {
			expectError(
				"ReportFixer",
				'const bad: ReportFixer = () => "not a fix";\nvoid bad;',
				2322,
			);
		});

		it("narrows a rule's options through the context type parameter", () => {
			expectClean(
				"RuleContext",
				"declare const context: RuleContext<[{ allow: string[] }]>;\nconst allow: string[] = context.options[0].allow;\nvoid allow;",
			);
		});

		it("keeps the rule context frozen", () => {
			expectError(
				"RuleContext",
				'declare const context: RuleContext;\ncontext.id = "other";',
				2540,
			);
		});

		it("supports the legacy positional report call", () => {
			expectClean(
				"RuleContext, ASTNode",
				'declare const context: RuleContext;\ndeclare const node: ASTNode;\ncontext.report(node, "message {{a}}", { a: 1 });',
			);
		});
	});

	describe("source code", () => {
		it("exposes the node accessors rules actually call", () => {
			expectClean(
				"SourceCode, ASTNode",
				[
					"declare const sourceCode: SourceCode;",
					"declare const node: ASTNode;",
					"const text: string = sourceCode.getText(node);",
					"const range = sourceCode.getRange(node);",
					"const first = sourceCode.getFirstToken(node);",
					"const before = sourceCode.getCommentsBefore(node);",
					"const ancestors = sourceCode.getAncestors(node);",
					"void text;",
					"void range;",
					"void first;",
					"void before;",
					"void ancestors;",
				].join("\n"),
			);
		});

		/*
		 * Every token getter can return null when nothing is there. A signature
		 * that promised a Token would send rules straight into a null deref.
		 */
		it("admits that a token getter can find nothing", () => {
			expectError(
				"SourceCode, ASTNode",
				"declare const sourceCode: SourceCode;\ndeclare const node: ASTNode;\nconst value: string = sourceCode.getTokenBefore(node).value;\nvoid value;",
				2531,
			);
		});

		it("accepts the scalar shorthands the token store really takes", () => {
			expectClean(
				"SourceCode, ASTNode",
				[
					"declare const sourceCode: SourceCode;",
					"declare const node: ASTNode;",
					"sourceCode.getTokenBefore(node, 2);",
					'sourceCode.getTokenBefore(node, token => token.type === "Punctuator");',
					"sourceCode.getTokenBefore(node, { includeComments: true, skip: 1 });",
				].join("\n"),
			);
		});

		it("rejects a token-store option the implementation never reads", () => {
			expectError(
				"SourceCode, ASTNode",
				"declare const sourceCode: SourceCode;\ndeclare const node: ASTNode;\nsourceCode.getTokenBefore(node, { includeComments: true, count: 1 });",
				2353,
			);
		});
	});

	describe("config", () => {
		/*
		 * The bead's explicit interop requirement: our config shapes have to be
		 * assignable at the @eslint/config-array boundary, which is where
		 * FlatConfigArray inherits its matching from.
		 */
		it("stays assignable to @eslint/config-array's ConfigObject", () => {
			expectClean(
				"ConfigObject",
				'declare const config: ConfigObject;\nconst upstream: import("@eslint/config-array").ConfigObject = config;\nvoid upstream;',
			);
		});

		it("keeps files and ignores matching the upstream matcher types", () => {
			expectClean(
				"FilesMatcher, FileMatcher",
				[
					'type UpstreamFiles = import("@eslint/config-array").FilesMatcher;',
					'type UpstreamIgnores = import("@eslint/config-array").FileMatcher;',
					"declare const files: FilesMatcher;",
					"declare const ignores: FileMatcher;",
					"const a: UpstreamFiles = files;",
					"const b: UpstreamIgnores = ignores;",
					"void a;",
					"void b;",
				].join("\n"),
			);
		});

		/*
		 * `Omit<ConfigObject, …>` over an index-signature interface collapses
		 * the whole type to bare index signatures, because `keyof` is
		 * `string | number` and `Exclude` removes nothing from it. `Config` is
		 * therefore spelled out; this test is what makes rewriting it with
		 * `Omit` fail instead of silently degrading every property to `unknown`.
		 */
		it("keeps Config's own properties precisely typed", () => {
			expectClean(
				"Config, Language",
				"declare const config: Config;\nconst name: string | undefined = config.name;\nconst language: Language = config.language;\nvoid name;\nvoid language;",
			);
		});

		it("resolves the language and processor rather than naming them", () => {
			expectError(
				"Config",
				"declare const config: Config;\nconst language: string = config.language;\nvoid language;",
				2322,
			);
		});

		it("accepts the nested and function config forms", () => {
			expectClean(
				"ConfigArrayEntry",
				[
					"const configs: ConfigArrayEntry[] = [",
					'	{ files: ["**/*.js"], rules: { "no-debugger": "error" } },',
					'	[{ rules: { semi: ["error", "always"] } }],',
					'	() => ({ rules: { "no-alert": 2 } }),',
					"];",
					"void configs;",
				].join("\n"),
			);
		});

		it("rejects a rule severity outside the accepted set", () => {
			expectError(
				"RulesRecord",
				'const rules: RulesRecord = { "no-debugger": "fatal" };\nvoid rules;',
				2322,
			);
		});
	});

	describe("formatters", () => {
		/*
		 * The built-in formatters demonstrate both arities, and the contract has
		 * to admit both: json.js takes only `results`, stylish.js takes both.
		 */
		it("accepts both built-in formatter arities", () => {
			expectClean(
				"Formatter",
				[
					"const json: Formatter = results => JSON.stringify(results);",
					"const withMeta: Formatter = (results, data) =>",
					"	JSON.stringify({ results, metadata: data });",
					"const stylish: Formatter = (results, data) =>",
					"	`${results.length}${data.color ? 1 : 0}${data.cwd}`;",
					"void json;",
					"void withMeta;",
					"void stylish;",
				].join("\n"),
			);
		});

		it("accepts an async formatter, since the CLI awaits the result", () => {
			expectClean(
				"Formatter",
				"const async: Formatter = async results => JSON.stringify(results);\nvoid async;",
			);
		});

		it("rejects a formatter that does not return a string", () => {
			expectError(
				"Formatter",
				"const bad: Formatter = results => results.length;\nvoid bad;",
				2322,
			);
		});

		it("gives formatters the rule metadata and the max-warnings data", () => {
			expectClean(
				"FormatterContext",
				[
					"declare const context: FormatterContext;",
					'const type = context.rulesMeta["no-debugger"]?.type;',
					"const found: number | undefined =",
					"	context.maxWarningsExceeded?.foundWarnings;",
					"void type;",
					"void found;",
				].join("\n"),
			);
		});
	});

	/*
	 * Everything above asserts a shape. The tests below recompute the shape
	 * from the implementation it claims to describe, so a declaration that goes
	 * stale fails here rather than being believed.
	 */
	describe("re-derived from the implementations", () => {
		it("declares exactly the fixer methods RuleFixer implements", () => {
			assert.deepStrictEqual(
				memberNamesOf("RuleFixer"),
				classMethodNames(RULE_FIXER_JS, "RuleFixer"),
			);
		});

		it("declares exactly the linterOptions keys the schema accepts", () => {
			assert.deepStrictEqual(
				memberNamesOf("LinterOptions"),
				Object.keys(flatConfigSchema.linterOptions.schema).sort(),
			);
		});

		it("declares exactly the sourceType values the validator accepts", () => {
			for (const sourceType of stringMembersOf("SourceType")) {
				assert.isFalse(
					rejectsSourceType(sourceType),
					`"${sourceType}" is declared but the validator rejects it`,
				);
			}

			for (const sourceType of ["amd", "commonJS", ""]) {
				assert.isTrue(
					rejectsSourceType(sourceType),
					`"${sourceType}" is not declared but the validator accepts it`,
				);
			}
		});

		it("declares every token type espree actually emits", () => {
			const source = [
				"#!/usr/bin/env node",
				"const a = 1, b = 'two', c = /re/gu, d = true, e = null;",
				"class C { #p = 1; m() { return `t${a}`; } }",
				"label: for (;;) break label;",
			].join("\n");

			const { tokens } = espree.parse(source, {
				ecmaVersion: 2023,
				sourceType: "script",
				range: true,
				loc: true,
				tokens: true,
				comment: true,
			});

			const observed = [...new Set(tokens.map(token => token.type))];

			assert.isNotEmpty(observed);
			assert.includeMembers(
				stringMembersOf("TokenType"),
				observed,
				"espree emits a token type the vocabulary does not declare",
			);
		});

		/*
		 * Divergence #8. espree emits "Hashbang"; source-code.js rewrites that
		 * node's type in place, and getInlineConfigNodes then tests for the
		 * rewritten value. Both are observable, so both must be declared — and
		 * the rewritten name is read straight out of the implementation so a
		 * rename there fails here.
		 */
		it("declares both the parsed and the rewritten shebang comment type", () => {
			const implementation = fs.readFileSync(SOURCE_CODE_JS, "utf8");
			const rewritten = implementation.match(
				/ast\.comments\[0\]\.type = "(?<name>\w+)";/u,
			);

			assert.isNotNull(
				rewritten,
				"source-code.js no longer rewrites the shebang comment type; re-derive CommentType",
			);

			assert.includeMembers(stringMembersOf("CommentType"), [
				"Line",
				"Block",
				"Hashbang",
				rewritten.groups.name,
			]);
		});
	});
});

/**
 * @fileoverview Consumer-facing probe for the emitted type declarations.
 *
 * This file is never executed. It is type-checked by `npm run test:types`
 * under every supported TypeScript major, and it exists to prove that the
 * `types` conditions in package.json's `exports` map resolve and that the
 * declarations behind them describe a usable API.
 *
 * It deliberately imports through the *package* specifiers (`eslint`,
 * `eslint/config`, ...) rather than through relative paths into `dist/types`,
 * because the specifier is what a consumer writes and the `exports` map is
 * the thing most likely to be mis-wired.
 *
 * @author Navakanth Gandavarapu
 */

import { ESLint, Linter, RuleTester, SourceCode, loadESLint } from "eslint";
import { defineConfig, globalIgnores, includeIgnoreFile } from "eslint/config";
import { Linter as UniversalLinter } from "eslint/universal";
import { builtinRules, shouldUseFlatConfig } from "eslint/use-at-your-own-risk";

//------------------------------------------------------------------------------
// eslint — ESLint
//------------------------------------------------------------------------------

const eslint = new ESLint({ cwd: process.cwd(), fix: true });

async function lintTextReturnsResults(): Promise<void> {
	const results = await eslint.lintText("var foo = 1;", {
		filePath: "example.js",
	});

	for (const result of results) {
		const filePath: string = result.filePath;
		const errorCount: number = result.errorCount;

		for (const message of result.messages) {
			const ruleId: string | null = message.ruleId;
			const line: number = message.line;

			void ruleId;
			void line;
		}

		void filePath;
		void errorCount;
	}

	const formatter = await eslint.loadFormatter("json");
	const output: string = await formatter.format(results);

	void output;

	await ESLint.outputFixes(results);
}

async function lintFilesReturnsResults(): Promise<void> {
	const results = await eslint.lintFiles(["lib/**/*.js"]);

	void ESLint.getErrorResults(results);
}

const eslintVersion: string = ESLint.version;

//------------------------------------------------------------------------------
// eslint — loadESLint
//------------------------------------------------------------------------------

async function loadESLintReturnsConstructor(): Promise<void> {
	const LoadedESLint = await loadESLint();

	void new LoadedESLint({ cwd: process.cwd() });
}

//------------------------------------------------------------------------------
// eslint — Linter
//------------------------------------------------------------------------------

const linter = new Linter({ cwd: process.cwd() });

const messages = linter.verify("var foo = 1;", {
	rules: { semi: "error" },
});

const firstMessageText: string | undefined = messages[0]?.message;

const fixReport = linter.verifyAndFix("var foo = 1", {
	rules: { semi: "error" },
});

const fixedOutput: string = fixReport.output;

//------------------------------------------------------------------------------
// eslint — RuleTester
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
	languageOptions: { ecmaVersion: 2022 },
});

ruleTester.run("no-op", builtinRules.get("no-debugger")!, {
	valid: ["var foo = 1;"],
	invalid: [
		{
			code: "debugger;",
			errors: [{ messageId: "unexpected" }],
		},
	],
});

//------------------------------------------------------------------------------
// eslint — SourceCode
//------------------------------------------------------------------------------

function inspectSourceCode(sourceCode: SourceCode): void {
	const text: string = sourceCode.getText();
	const lines: string[] = sourceCode.lines;
	const comments = sourceCode.getAllComments();

	void text;
	void lines;
	void comments;
}

//------------------------------------------------------------------------------
// eslint/config
//------------------------------------------------------------------------------

const config = defineConfig([
	globalIgnores(["dist/**"]),
	{
		files: ["**/*.js"],
		rules: { semi: "error" },
	},
]);

const ignoresFromFile = includeIgnoreFile(`${process.cwd()}/.gitignore`);

//------------------------------------------------------------------------------
// eslint/universal
//------------------------------------------------------------------------------

const universalLinter = new UniversalLinter();

const universalMessages = universalLinter.verify("var foo = 1;", {
	rules: { semi: "error" },
});

//------------------------------------------------------------------------------
// eslint/use-at-your-own-risk
//------------------------------------------------------------------------------

const ruleCount: number = builtinRules.size;

async function resolvesFlatConfigUsage(): Promise<void> {
	const useFlatConfig: boolean = await shouldUseFlatConfig();

	void useFlatConfig;
}

//------------------------------------------------------------------------------
// Keep every binding referenced so `noUnusedLocals` stays meaningful.
//------------------------------------------------------------------------------

void lintTextReturnsResults;
void lintFilesReturnsResults;
void loadESLintReturnsConstructor;
void resolvesFlatConfigUsage;
void inspectSourceCode;
void eslintVersion;
void firstMessageText;
void fixedOutput;
void ruleTester;
void config;
void ignoresFromFile;
void universalMessages;
void ruleCount;

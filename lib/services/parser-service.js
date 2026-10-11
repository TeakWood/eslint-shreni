// @ts-check
/**
 * @fileoverview ESLint Parser
 * @author Nicholas C. Zakas
 */
/* eslint class-methods-use-this: off -- Anticipate future constructor arguments. */

"use strict";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/** @typedef {import("../config/config.js").ConfigWithCopiedKeys} ResolvedConfig */
/** @typedef {import("../linter/vfile.js").VFile} VFile */
/** @typedef {import("../shared/types.js").LanguageOptions} LanguageOptions */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */

/**
 * An error a language's parser reports when it cannot parse a file.
 * @typedef {Object} LanguageParseError
 * @property {string} message The message describing the problem.
 * @property {number} [line] The 1-based line the problem is on.
 * @property {number} [column] The 1-based column the problem is at.
 */

/**
 * What a language's `parse()` hands back: either the parsed AST or the errors
 * that stopped it. The AST is language-defined, so it stays `any`.
 * @typedef {{ ok: true, ast: any } | { ok: false, errors: LanguageParseError[] }} LanguageParseResult
 */

/**
 * The part of a language this service uses.
 *
 * Declared here rather than taken from `lib/shared/types.js`, whose `Language`
 * describes what `lib/config/` reads; the same split is why `lib/linter/`
 * carries `LocationLanguage` and `TraversableLanguage`. The source code object
 * is `any` because every language defines its own.
 * @typedef {Object} ParsingLanguage
 * @property {(file: VFile, context: { languageOptions: LanguageOptions }) => LanguageParseResult} parse Parses the file.
 * @property {(file: VFile, parseResult: LanguageParseResult, context: { languageOptions: LanguageOptions }) => any} createSourceCode Wraps a successful parse result in a source code object.
 */

/**
 * The outcome of {@link ParserService.parseSync}.
 * @typedef {{ ok: true, sourceCode: any } | { ok: false, errors: LintMessage[] }} ParseSyncResult
 */

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The parser for ESLint.
 */
class ParserService {
	/**
	 * Parses the given file synchronously.
	 * @param {VFile} file The file to parse.
	 * @param {ResolvedConfig} config The configuration to use.
	 * @returns {ParseSyncResult} An object with the parsed source code or errors.
	 * @throws {Error} If the parser returns a promise.
	 */
	parseSync(file, config) {
		const { languageOptions } = config;

		/*
		 * `Config#language` is `string | Language` because the constructor
		 * resolves the config's `"plugin/name"` string into the language object
		 * in place, and the hub's `Language` stops short of the parsing members.
		 */
		const language = /** @type {ParsingLanguage} */ (
			/** @type {unknown} */ (config.language)
		);
		const result = language.parse(file, { languageOptions });

		/*
		 * A language is contracted to parse synchronously, so the result type
		 * has no `then`. This guard exists for the language that breaks that
		 * contract, which is why it reads the property through a view.
		 */
		const thenable = /** @type {{ then?: unknown }} */ (
			/** @type {unknown} */ (result)
		);

		if (typeof thenable.then === "function") {
			throw new Error("Unsupported: Language parser returned a promise.");
		}

		if (result.ok) {
			return {
				ok: true,
				sourceCode: language.createSourceCode(file, result, {
					languageOptions,
				}),
			};
		}

		// if we made it to here there was an error
		return {
			ok: false,
			errors: result.errors.map(error => ({
				ruleId: null,
				fatal: true,
				severity: 2,
				message: `Parsing error: ${error.message}`,
				line: error.line,
				column: error.column,
			})),
		};
	}
}

module.exports = { ParserService };

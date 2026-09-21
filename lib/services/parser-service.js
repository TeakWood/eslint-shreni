/**
 * @fileoverview ESLint Parser
 * @author Nicholas C. Zakas
 */

// @ts-check
/* eslint class-methods-use-this: off -- Anticipate future constructor arguments. */

"use strict";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../linter/vfile.js").VFile} VFile */

/*
 * A language and the source code object it produces both come from whichever
 * plugin claimed the file, so neither shape is knowable here. The linter models
 * them the same way (see `LinterLanguage` / `LinterSourceCode`), and pinning
 * either one would only force a cast at every call site without making a single
 * read safer.
 */

/**
 * A `Language` object, as contributed by a plugin.
 * @typedef {Record<string, any>} Language
 */

/**
 * The subset of a resolved config this service reads.
 * @typedef {Object} ParseConfig
 * @property {Language} [language] The language that owns the file.
 * @property {Record<string, any>} [languageOptions] The options to parse with.
 */

/**
 * The outcome of a parse: either a source code object or the errors that
 * prevented one from being built.
 * @typedef {{ ok: true, sourceCode: any } | { ok: false, errors: Array<LintMessage> }} ParseResult
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
	 * @param {ParseConfig} config The configuration to use.
	 * @returns {ParseResult} An object with the parsed source code or errors.
	 * @throws {Error} If the parser returns a promise.
	 */
	parseSync(file, config) {
		const { languageOptions } = config;

		/*
		 * A file only reaches the parser once a language has claimed it, so the
		 * config always carries one by the time this runs.
		 */
		const language = /** @type {Language} */ (config.language);
		const result = language.parse(file, { languageOptions });

		if (typeof result.then === "function") {
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
			errors: result.errors.map((/** @type {any} */ error) => ({
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

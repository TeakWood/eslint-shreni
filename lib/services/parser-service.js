/**
 * @fileoverview ESLint Parser
 * @author Nicholas C. Zakas
 */
/* eslint class-methods-use-this: off -- Anticipate future constructor arguments. */

"use strict";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The parser for ESLint.
 */
class ParserService {
	/**
	 * Parses the given file synchronously.
	 * @param file The file to parse.
	 * @param config The configuration to use.
	 * @returns An object with the parsed source code or errors.
	 * @throws If the parser returns a promise.
	 */
	parseSync(file, config) {
		const { language, languageOptions } = config;
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

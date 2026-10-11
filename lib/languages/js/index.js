// @ts-check
/**
 * @fileoverview JavaScript Language Object
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const { SourceCode } = require("./source-code");
const createDebug = require("debug");
const astUtils = require("../../shared/ast-utils");
const espree = require("espree");
const eslintScope = require("eslint-scope");
const evk = require("eslint-visitor-keys");
const { validateLanguageOptions } = require("./validate-language-options");
const { LATEST_ECMA_VERSION } = require("../../../conf/ecma-version");

//-----------------------------------------------------------------------------
// Type Definitions
//-----------------------------------------------------------------------------

/** @typedef {import("@eslint/core").File} File */
/** @typedef {import("eslint-scope").ScopeManager} ScopeManager */
/** @typedef {import("eslint-visitor-keys").VisitorKeys} VisitorKeys */
/** @typedef {import("../../shared/types.js").GlobalConf} GlobalConf */

/**
 * The root node a parser produced. Custom parsers may return any AST, so this
 * stays open rather than being pinned to ESTree's `Program` — the same
 * reasoning as `TraversableNode` in `lib/shared/traverser.js`.
 * @typedef {{ type: string, [key: string]: any }} RootNode
 */

/**
 * A parser, which must provide one of the two entry points.
 * `./validate-language-options.js` enforces that at config time.
 * @typedef {Object} Parser
 * @property {(text: string, options: Record<string, any>) => RootNode} [parse] Returns just an AST.
 * @property {(text: string, options: Record<string, any>) => { ast: RootNode, services?: Record<string, any>, visitorKeys?: VisitorKeys, scopeManager?: ScopeManager }} [parseForESLint] Returns an AST plus the extra information ESLint can use.
 */

/**
 * The `languageOptions` this language accepts.
 *
 * Every key is optional because a config contributes only the keys it sets;
 * `defaultLanguageOptions` below supplies the rest, so by the time
 * `parse()` runs, `sourceType`, `ecmaVersion`, `parser` and `parserOptions`
 * are all present.
 * @typedef {Object} JSLanguageOptions
 * @property {number | "latest"} [ecmaVersion] The ECMAScript version to parse with.
 * @property {"script" | "module" | "commonjs"} [sourceType] How to interpret the file.
 * @property {Record<string, GlobalConf>} [globals] The globals to declare in the global scope.
 * @property {Parser} [parser] The parser to parse the file with.
 * @property {Record<string, any>} [parserOptions] The options to pass through to the parser.
 */

/**
 * The language options after `defaultLanguageOptions` below has been merged in
 * and `normalizeLanguageOptions()` has run, which is what the core hands to
 * `parse()` and `createSourceCode()`: the four keys the defaults fill are
 * present, and `ecmaVersion` is a year rather than `"latest"`.
 *
 * `normalizeLanguageOptions()` itself takes the partial `JSLanguageOptions`,
 * not this: the `Language` shape in `lib/shared/types.js` declares the method
 * as a function property, so a parameter with required keys would stop the
 * language object from being assignable to it.
 * @typedef {JSLanguageOptions & { ecmaVersion: number, sourceType: "script" | "module" | "commonjs", parser: Parser, parserOptions: Record<string, any> }} NormalizedJSLanguageOptions
 */

/**
 * The context object the core passes to `parse()` and `createSourceCode()`.
 * @typedef {{ languageOptions: NormalizedJSLanguageOptions }} LanguageContext
 */

/**
 * A parse error, which the core turns into a fatal lint message.
 *
 * `@eslint/core`'s `FileError` declares `line` and `column` as required, but a
 * custom parser can throw a plain `Error` carrying neither. Nothing downstream
 * needs them: `lib/services/parser-service.js` copies both straight onto the
 * message, whose `line` and `column` are already `number | undefined`.
 * @typedef {{ message: string, line?: number, column?: number }} ParseError
 */

/**
 * The result of a successful parse, as `createSourceCode()` consumes it.
 * @typedef {Object} OkParseResult
 * @property {true} ok Indicates that the file parsed.
 * @property {RootNode} ast The AST the parser produced.
 * @property {Record<string, any>} parserServices The extra services the parser provided, or an empty object.
 * @property {VisitorKeys} visitorKeys The visitor keys to traverse the AST with.
 * @property {ScopeManager} [scopeManager] The scopes the parser analyzed. Absent when the parser does not analyze scope, in which case `createSourceCode()` analyzes it.
 */

/**
 * The result of a parse that failed. A parsing error is reported as a fatal
 * lint message rather than thrown, so this is a return value and not an
 * exception.
 * @typedef {{ ok: false, errors: ParseError[] }} NotOkParseResult
 */

/** @typedef {OkParseResult | NotOkParseResult} ParseResult */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const debug = createDebug("eslint:languages:js");
const DEFAULT_ECMA_VERSION = 5;
const parserSymbol = Symbol.for("eslint.RuleTester.parser");

/**
 * Analyze scope of the given AST.
 * @param {RootNode} ast The `Program` node to analyze.
 * @param {NormalizedJSLanguageOptions} languageOptions The parser options.
 * @param {VisitorKeys} [visitorKeys] The visitor keys.
 * @returns {ScopeManager} The analysis result.
 */
function analyzeScope(ast, languageOptions, visitorKeys) {
	const parserOptions = languageOptions.parserOptions;
	const ecmaFeatures = parserOptions.ecmaFeatures || {};
	const ecmaVersion = languageOptions.ecmaVersion || DEFAULT_ECMA_VERSION;

	return eslintScope.analyze(
		/*
		 * `eslint-scope` declares this against ESTree's node union, which a
		 * custom parser's AST is not (see `RootNode`).
		 */
		/** @type {import("estree").Program} */ (ast),
		{
			ignoreEval: true,
			nodejsScope: ecmaFeatures.globalReturn,
			impliedStrict: ecmaFeatures.impliedStrict,
			ecmaVersion: typeof ecmaVersion === "number" ? ecmaVersion : 6,
			sourceType: languageOptions.sourceType || "script",
			childVisitorKeys: visitorKeys || evk.KEYS,

			/*
			 * `eslint-visitor-keys` declares `getKeys` as returning
			 * `readonly string[]`, while eslint-scope asks for a mutable array.
			 * Each call builds a fresh array that eslint-scope only reads.
			 */
			fallback: /** @type {(node: object) => string[]} */ (evk.getKeys),
			jsx: ecmaFeatures.jsx,
		},
	);
}

/**
 * Determines if a given object is Espree.
 * @param {Parser} [parser] The parser to check.
 * @returns {boolean} `true` if the parser is Espree or `false` if not.
 */
function isEspree(parser) {
	/*
	 * `RuleTester` wraps a parser and records the original under a symbol, and
	 * JSDoc has no syntax for declaring a symbol-keyed property.
	 */
	const slots = /** @type {Record<symbol, unknown>} */ (parser);

	return !!(parser === espree || slots[parserSymbol] === espree);
}

/**
 * Normalize ECMAScript version from the initial config into languageOptions (year)
 * format.
 * @param {number | "latest"} [ecmaVersion] ECMAScript version from the initial config
 * @returns {number} normalized ECMAScript version
 */
function normalizeEcmaVersionForLanguageOptions(ecmaVersion) {
	switch (ecmaVersion) {
		case 3:
			return 3;

		// void 0 = no ecmaVersion specified so use the default
		case 5:
		case void 0:
			return 5;

		default:
			if (typeof ecmaVersion === "number") {
				return ecmaVersion >= 2015 ? ecmaVersion : ecmaVersion + 2009;
			}
	}

	/*
	 * We default to the latest supported ecmaVersion for everything else.
	 * Remember, this is for languageOptions.ecmaVersion, which sets the version
	 * that is used for a number of processes inside of ESLint. It's normally
	 * safe to assume people want the latest unless otherwise specified.
	 */
	return LATEST_ECMA_VERSION;
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

module.exports = {
	fileType: "text",
	lineStart: 1,
	columnStart: 0,
	nodeTypeKey: "type",
	visitorKeys: evk.KEYS,

	defaultLanguageOptions: {
		sourceType: "module",
		ecmaVersion: "latest",
		parser: espree,
		parserOptions: {},
	},

	validateLanguageOptions,

	/**
	 * Normalizes the language options.
	 * @param {JSLanguageOptions} languageOptions The language options to normalize.
	 * @returns {NormalizedJSLanguageOptions} The normalized language options.
	 */
	normalizeLanguageOptions(languageOptions) {
		languageOptions.ecmaVersion = normalizeEcmaVersionForLanguageOptions(
			languageOptions.ecmaVersion,
		);

		// Espree expects this information to be passed in
		if (isEspree(languageOptions.parser)) {
			/*
			 * `defaultLanguageOptions` above always supplies `parserOptions`,
			 * and the core merges those in before calling this.
			 */
			const parserOptions = /** @type {Record<string, any>} */ (
				languageOptions.parserOptions
			);

			if (languageOptions.sourceType) {
				parserOptions.sourceType = languageOptions.sourceType;

				if (
					parserOptions.sourceType === "module" &&
					parserOptions.ecmaFeatures &&
					parserOptions.ecmaFeatures.globalReturn
				) {
					parserOptions.ecmaFeatures.globalReturn = false;
				}
			}
		}

		/*
		 * The assignment above replaced any `"latest"` with a year, and the
		 * merged options the core passes in carry the other three keys.
		 */
		return /** @type {NormalizedJSLanguageOptions} */ (languageOptions);
	},

	/**
	 * Determines if a given node matches a given selector class.
	 * @param {string} className The class name to check.
	 * @param {RootNode} node The node to check.
	 * @param {RootNode[]} ancestry The ancestry of the node.
	 * @returns {boolean} `true` if there's a match, `false` if not.
	 * @throws When an unknown class name is passed.
	 */
	matchesSelectorClass(className, node, ancestry) {
		/*
		 * Copyright (c) 2013, Joel Feenstra
		 * All rights reserved.
		 *
		 * Redistribution and use in source and binary forms, with or without
		 * modification, are permitted provided that the following conditions are met:
		 *    * Redistributions of source code must retain the above copyright
		 *      notice, this list of conditions and the following disclaimer.
		 *    * Redistributions in binary form must reproduce the above copyright
		 *      notice, this list of conditions and the following disclaimer in the
		 *      documentation and/or other materials provided with the distribution.
		 *    * Neither the name of the ESQuery nor the names of its contributors may
		 *      be used to endorse or promote products derived from this software without
		 *      specific prior written permission.
		 *
		 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
		 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
		 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
		 * DISCLAIMED. IN NO EVENT SHALL JOEL FEENSTRA BE LIABLE FOR ANY
		 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
		 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
		 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
		 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
		 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
		 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
		 */

		switch (className.toLowerCase()) {
			case "statement":
				if (node.type.slice(-9) === "Statement") {
					return true;
				}

			// fallthrough: interface Declaration <: Statement { }

			case "declaration":
				return node.type.slice(-11) === "Declaration";

			case "pattern":
				if (node.type.slice(-7) === "Pattern") {
					return true;
				}

			// fallthrough: interface Expression <: Node, Pattern { }

			case "expression":
				return (
					node.type.slice(-10) === "Expression" ||
					node.type.slice(-7) === "Literal" ||
					(node.type === "Identifier" &&
						(ancestry.length === 0 ||
							ancestry[0].type !== "MetaProperty")) ||
					node.type === "MetaProperty"
				);

			case "function":
				return (
					node.type === "FunctionDeclaration" ||
					node.type === "FunctionExpression" ||
					node.type === "ArrowFunctionExpression"
				);

			default:
				throw new Error(`Unknown class name: ${className}`);
		}
	},

	/**
	 * Parses the given file into an AST.
	 * @param {File} file The virtual file to parse.
	 * @param {LanguageContext} context Additional options passed from ESLint.
	 * @returns {ParseResult} The result of parsing.
	 */
	parse(file, { languageOptions }) {
		/*
		 * Note: BOM already removed. `fileType: "text"` below means the core
		 * only ever hands this language a string body, while `File` declares
		 * it as `string | Uint8Array` for the binary case.
		 */
		const { body: text, path: filePath } =
			/** @type {File & { body: string }} */ (file);
		const textToParse = text.replace(
			astUtils.shebangPattern,
			(match, captured) => `//${captured}`,
		);
		const { ecmaVersion, sourceType, parser } = languageOptions;
		const parserOptions = Object.assign(
			{ ecmaVersion, sourceType },
			languageOptions.parserOptions,
			{
				loc: true,
				range: true,
				tokens: true,
				comment: true,
				eslintVisitorKeys: true,
				eslintScopeManager: true,
				filePath,
			},
		);

		/*
		 * Check for parsing errors first. If there's a parsing error, nothing
		 * else can happen. However, a parsing error does not throw an error
		 * from this method - it's just considered a fatal error message, a
		 * problem that ESLint identified just like any other.
		 */
		try {
			debug("Parsing:", filePath);
			const parseResult =
				typeof parser.parseForESLint === "function"
					? parser.parseForESLint(textToParse, parserOptions)
					: {
							/*
							 * `validateLanguageOptions()` rejects a parser that
							 * has neither entry point, so reaching here means
							 * `parse` exists.
							 */
							ast: /** @type {NonNullable<Parser["parse"]>} */ (
								parser.parse
							)(textToParse, parserOptions),
						};

			debug("Parsing successful:", filePath);

			const {
				ast,
				services: parserServices = {},
				visitorKeys = evk.KEYS,
				scopeManager,
			} = parseResult;

			return {
				ok: true,
				ast,
				parserServices,
				visitorKeys,
				scopeManager,
			};
		} catch (ex) {
			/*
			 * A parse error is whatever the parser threw. Espree attaches the
			 * location as `lineNumber`/`column`; a custom parser may not.
			 */
			const parseError =
				/** @type {Error & { lineNumber?: number, column?: number }} */ (
					ex
				);

			// If the message includes a leading line number, strip it:
			const message = parseError.message
				.replace(/^line \d+:/iu, "")
				.trim();

			debug("%s\n%s", message, parseError.stack);

			return {
				ok: false,
				errors: [
					{
						message,
						line: parseError.lineNumber,
						column: parseError.column,
					},
				],
			};
		}
	},

	/**
	 * Creates a new `SourceCode` object from the given information.
	 * @param {File} file The virtual file to create a `SourceCode` object from.
	 * @param {OkParseResult} parseResult The result returned from `parse()`.
	 * @param {LanguageContext} context Additional options passed from ESLint.
	 * @returns {import("./source-code/source-code.js")} The new `SourceCode` object.
	 */
	createSourceCode(file, parseResult, { languageOptions }) {
		// See the note on the body type in `parse()` above.
		const {
			body: text,
			path: filePath,
			bom: hasBOM,
		} = /** @type {File & { body: string }} */ (file);
		const { ast, parserServices, visitorKeys } = parseResult;

		debug("Scope analysis:", filePath);
		const scopeManager =
			parseResult.scopeManager ||
			analyzeScope(ast, languageOptions, visitorKeys);

		debug("Scope analysis successful:", filePath);

		return new SourceCode({
			text,

			/*
			 * `parse()` asks every parser for `tokens`, `comments`, `loc` and
			 * `range`, and `SourceCode` throws if the AST is missing any of
			 * them, so by here the root is a full program node.
			 */
			ast: /** @type {import("./source-code/source-code.js").ProgramNode} */ (
				ast
			),
			hasBOM,
			parserServices,
			scopeManager,
			visitorKeys,
		});
	},
};

/**
 * @fileoverview JavaScript Language Object
 * @author Nicholas C. Zakas
 */

// @ts-check

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

/** @typedef {import("../../shared/types.js").Comment} Comment */
/** @typedef {import("eslint-scope").ScopeManager} ScopeManager */
/** @typedef {import("eslint-visitor-keys").VisitorKeys} VisitorKeys */

/**
 * The loose node shape the linter hands around, reused here rather than
 * duplicated; the reference is type-only and adds no runtime dependency.
 * @typedef {import("../../rules/utils/ast-utils.js").ASTNode} Node
 */

/**
 * The `Program` node a parser returns, with the extra arrays ESLint requests.
 * @typedef {Node & { tokens: Array<import("../../shared/types.js").Token>, comments: Array<Comment> }} Program
 */

/**
 * A parser, in either of the two shapes ESLint accepts.
 * @typedef {{ parse?: Function, parseForESLint?: Function, [key: string]: unknown }} Parser
 */

/**
 * The `ecmaFeatures` Espree understands.
 * @typedef {Object} EcmaFeatures
 * @property {boolean} [globalReturn] Whether a top-level `return` is allowed.
 * @property {boolean} [impliedStrict] Whether strict mode is implied.
 * @property {boolean} [jsx] Whether JSX is parsed.
 */

/**
 * The options forwarded to the parser. Parsers define their own, so only the
 * few ESLint itself reads or writes are pinned.
 * @typedef {{ ecmaFeatures?: EcmaFeatures, sourceType?: string, [key: string]: unknown }} ParserOptions
 */

/**
 * The normalized `languageOptions` for a JavaScript file.
 * @typedef {Object} LanguageOptions
 * @property {number | "latest"} [ecmaVersion] The ECMAScript version to parse with.
 * @property {"script" | "module" | "commonjs"} [sourceType] How the file is to be interpreted.
 * @property {Record<string, unknown>} [globals] The globals available to the file.
 * @property {Parser} parser The parser to use.
 * @property {ParserOptions} parserOptions The options to pass to the parser.
 */

/**
 * The result of a successful or failed `parse()`.
 * @typedef {Object} ParseResult
 * @property {boolean} ok Whether parsing succeeded.
 * @property {Program} [ast] The parsed AST, present when `ok` is `true`.
 * @property {Record<string, unknown>} [parserServices] The services the parser exposed.
 * @property {VisitorKeys} [visitorKeys] The visitor keys to traverse the AST with.
 * @property {ScopeManager} [scopeManager] The scope manager the parser produced, if any.
 * @property {Array<{ message: string, line: number, column: number }>} [errors] The parse errors, present when `ok` is `false`.
 */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const debug = createDebug("eslint:languages:js");
const DEFAULT_ECMA_VERSION = 5;
const parserSymbol = Symbol.for("eslint.RuleTester.parser");

/**
 * Analyze scope of the given AST.
 * @param {Program} ast The `Program` node to analyze.
 * @param {LanguageOptions} languageOptions The parser options.
 * @param {VisitorKeys} [visitorKeys] The visitor keys.
 * @returns {ScopeManager} The analysis result.
 */
function analyzeScope(ast, languageOptions, visitorKeys) {
	const parserOptions = languageOptions.parserOptions;
	const ecmaFeatures = parserOptions.ecmaFeatures || {};
	const ecmaVersion = languageOptions.ecmaVersion || DEFAULT_ECMA_VERSION;

	/*
	 * `eslint-scope` is declared over the ESTree union. The AST here may come
	 * from a custom parser and so is typed loosely, which is exactly the
	 * mismatch this cast records; `analyze()` only reads what it can traverse.
	 */
	const estreeAst = /** @type {import("estree").Program} */ (
		/** @type {unknown} */ (ast)
	);

	return eslintScope.analyze(estreeAst, {
		ignoreEval: true,
		nodejsScope: ecmaFeatures.globalReturn,
		impliedStrict: ecmaFeatures.impliedStrict,
		ecmaVersion: typeof ecmaVersion === "number" ? ecmaVersion : 6,
		sourceType: languageOptions.sourceType || "script",
		childVisitorKeys: visitorKeys || evk.KEYS,

		/*
		 * `eslint-scope` declares `fallback` over `estree.Node`, while
		 * `getKeys` accepts any object; the cast reconciles the two without
		 * narrowing what this language object actually supports.
		 */
		fallback: /** @type {(node: import("estree").Node) => string[]} */ (
			/** @type {unknown} */ (evk.getKeys)
		),
		jsx: ecmaFeatures.jsx,
	});
}

/**
 * Determines if a given object is Espree.
 * @param {Parser} parser The parser to check.
 * @returns {boolean} `true` if the parser is Espree or `false` if not.
 */
function isEspree(parser) {
	return !!(
		parser === espree ||
		/** @type {Record<symbol, unknown>} */ (parser)[parserSymbol] === espree
	);
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
	 * @param {LanguageOptions} languageOptions The language options to normalize.
	 * @returns {LanguageOptions} The normalized language options.
	 */
	normalizeLanguageOptions(languageOptions) {
		languageOptions.ecmaVersion = normalizeEcmaVersionForLanguageOptions(
			languageOptions.ecmaVersion,
		);

		// Espree expects this information to be passed in
		if (isEspree(languageOptions.parser)) {
			const parserOptions = languageOptions.parserOptions;

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

		return languageOptions;
	},

	/**
	 * Determines if a given node matches a given selector class.
	 * @param {string} className The class name to check.
	 * @param {Node} node The node to check.
	 * @param {Array<Node>} ancestry The ancestry of the node.
	 * @returns {boolean} `true` if there's a match, `false` if not.
	 * @throws {Error} When an unknown class name is passed.
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
	 * @param {{ body: string, path: string }} file The virtual file to parse.
	 * @param {Object} options Additional options passed from ESLint.
	 * @param {LanguageOptions} options.languageOptions The language options.
	 * @returns {ParseResult} The result of parsing.
	 */
	parse(file, { languageOptions }) {
		// Note: BOM already removed
		const { body: text, path: filePath } = file;
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
			/*
			 * One of the two methods is present: `validateLanguageOptions()`
			 * rejects a parser that has neither.
			 */
			const parse = /** @type {Function} */ (parser.parse);
			const parseResult =
				typeof parser.parseForESLint === "function"
					? parser.parseForESLint(textToParse, parserOptions)
					: { ast: parse(textToParse, parserOptions) };

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
			 * A parser signals a syntax error by throwing an `Error` carrying
			 * the 1-based position it failed at. Only the shape read below is
			 * asserted, since third-party parsers subclass `Error` freely.
			 */
			const error =
				/** @type {Error & { lineNumber: number, column: number }} */ (
					ex
				);

			// If the message includes a leading line number, strip it:
			const message = error.message.replace(/^line \d+:/iu, "").trim();

			debug("%s\n%s", message, error.stack);

			return {
				ok: false,
				errors: [
					{
						message,
						line: error.lineNumber,
						column: error.column,
					},
				],
			};
		}
	},

	/**
	 * Creates a new `SourceCode` object from the given information.
	 * @param {{ body: string, path: string, bom: boolean }} file The virtual file to create a `SourceCode` object from.
	 * @param {ParseResult} parseResult The result returned from `parse()`.
	 * @param {Object} options Additional options passed from ESLint.
	 * @param {LanguageOptions} options.languageOptions The language options.
	 * @returns {SourceCode} The new `SourceCode` object.
	 */
	createSourceCode(file, parseResult, { languageOptions }) {
		const { body: text, path: filePath, bom: hasBOM } = file;
		/*
		 * The core only calls this after a successful `parse()`, which is what
		 * makes `ast` present.
		 */
		const ast = /** @type {Program} */ (parseResult.ast);
		const { parserServices, visitorKeys } = parseResult;

		debug("Scope analysis:", filePath);
		const scopeManager =
			parseResult.scopeManager ||
			analyzeScope(ast, languageOptions, visitorKeys);

		debug("Scope analysis successful:", filePath);

		return new SourceCode({
			text,
			ast,
			hasBOM,
			parserServices,
			scopeManager,
			visitorKeys,
		});
	},
};

/**
 * @fileoverview Rule to enforce spacing before and after keywords.
 * @author Toru Nagashima
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils"),
	keywords = require("./utils/keywords");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

/**
 * Reports a given keyword token if the spacing on one of its sides is invalid.
 * @typedef {(token: Token, pattern: RegExp) => void} SpacingChecker
 */

/**
 * The normalized option object. It has one entry for every keyword in `KEYS`,
 * holding the checker to run for the space before and after that keyword.
 * @typedef {Record<string, { before: SpacingChecker, after: SpacingChecker }>} CheckMethodMap
 */

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------

const PREV_TOKEN = /^[)\]}>]$/u;
const NEXT_TOKEN = /^(?:[([{<~!]|\+\+?|--?)$/u;
const PREV_TOKEN_M = /^[)\]}>*]$/u;
const NEXT_TOKEN_M = /^[{*]$/u;
const TEMPLATE_OPEN_PAREN = /\$\{$/u;
const TEMPLATE_CLOSE_PAREN = /^\}/u;
const CHECK_TYPE =
	/^(?:JSXElement|RegularExpression|String|Template|PrivateIdentifier)$/u;
const KEYS = keywords.concat([
	"as",
	"async",
	"await",
	"from",
	"get",
	"let",
	"of",
	"set",
	"yield",
]);

// check duplications.
/**
 * Checks the keyword list for duplications while the module loads.
 * @returns {void} No return value.
 * @throws {Error} If the same keyword appears in the list twice.
 */
(function () {
	KEYS.sort();
	for (let i = 1; i < KEYS.length; ++i) {
		if (KEYS[i] === KEYS[i - 1]) {
			throw new Error(
				`Duplication was found in the keyword list: ${KEYS[i]}`,
			);
		}
	}
})();

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether or not a given token is a "Template" token ends with "${".
 * @param {Token} token A token to check.
 * @returns {boolean} `true` if the token is a "Template" token ends with "${".
 */
function isOpenParenOfTemplate(token) {
	return token.type === "Template" && TEMPLATE_OPEN_PAREN.test(token.value);
}

/**
 * Checks whether or not a given token is a "Template" token starts with "}".
 * @param {Token} token A token to check.
 * @returns {boolean} `true` if the token is a "Template" token starts with "}".
 */
function isCloseParenOfTemplate(token) {
	return token.type === "Template" && TEMPLATE_CLOSE_PAREN.test(token.value);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		deprecated: {
			message: "Formatting rules are being moved out of ESLint core.",
			url: "https://eslint.org/blog/2023/10/deprecating-formatting-rules/",
			deprecatedSince: "8.53.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"ESLint Stylistic now maintains deprecated stylistic core rules.",
					url: "https://eslint.style/guide/migration",
					plugin: {
						name: "@stylistic/eslint-plugin",
						url: "https://eslint.style",
					},
					rule: {
						name: "keyword-spacing",
						url: "https://eslint.style/rules/keyword-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent spacing before and after keywords",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/keyword-spacing",
		},

		fixable: "whitespace",

		schema: [
			{
				type: "object",
				properties: {
					before: { type: "boolean", default: true },
					after: { type: "boolean", default: true },
					overrides: {
						type: "object",
						properties: KEYS.reduce((retv, key) => {
							retv[key] = {
								type: "object",
								properties: {
									before: { type: "boolean" },
									after: { type: "boolean" },
								},
								additionalProperties: false,
							};
							return retv;
						}, /** @type {Record<string, unknown>} */ ({})),
						additionalProperties: false,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			expectedBefore: 'Expected space(s) before "{{value}}".',
			expectedAfter: 'Expected space(s) after "{{value}}".',
			unexpectedBefore: 'Unexpected space(s) before "{{value}}".',
			unexpectedAfter: 'Unexpected space(s) after "{{value}}".',
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		const tokensToIgnore = new WeakSet();

		/**
		 * Reports a given token if there are not space(s) before the token.
		 * @param {Token} token A token to report.
		 * @param {RegExp} pattern A pattern of the previous token to check.
		 * @returns {void} No return value.
		 */
		function expectSpaceBefore(token, pattern) {
			const prevToken = sourceCode.getTokenBefore(token);

			if (
				prevToken &&
				(CHECK_TYPE.test(prevToken.type) ||
					pattern.test(prevToken.value)) &&
				!isOpenParenOfTemplate(prevToken) &&
				!tokensToIgnore.has(prevToken) &&
				astUtils.isTokenOnSameLine(prevToken, token) &&
				!sourceCode.isSpaceBetween(prevToken, token)
			) {
				context.report({
					loc: token.loc,
					messageId: "expectedBefore",
					data: token,
					/**
					 * Inserts the missing space before the token.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The edit to apply.
					 */
					fix(fixer) {
						return fixer.insertTextBefore(token, " ");
					},
				});
			}
		}

		/**
		 * Reports a given token if there are space(s) before the token.
		 * @param {Token} token A token to report.
		 * @param {RegExp} pattern A pattern of the previous token to check.
		 * @returns {void} No return value.
		 */
		function unexpectSpaceBefore(token, pattern) {
			const prevToken = sourceCode.getTokenBefore(token);

			if (
				prevToken &&
				(CHECK_TYPE.test(prevToken.type) ||
					pattern.test(prevToken.value)) &&
				!isOpenParenOfTemplate(prevToken) &&
				!tokensToIgnore.has(prevToken) &&
				astUtils.isTokenOnSameLine(prevToken, token) &&
				sourceCode.isSpaceBetween(prevToken, token)
			) {
				context.report({
					loc: { start: prevToken.loc.end, end: token.loc.start },
					messageId: "unexpectedBefore",
					data: token,
					/**
					 * Removes the space(s) before the token.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The edit to apply.
					 */
					fix(fixer) {
						return fixer.removeRange([
							prevToken.range[1],
							token.range[0],
						]);
					},
				});
			}
		}

		/**
		 * Reports a given token if there are not space(s) after the token.
		 * @param {Token} token A token to report.
		 * @param {RegExp} pattern A pattern of the next token to check.
		 * @returns {void} No return value.
		 */
		function expectSpaceAfter(token, pattern) {
			const nextToken = sourceCode.getTokenAfter(token);

			if (
				nextToken &&
				(CHECK_TYPE.test(nextToken.type) ||
					pattern.test(nextToken.value)) &&
				!isCloseParenOfTemplate(nextToken) &&
				!tokensToIgnore.has(nextToken) &&
				astUtils.isTokenOnSameLine(token, nextToken) &&
				!sourceCode.isSpaceBetween(token, nextToken)
			) {
				context.report({
					loc: token.loc,
					messageId: "expectedAfter",
					data: token,
					/**
					 * Inserts the missing space after the token.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The edit to apply.
					 */
					fix(fixer) {
						return fixer.insertTextAfter(token, " ");
					},
				});
			}
		}

		/**
		 * Reports a given token if there are space(s) after the token.
		 * @param {Token} token A token to report.
		 * @param {RegExp} pattern A pattern of the next token to check.
		 * @returns {void} No return value.
		 */
		function unexpectSpaceAfter(token, pattern) {
			const nextToken = sourceCode.getTokenAfter(token);

			if (
				nextToken &&
				(CHECK_TYPE.test(nextToken.type) ||
					pattern.test(nextToken.value)) &&
				!isCloseParenOfTemplate(nextToken) &&
				!tokensToIgnore.has(nextToken) &&
				astUtils.isTokenOnSameLine(token, nextToken) &&
				sourceCode.isSpaceBetween(token, nextToken)
			) {
				context.report({
					loc: { start: token.loc.end, end: nextToken.loc.start },
					messageId: "unexpectedAfter",
					data: token,
					/**
					 * Removes the space(s) after the token.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The edit to apply.
					 */
					fix(fixer) {
						return fixer.removeRange([
							token.range[1],
							nextToken.range[0],
						]);
					},
				});
			}
		}

		/**
		 * Parses the option object and determines check methods for each keyword.
		 *
		 * `options` is `any` because it is the raw, user-written rule option:
		 * `meta.schema` is what validates its shape.
		 * @param {any} [options] The option object to parse.
		 * @returns {CheckMethodMap} Normalized option object.
		 *      Keys are keywords (there are for every keyword).
		 *      Values are instances of `{"before": function, "after": function}`.
		 */
		function parseOptions(options = {}) {
			const before = options.before !== false;
			const after = options.after !== false;
			const defaultValue = {
				before: before ? expectSpaceBefore : unexpectSpaceBefore,
				after: after ? expectSpaceAfter : unexpectSpaceAfter,
			};
			const overrides = (options && options.overrides) || {};
			const retv = Object.create(null);

			for (let i = 0; i < KEYS.length; ++i) {
				const key = KEYS[i];
				const override = overrides[key];

				if (override) {
					const thisBefore =
						"before" in override ? override.before : before;
					const thisAfter =
						"after" in override ? override.after : after;

					retv[key] = {
						before: thisBefore
							? expectSpaceBefore
							: unexpectSpaceBefore,
						after: thisAfter
							? expectSpaceAfter
							: unexpectSpaceAfter,
					};
				} else {
					retv[key] = defaultValue;
				}
			}

			return retv;
		}

		const checkMethodMap = parseOptions(context.options[0]);

		/**
		 * Reports a given token if usage of spacing followed by the token is
		 * invalid.
		 * @param {Token} token A token to report.
		 * @param {RegExp} [pattern] Optional. A pattern of the previous
		 *      token to check.
		 * @returns {void} No return value.
		 */
		function checkSpacingBefore(token, pattern) {
			checkMethodMap[token.value].before(token, pattern || PREV_TOKEN);
		}

		/**
		 * Reports a given token if usage of spacing preceded by the token is
		 * invalid.
		 * @param {Token} token A token to report.
		 * @param {RegExp} [pattern] Optional. A pattern of the next
		 *      token to check.
		 * @returns {void} No return value.
		 */
		function checkSpacingAfter(token, pattern) {
			checkMethodMap[token.value].after(token, pattern || NEXT_TOKEN);
		}

		/**
		 * Reports a given token if usage of spacing around the token is invalid.
		 * @param {Token} token A token to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingAround(token) {
			checkSpacingBefore(token);
			checkSpacingAfter(token);
		}

		/**
		 * Reports the first token of a given node if the first token is a keyword
		 * and usage of spacing around the token is invalid.
		 * @param {ASTNode | null} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingAroundFirstToken(node) {
			/*
			 * The token getters below are all typed `Token | Comment | null`.
			 * Every lookup in this rule is cast to `Token`: the position asked
			 * for is one the grammar guarantees a token at (a node's own first
			 * token, or the keyword the caller already matched), and comments
			 * are never returned because `includeComments` is not set. The
			 * `firstToken &&` guards that survive are the original runtime
			 * checks and are left alone.
			 */
			const firstToken =
				node && /** @type {Token} */ (sourceCode.getFirstToken(node));

			if (firstToken && firstToken.type === "Keyword") {
				checkSpacingAround(firstToken);
			}
		}

		/**
		 * Reports the first token of a given node if the first token is a keyword
		 * and usage of spacing followed by the token is invalid.
		 *
		 * This is used for unary operators (e.g. `typeof`), `function`, and `super`.
		 * Other rules are handling usage of spacing preceded by those keywords.
		 * @param {ASTNode | null} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingBeforeFirstToken(node) {
			const firstToken =
				node && /** @type {Token} */ (sourceCode.getFirstToken(node));

			if (firstToken && firstToken.type === "Keyword") {
				checkSpacingBefore(firstToken);
			}
		}

		/**
		 * Reports the previous token of a given node if the token is a keyword and
		 * usage of spacing around the token is invalid.
		 * @param {ASTNode | null} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingAroundTokenBefore(node) {
			if (node) {
				const token = /** @type {Token} */ (
					sourceCode.getTokenBefore(node, astUtils.isKeywordToken)
				);

				checkSpacingAround(token);
			}
		}

		/**
		 * Reports `async` or `function` keywords of a given node if usage of
		 * spacing around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForFunction(node) {
			const firstToken =
				node && /** @type {Token} */ (sourceCode.getFirstToken(node));

			if (
				firstToken &&
				((firstToken.type === "Keyword" &&
					firstToken.value === "function") ||
					firstToken.value === "async")
			) {
				checkSpacingBefore(firstToken);
			}
		}

		/**
		 * Reports `class` and `extends` keywords of a given node if usage of
		 * spacing around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForClass(node) {
			checkSpacingAroundFirstToken(node);
			checkSpacingAroundTokenBefore(node.superClass);
		}

		/**
		 * Reports `if` and `else` keywords of a given node if usage of spacing
		 * around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForIfStatement(node) {
			checkSpacingAroundFirstToken(node);
			checkSpacingAroundTokenBefore(node.alternate);
		}

		/**
		 * Reports `try`, `catch`, and `finally` keywords of a given node if usage
		 * of spacing around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForTryStatement(node) {
			checkSpacingAroundFirstToken(node);
			checkSpacingAroundFirstToken(node.handler);
			checkSpacingAroundTokenBefore(node.finalizer);
		}

		/**
		 * Reports `do` and `while` keywords of a given node if usage of spacing
		 * around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForDoWhileStatement(node) {
			checkSpacingAroundFirstToken(node);
			checkSpacingAroundTokenBefore(node.test);
		}

		/**
		 * Reports `for` and `in` keywords of a given node if usage of spacing
		 * around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForForInStatement(node) {
			checkSpacingAroundFirstToken(node);

			const inToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(
					node.right,
					astUtils.isNotOpeningParenToken,
				)
			);
			const previousToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(inToken)
			);

			if (previousToken.type !== "PrivateIdentifier") {
				checkSpacingBefore(inToken);
			}

			checkSpacingAfter(inToken);
		}

		/**
		 * Reports `for` and `of` keywords of a given node if usage of spacing
		 * around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForForOfStatement(node) {
			if (node.await) {
				checkSpacingBefore(
					/** @type {Token} */ (sourceCode.getFirstToken(node, 0)),
				);
				checkSpacingAfter(
					/** @type {Token} */ (sourceCode.getFirstToken(node, 1)),
				);
			} else {
				checkSpacingAroundFirstToken(node);
			}

			const ofToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(
					node.right,
					astUtils.isNotOpeningParenToken,
				)
			);
			const previousToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(ofToken)
			);

			if (previousToken.type !== "PrivateIdentifier") {
				checkSpacingBefore(ofToken);
			}

			checkSpacingAfter(ofToken);
		}

		/**
		 * Reports `import`, `export`, `as`, and `from` keywords of a given node if
		 * usage of spacing around those keywords is invalid.
		 *
		 * This rule handles the `*` token in module declarations.
		 *
		 *     import*as A from "./a"; /*error Expected space(s) after "import".
		 *                               error Expected space(s) before "as".
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForModuleDeclaration(node) {
			const firstToken = /** @type {Token} */ (
				sourceCode.getFirstToken(node)
			);

			checkSpacingBefore(firstToken, PREV_TOKEN_M);
			checkSpacingAfter(firstToken, NEXT_TOKEN_M);

			if (node.type === "ExportDefaultDeclaration") {
				checkSpacingAround(
					/** @type {Token} */ (sourceCode.getTokenAfter(firstToken)),
				);
			}

			if (node.type === "ExportAllDeclaration" && node.exported) {
				const asToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(node.exported)
				);

				checkSpacingBefore(asToken, PREV_TOKEN_M);
				checkSpacingAfter(asToken, NEXT_TOKEN_M);
			}

			if (node.source) {
				const fromToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(node.source)
				);

				checkSpacingBefore(fromToken, PREV_TOKEN_M);
				checkSpacingAfter(fromToken, NEXT_TOKEN_M);
			}
		}

		/**
		 * Reports `as` keyword of a given node if usage of spacing around this
		 * keyword is invalid.
		 * @param {ASTNode} node An `ImportSpecifier` node to check.
		 * @returns {void} No return value.
		 */
		function checkSpacingForImportSpecifier(node) {
			if (node.imported.range[0] !== node.local.range[0]) {
				const asToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(node.local)
				);

				checkSpacingBefore(asToken, PREV_TOKEN_M);
			}
		}

		/**
		 * Reports `as` keyword of a given node if usage of spacing around this
		 * keyword is invalid.
		 * @param {ASTNode} node An `ExportSpecifier` node to check.
		 * @returns {void} No return value.
		 */
		function checkSpacingForExportSpecifier(node) {
			if (node.local.range[0] !== node.exported.range[0]) {
				const asToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(node.exported)
				);

				checkSpacingBefore(asToken, PREV_TOKEN_M);
				checkSpacingAfter(asToken, NEXT_TOKEN_M);
			}
		}

		/**
		 * Reports `as` keyword of a given node if usage of spacing around this
		 * keyword is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForImportNamespaceSpecifier(node) {
			const asToken = /** @type {Token} */ (
				sourceCode.getFirstToken(node, 1)
			);

			checkSpacingBefore(asToken, PREV_TOKEN_M);
		}

		/**
		 * Reports `static`, `get`, and `set` keywords of a given node if usage of
		 * spacing around those keywords is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 * @throws {Error} If unable to find token get, set, or async beside method name.
		 */
		function checkSpacingForProperty(node) {
			if (node.static) {
				checkSpacingAroundFirstToken(node);
			}
			if (
				node.kind === "get" ||
				node.kind === "set" ||
				((node.method || node.type === "MethodDefinition") &&
					node.value.async)
			) {
				const token = sourceCode.getTokenBefore(node.key, tok => {
					switch (tok.value) {
						case "get":
						case "set":
						case "async":
							return true;
						default:
							return false;
					}
				});

				if (!token) {
					throw new Error(
						"Failed to find token get, set, or async beside method name",
					);
				}

				checkSpacingAround(token);
			}
		}

		/**
		 * Reports `await` keyword of a given node if usage of spacing before
		 * this keyword is invalid.
		 * @param {ASTNode} node A node to report.
		 * @returns {void} No return value.
		 */
		function checkSpacingForAwaitExpression(node) {
			checkSpacingBefore(
				/** @type {Token} */ (sourceCode.getFirstToken(node)),
			);
		}

		return {
			// Statements
			DebuggerStatement: checkSpacingAroundFirstToken,
			WithStatement: checkSpacingAroundFirstToken,

			// Statements - Control flow
			BreakStatement: checkSpacingAroundFirstToken,
			ContinueStatement: checkSpacingAroundFirstToken,
			ReturnStatement: checkSpacingAroundFirstToken,
			ThrowStatement: checkSpacingAroundFirstToken,
			TryStatement: checkSpacingForTryStatement,

			// Statements - Choice
			IfStatement: checkSpacingForIfStatement,
			SwitchStatement: checkSpacingAroundFirstToken,
			SwitchCase: checkSpacingAroundFirstToken,

			// Statements - Loops
			DoWhileStatement: checkSpacingForDoWhileStatement,
			ForInStatement: checkSpacingForForInStatement,
			ForOfStatement: checkSpacingForForOfStatement,
			ForStatement: checkSpacingAroundFirstToken,
			WhileStatement: checkSpacingAroundFirstToken,

			// Statements - Declarations
			ClassDeclaration: checkSpacingForClass,
			ExportNamedDeclaration: checkSpacingForModuleDeclaration,
			ExportDefaultDeclaration: checkSpacingForModuleDeclaration,
			ExportAllDeclaration: checkSpacingForModuleDeclaration,
			FunctionDeclaration: checkSpacingForFunction,
			ImportDeclaration: checkSpacingForModuleDeclaration,
			VariableDeclaration: checkSpacingAroundFirstToken,

			// Expressions
			ArrowFunctionExpression: checkSpacingForFunction,
			AwaitExpression: checkSpacingForAwaitExpression,
			ClassExpression: checkSpacingForClass,
			FunctionExpression: checkSpacingForFunction,
			NewExpression: checkSpacingBeforeFirstToken,
			Super: checkSpacingBeforeFirstToken,
			ThisExpression: checkSpacingBeforeFirstToken,
			UnaryExpression: checkSpacingBeforeFirstToken,
			YieldExpression: checkSpacingBeforeFirstToken,

			// Others
			ImportSpecifier: checkSpacingForImportSpecifier,
			ExportSpecifier: checkSpacingForExportSpecifier,
			ImportNamespaceSpecifier: checkSpacingForImportNamespaceSpecifier,
			MethodDefinition: checkSpacingForProperty,
			PropertyDefinition: checkSpacingForProperty,
			StaticBlock: checkSpacingAroundFirstToken,
			Property: checkSpacingForProperty,

			// To avoid conflicts with `space-infix-ops`, e.g. `a > this.b`
			/**
			 * Marks the `>` operator so that it is not reported as the previous
			 * or next token of a keyword.
			 * @param {ASTNode} node The `BinaryExpression` node to check.
			 * @returns {void} No return value.
			 */
			"BinaryExpression[operator='>']"(node) {
				const operatorToken = /** @type {Token} */ (
					sourceCode.getTokenBefore(
						node.right,
						astUtils.isNotOpeningParenToken,
					)
				);

				tokensToIgnore.add(operatorToken);
			},
		};
	},
};

/**
 * @fileoverview Rule to disallow async functions which have no `await` expression.
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("../shared/types.js").Range} Range */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

/**
 * The traversal state for one function. Functions nest, so each entry links
 * back to the one for the enclosing function, and the outermost entry links
 * to `null`.
 * @typedef {Object} ScopeInfo
 * @property {ScopeInfo | null} upper The state for the enclosing function.
 * @property {boolean} hasAwait Whether an `await` has been seen in this function.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Capitalize the 1st letter of the given text.
 * @param {string} text The text to capitalize.
 * @returns {string} The text that the 1st letter was capitalized.
 */
function capitalizeFirstLetter(text) {
	return text[0].toUpperCase() + text.slice(1);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Disallow async functions which have no `await` expression",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/require-await",
		},

		schema: [],

		messages: {
			missingAwait: "{{name}} has no 'await' expression.",
			removeAsync: "Remove 'async'.",
		},

		hasSuggestions: true,
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/** @type {ScopeInfo | null} */
		let scopeInfo = null;

		/**
		 * Push the scope info object to the stack.
		 * @returns {void}
		 */
		function enterFunction() {
			scopeInfo = {
				upper: scopeInfo,
				hasAwait: false,
			};
		}

		/**
		 * Pop the top scope info object from the stack.
		 * Also, it reports the function if needed.
		 * @param {ASTNode} node The node to report.
		 * @returns {void}
		 */
		function exitFunction(node) {
			if (
				!node.generator &&
				node.async &&
				// `:exit` always pairs with the enter that pushed the entry, so the stack is never empty here.
				!(/** @type {ScopeInfo} */ (scopeInfo).hasAwait) &&
				!astUtils.isEmptyFunction(node)
			) {
				/*
				 * If the function belongs to a method definition or
				 * property, then the function's range may not include the
				 * `async` keyword and we should look at the parent instead.
				 */
				const nodeWithAsyncKeyword =
					(node.parent.type === "MethodDefinition" &&
						node.parent.value === node) ||
					(node.parent.type === "Property" &&
						node.parent.method &&
						node.parent.value === node)
						? node.parent
						: node;

				// The node was just found to be `async`, so its `async` keyword token exists.
				const asyncToken = /** @type {Token} */ (
					sourceCode.getFirstToken(
						nodeWithAsyncKeyword,
						token => token.value === "async",
					)
				);

				/*
				 * The `async` keyword is never the last token: the function it
				 * modifies always follows it, so there is always a token after.
				 */
				/** @type {Range} */
				const asyncRange = [
					asyncToken.range[0],
					/** @type {Token} */ (
						sourceCode.getTokenAfter(asyncToken, {
							includeComments: true,
						})
					).range[0],
				];

				/*
				 * Removing the `async` keyword can cause parsing errors if the current
				 * statement is relying on automatic semicolon insertion. If ASI is currently
				 * being used, then we should replace the `async` keyword with a semicolon.
				 */
				// Same invariant as above: a token always follows the `async` keyword.
				const nextToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(asyncToken)
				);
				const addSemiColon =
					((astUtils.isOpeningParenToken(nextToken) &&
						astUtils.isStartOfExpressionStatement(
							nodeWithAsyncKeyword,
						)) ||
						(nodeWithAsyncKeyword.type === "MethodDefinition" &&
							astUtils.canContinueExpressionInClassBody(
								nextToken,
							))) &&
					astUtils.needsPrecedingSemicolon(
						sourceCode,
						nodeWithAsyncKeyword,
					);

				context.report({
					node,
					loc: astUtils.getFunctionHeadLoc(node, sourceCode),
					messageId: "missingAwait",
					data: {
						name: capitalizeFirstLetter(
							astUtils.getFunctionNameWithKind(node),
						),
					},
					suggest: [
						{
							messageId: "removeAsync",
							/**
							 * Removes the `async` keyword, replacing it with a semicolon when ASI requires one.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix: fixer =>
								fixer.replaceTextRange(
									asyncRange,
									addSemiColon ? ";" : "",
								),
						},
					],
				});
			}

			// Same pairing invariant as above: there is always an entry to pop.
			scopeInfo = /** @type {ScopeInfo} */ (scopeInfo).upper;
		}

		return {
			FunctionDeclaration: enterFunction,
			FunctionExpression: enterFunction,
			ArrowFunctionExpression: enterFunction,
			"FunctionDeclaration:exit": exitFunction,
			"FunctionExpression:exit": exitFunction,
			"ArrowFunctionExpression:exit": exitFunction,

			/**
			 * Marks the enclosing function as containing an `await`.
			 * @returns {void}
			 */
			AwaitExpression() {
				if (!scopeInfo) {
					return;
				}

				scopeInfo.hasAwait = true;
			},

			/**
			 * Marks the enclosing function as containing an `await` if this is a `for await...of`.
			 * @param {ASTNode} node The `ForOfStatement` node.
			 * @returns {void}
			 */
			ForOfStatement(node) {
				if (!scopeInfo) {
					return;
				}

				if (node.await) {
					scopeInfo.hasAwait = true;
				}
			},

			/**
			 * Marks the enclosing function as containing an `await` if this is an `await using` declaration.
			 * @param {ASTNode} node The `VariableDeclaration` node.
			 * @returns {void}
			 */
			VariableDeclaration(node) {
				if (!scopeInfo) {
					return;
				}

				if (node.kind === "await using") {
					scopeInfo.hasAwait = true;
				}
			},
		};
	},
};

/**
 * @fileoverview Rule to flag unnecessary bind calls
 * @author Bence Dányi <bence@danyi.me>
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
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * One entry of the stack of function scopes the rule maintains.
 * @typedef {Object} ScopeInfo
 * @property {boolean} isBound Whether the function is the callee of a `.bind()` call.
 * @property {boolean} thisFound Whether a `this` keyword was found in the scope.
 * @property {ScopeInfo | null} upper The entry for the enclosing function scope.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const SIDE_EFFECT_FREE_NODE_TYPES = new Set([
	"Literal",
	"Identifier",
	"ThisExpression",
	"FunctionExpression",
]);

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow unnecessary calls to `.bind()`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-extra-bind",
		},

		schema: [],
		fixable: "code",

		messages: {
			unexpected: "The function binding is unnecessary.",
		},
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
		 * Checks if a node is free of side effects.
		 *
		 * This check is stricter than it needs to be, in order to keep the implementation simple.
		 * @param {ASTNode} node A node to check.
		 * @returns {boolean} True if the node is known to be side-effect free, false otherwise.
		 */
		function isSideEffectFree(node) {
			return SIDE_EFFECT_FREE_NODE_TYPES.has(node.type);
		}

		/**
		 * Reports a given function node.
		 * @param {ASTNode} node A node to report. This is a FunctionExpression or
		 *      an ArrowFunctionExpression.
		 * @returns {void}
		 */
		function report(node) {
			const memberNode = node.parent;
			const callNode =
				memberNode.parent.type === "ChainExpression"
					? memberNode.parent.parent
					: memberNode.parent;

			context.report({
				node: callNode,
				messageId: "unexpected",
				loc: memberNode.property.loc,

				/**
				 * Removes the `.bind(…)` call from the source.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {Array<EditInfo> | null} The fixes to apply, or `null` if the call cannot be removed safely.
				 */
				fix(fixer) {
					if (!isSideEffectFree(callNode.arguments[0])) {
						return null;
					}

					/*
					 * The list of the first/last token pair of a removal range.
					 * This is two parts because closing parentheses may exist between the method name and arguments.
					 * E.g. `(function(){}.bind ) (obj)`
					 *                    ^^^^^   ^^^^^ < removal ranges
					 * E.g. `(function(){}?.['bind'] ) ?.(obj)`
					 *                    ^^^^^^^^^^   ^^^^^^^ < removal ranges
					 *
					 * Every lookup below is guaranteed to land on a token by the
					 * grammar of the matched `*.bind(*)` expression, so none of
					 * them is `null`, and a lookup filtered by
					 * `isNotClosingParenToken` skips comments as well.
					 */
					const tokenPairs = [
						[
							// `.`, `?.`, or `[` token.
							/** @type {Token} */ (
								sourceCode.getTokenAfter(
									memberNode.object,
									astUtils.isNotClosingParenToken,
								)
							),

							// property name or `]` token.
							/** @type {Token} */ (
								sourceCode.getLastToken(memberNode)
							),
						],
						[
							// `?.` or `(` token of arguments.
							/** @type {Token} */ (
								sourceCode.getTokenAfter(
									memberNode,
									astUtils.isNotClosingParenToken,
								)
							),

							// `)` token of arguments.
							/** @type {Token} */ (
								sourceCode.getLastToken(callNode)
							),
						],
					];
					const firstTokenToRemove = tokenPairs[0][0];
					const lastTokenToRemove = tokenPairs[1][1];

					if (
						sourceCode.commentsExistBetween(
							firstTokenToRemove,
							lastTokenToRemove,
						)
					) {
						return null;
					}

					return tokenPairs.map(([start, end]) =>
						fixer.removeRange([start.range[0], end.range[1]]),
					);
				},
			});
		}

		/**
		 * Checks whether or not a given function node is the callee of `.bind()`
		 * method.
		 *
		 * e.g. `(function() {}.bind(foo))`
		 * @param {ASTNode} node A node to report. This is a FunctionExpression or
		 *      an ArrowFunctionExpression.
		 * @returns {boolean} `true` if the node is the callee of `.bind()` method.
		 */
		function isCalleeOfBindMethod(node) {
			if (!astUtils.isSpecificMemberAccess(node.parent, null, "bind")) {
				return false;
			}

			// The node of `*.bind` member access.
			const bindNode =
				node.parent.parent.type === "ChainExpression"
					? node.parent.parent
					: node.parent;

			return (
				bindNode.parent.type === "CallExpression" &&
				bindNode.parent.callee === bindNode &&
				bindNode.parent.arguments.length === 1 &&
				bindNode.parent.arguments[0].type !== "SpreadElement"
			);
		}

		/**
		 * Adds a scope information object to the stack.
		 * @param {ASTNode} node A node to add. This node is a FunctionExpression
		 *      or a FunctionDeclaration node.
		 * @returns {void}
		 */
		function enterFunction(node) {
			scopeInfo = {
				isBound: isCalleeOfBindMethod(node),
				thisFound: false,
				upper: scopeInfo,
			};
		}

		/**
		 * Removes the scope information object from the top of the stack.
		 * At the same time, this reports the function node if the function has
		 * `.bind()` and the `this` keywords found.
		 * @param {ASTNode} node A node to remove. This node is a
		 *      FunctionExpression or a FunctionDeclaration node.
		 * @returns {void}
		 */
		function exitFunction(node) {
			if (
				// `:exit` always pairs with the enter that pushed the entry, so the stack is never empty here.
				/** @type {ScopeInfo} */ (scopeInfo).isBound &&
				!(/** @type {ScopeInfo} */ (scopeInfo).thisFound)
			) {
				report(node);
			}

			// Same pairing invariant as above: there is always an entry to pop.
			scopeInfo = /** @type {ScopeInfo} */ (scopeInfo).upper;
		}

		/**
		 * Reports a given arrow function if the function is callee of `.bind()`
		 * method.
		 * @param {ASTNode} node A node to report. This node is an
		 *      ArrowFunctionExpression.
		 * @returns {void}
		 */
		function exitArrowFunction(node) {
			if (isCalleeOfBindMethod(node)) {
				report(node);
			}
		}

		/**
		 * Set the mark as the `this` keyword was found in this scope.
		 * @returns {void}
		 */
		function markAsThisFound() {
			if (scopeInfo) {
				scopeInfo.thisFound = true;
			}
		}

		return {
			"ArrowFunctionExpression:exit": exitArrowFunction,
			FunctionDeclaration: enterFunction,
			"FunctionDeclaration:exit": exitFunction,
			FunctionExpression: enterFunction,
			"FunctionExpression:exit": exitFunction,
			ThisExpression: markAsThisFound,
		};
	},
};

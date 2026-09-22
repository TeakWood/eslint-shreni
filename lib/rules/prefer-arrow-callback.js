/**
 * @fileoverview A rule to suggest using arrow functions as callbacks.
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

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
/** @typedef {import("eslint-scope").Scope} Scope */
/** @typedef {import("eslint-scope").Variable} Variable */

/**
 * The flags collected for one function scope while its body is traversed.
 * @typedef {Object} ScopeInfo
 * @property {boolean} this A flag which shows there are one or more ThisExpression.
 * @property {boolean} super A flag which shows there are one or more Super.
 * @property {boolean} meta A flag which shows there are one or more MetaProperty.
 */

/**
 * What `getCallbackInfo()` determined about a function expression.
 * @typedef {Object} CallbackInfo
 * @property {boolean} isCallback `true` if the node is a callback.
 * @property {boolean} isLexicalThis `true` if the node is with `.bind(this)`.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether or not a given variable is a function name.
 * @param {Variable | undefined} variable A variable to check.
 * @returns {boolean | undefined} `true` if the variable is a function name. `undefined` when there is no variable, which every caller reads as falsy.
 */
function isFunctionName(variable) {
	return variable && variable.defs[0].type === "FunctionName";
}

/**
 * Checks whether or not a given MetaProperty node equals to a given value.
 * @param {ASTNode} node A MetaProperty node to check.
 * @param {string} metaName The name of `MetaProperty.meta`.
 * @param {string} propertyName The name of `MetaProperty.property`.
 * @returns {boolean} `true` if the node is the specific value.
 */
function checkMetaProperty(node, metaName, propertyName) {
	return node.meta.name === metaName && node.property.name === propertyName;
}

/**
 * Gets the variable object of `arguments` which is defined implicitly.
 * @param {Scope} scope A scope to get.
 * @returns {Variable | null} The found variable object.
 */
function getVariableOfArguments(scope) {
	const variables = scope.variables;

	for (let i = 0; i < variables.length; ++i) {
		const variable = variables[i];

		if (variable.name === "arguments") {
			/*
			 * If there was a parameter which is named "arguments", the
			 * implicit "arguments" is not defined.
			 * So does fast return with null.
			 */
			return variable.identifiers.length === 0 ? variable : null;
		}
	}

	/* c8 ignore next */
	return null;
}

/**
 * Checks whether or not a given node is a callback.
 * @param {ASTNode} node A node to check.
 * @returns {CallbackInfo} Whether the node is a callback, and whether it is bound with `.bind(this)`.
 * @throws {Error} (Unreachable.)
 */
function getCallbackInfo(node) {
	const retv = { isCallback: false, isLexicalThis: false };
	let currentNode = node;
	let parent = node.parent;
	let bound = false;

	while (currentNode) {
		switch (parent.type) {
			// Checks parents recursively.

			case "LogicalExpression":
			case "ChainExpression":
			case "ConditionalExpression":
				break;

			// Checks whether the parent node is `.bind(this)` call.
			case "MemberExpression":
				if (
					parent.object === currentNode &&
					!parent.property.computed &&
					parent.property.type === "Identifier" &&
					parent.property.name === "bind"
				) {
					const maybeCallee =
						parent.parent.type === "ChainExpression"
							? parent.parent
							: parent;

					if (astUtils.isCallee(maybeCallee)) {
						if (!bound) {
							bound = true; // Use only the first `.bind()` to make `isLexicalThis` value.
							retv.isLexicalThis =
								maybeCallee.parent.arguments.length === 1 &&
								maybeCallee.parent.arguments[0].type ===
									"ThisExpression";
						}
						parent = maybeCallee.parent;
					} else {
						return retv;
					}
				} else {
					return retv;
				}
				break;

			// Checks whether the node is a callback.
			case "CallExpression":
			case "NewExpression":
				if (parent.callee !== currentNode) {
					retv.isCallback = true;
				}
				return retv;

			default:
				return retv;
		}

		currentNode = parent;
		parent = parent.parent;
	}

	/* c8 ignore next */
	throw new Error("unreachable");
}

/**
 * Checks whether a simple list of parameters contains any duplicates. This does not handle complex
 * parameter lists (e.g. with destructuring), since complex parameter lists are a SyntaxError with duplicate
 * parameter names anyway. Instead, it always returns `false` for complex parameter lists.
 * @param {Array<ASTNode>} paramsList The list of parameters for a function
 * @returns {boolean} `true` if the list of parameters contains any duplicates
 */
function hasDuplicateParams(paramsList) {
	return (
		paramsList.every(param => param.type === "Identifier") &&
		paramsList.length !== new Set(paramsList.map(param => param.name)).size
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{ allowNamedFunctions: false, allowUnboundThis: true },
		],

		docs: {
			description: "Require using arrow functions for callbacks",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/prefer-arrow-callback",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowNamedFunctions: {
						type: "boolean",
					},
					allowUnboundThis: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		fixable: "code",

		messages: {
			preferArrowCallback: "Unexpected function expression.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ allowNamedFunctions, allowUnboundThis }] = context.options;
		const sourceCode = context.sourceCode;

		/** @type {Array<ScopeInfo>} */
		let stack = [];

		/**
		 * Pushes new function scope with all `false` flags.
		 * @returns {void}
		 */
		function enterScope() {
			stack.push({ this: false, super: false, meta: false });
		}

		/**
		 * Pops a function scope from the stack.
		 * @returns {ScopeInfo} The information of the last scope.
		 */
		function exitScope() {
			// Only a `:exit` handler pops, and its enter handler always pushed.
			return /** @type {ScopeInfo} */ (stack.pop());
		}

		return {
			/**
			 * Resets the internal state for a new file.
			 * @returns {void}
			 */
			Program() {
				stack = [];
			},

			// If there are below, it cannot replace with arrow functions merely.

			/**
			 * Records that the innermost function scope contains `this`.
			 * @returns {void}
			 */
			ThisExpression() {
				const info = stack.at(-1);

				if (info) {
					info.this = true;
				}
			},

			/**
			 * Records that the innermost function scope contains `super`.
			 * @returns {void}
			 */
			Super() {
				const info = stack.at(-1);

				if (info) {
					info.super = true;
				}
			},

			/**
			 * Records that the innermost function scope contains `new.target`.
			 * @param {ASTNode} node The MetaProperty node to check.
			 * @returns {void}
			 */
			MetaProperty(node) {
				const info = stack.at(-1);

				if (info && checkMetaProperty(node, "new", "target")) {
					info.meta = true;
				}
			},

			// To skip nested scopes.
			FunctionDeclaration: enterScope,
			"FunctionDeclaration:exit": exitScope,

			// Main.
			FunctionExpression: enterScope,

			/**
			 * Reports the function expression if it is a callback that can be
			 * written as an arrow function.
			 * @param {ASTNode} node The FunctionExpression node to check.
			 * @returns {void}
			 */
			"FunctionExpression:exit"(node) {
				const scopeInfo = exitScope();

				// Skip named function expressions
				if (allowNamedFunctions && node.id && node.id.name) {
					return;
				}

				// Skip generators.
				if (node.generator) {
					return;
				}

				// Skip recursive functions.
				const nameVar = sourceCode.getDeclaredVariables(node)[0];

				if (isFunctionName(nameVar) && nameVar.references.length > 0) {
					return;
				}

				// Skip if it's using arguments.
				const variable = getVariableOfArguments(
					sourceCode.getScope(node),
				);

				if (variable && variable.references.length > 0) {
					return;
				}

				// Reports if it's a callback which can replace with arrows.
				const callbackInfo = getCallbackInfo(node);

				if (
					callbackInfo.isCallback &&
					(!allowUnboundThis ||
						!scopeInfo.this ||
						callbackInfo.isLexicalThis) &&
					!scopeInfo.super &&
					!scopeInfo.meta
				) {
					context.report({
						node,
						messageId: "preferArrowCallback",
						/**
						 * Rewrites the function expression as an arrow function.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {Generator<EditInfo>} The fixes to apply.
						 */
						*fix(fixer) {
							if (
								(!callbackInfo.isLexicalThis &&
									scopeInfo.this) ||
								hasDuplicateParams(node.params)
							) {
								/*
								 * If the callback function does not have .bind(this) and contains a reference to `this`, there
								 * is no way to determine what `this` should be, so don't perform any fixes.
								 * If the callback function has duplicates in its list of parameters (possible in sloppy mode),
								 * don't replace it with an arrow function, because this is a SyntaxError with arrow functions.
								 */
								return;
							}

							if (
								node.params.length &&
								node.params[0].name === "this"
							) {
								return;
							}

							/*
							 * A function expression always has a `function`
							 * keyword followed by a parenthesized parameter
							 * list, so neither lookup can come back empty.
							 */
							const functionToken = /** @type {Token} */ (
								sourceCode.getFirstToken(
									node,
									node.async ? 1 : 0,
								)
							);
							const leftParenToken = /** @type {Token} */ (
								sourceCode.getTokenAfter(
									functionToken,
									astUtils.isOpeningParenToken,
								)
							);

							if (node.async) {
								if (
									functionToken.loc.end.line <
									leftParenToken.loc.start.line
								) {
									return;
								}
							}

							// Remove `.bind(this)` if exists.
							if (callbackInfo.isLexicalThis) {
								const memberNode = node.parent;

								/*
								 * If `.bind(this)` exists but the parent is not `.bind(this)`, don't remove it automatically.
								 * E.g. `(foo || function(){}).bind(this)`
								 */
								if (memberNode.type !== "MemberExpression") {
									return;
								}

								const callNode = memberNode.parent;

								/*
								 * `memberNode` is the `.bind` member expression
								 * and `callNode` the call around it, so the `.`
								 * and the closing paren are both present.
								 */
								const firstTokenToRemove =
									/** @type {Token} */ (
										sourceCode.getTokenAfter(
											memberNode.object,
											astUtils.isNotClosingParenToken,
										)
									);
								const lastTokenToRemove = /** @type {Token} */ (
									sourceCode.getLastToken(callNode)
								);

								/*
								 * If the member expression is parenthesized, don't remove the right paren.
								 * E.g. `(function(){}.bind)(this)`
								 *                    ^^^^^^^^^^^^
								 */
								if (
									astUtils.isParenthesised(
										sourceCode,
										memberNode,
									)
								) {
									return;
								}

								// If comments exist in the `.bind(this)`, don't remove those.
								if (
									sourceCode.commentsExistBetween(
										firstTokenToRemove,
										lastTokenToRemove,
									)
								) {
									return;
								}

								yield fixer.removeRange([
									firstTokenToRemove.range[0],
									lastTokenToRemove.range[1],
								]);
							}

							/*
							 * Convert the function expression to an arrow
							 * function. The body is always preceded by the
							 * closing paren of the parameter list.
							 */
							const tokenBeforeBody = /** @type {Token} */ (
								sourceCode.getTokenBefore(node.body)
							);

							if (
								sourceCode.commentsExistBetween(
									functionToken,
									leftParenToken,
								)
							) {
								// Remove only extra tokens to keep comments.
								yield fixer.remove(functionToken);
								if (node.id) {
									yield fixer.remove(node.id);
								}
							} else {
								// Remove extra tokens and spaces.
								yield fixer.removeRange([
									functionToken.range[0],
									leftParenToken.range[0],
								]);
							}
							yield fixer.insertTextAfter(tokenBeforeBody, " =>");

							// Get the node that will become the new arrow function.
							let replacedNode = callbackInfo.isLexicalThis
								? node.parent.parent
								: node;

							if (replacedNode.type === "ChainExpression") {
								replacedNode = replacedNode.parent;
							}

							/*
							 * If the replaced node is part of a BinaryExpression, LogicalExpression, or MemberExpression, then
							 * the arrow function needs to be parenthesized, because `foo || () => {}` is invalid syntax even
							 * though `foo || function() {}` is valid.
							 */
							if (
								replacedNode.parent.type !== "CallExpression" &&
								replacedNode.parent.type !==
									"ConditionalExpression" &&
								!astUtils.isParenthesised(
									sourceCode,
									replacedNode,
								) &&
								!astUtils.isParenthesised(sourceCode, node)
							) {
								yield fixer.insertTextBefore(replacedNode, "(");
								yield fixer.insertTextAfter(replacedNode, ")");
							}
						},
					});
				}
			},
		};
	},
};

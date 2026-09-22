/**
 * @fileoverview Rule to enforce return statements in callbacks of array's methods
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");
const { isAnySegmentReachable } = require("./utils/code-path-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").SuggestionDescriptor} SuggestionDescriptor */
/** @typedef {import("./utils/types.js").SourceCode} SourceCode */
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").CodePathSegment} CodePathSegment */

/**
 * The per-function state this rule stacks as the code path analysis walks the
 * file. `upper` links each entry to the one for the enclosing function.
 * @typedef {Object} FuncInfo
 * @property {string | null} arrayMethodName The array method this function is a callback of, if any.
 * @property {FuncInfo} upper The entry for the enclosing function.
 * @property {CodePath | null} codePath The code path for this function.
 * @property {boolean} hasReturn Whether a `return` statement has been seen.
 * @property {boolean} shouldCheck Whether this function is a callback worth checking.
 * @property {ASTNode | null} node The function node itself.
 * @property {Set<CodePathSegment>} currentSegments The segments currently being traversed.
 */

/**
 * The message and suggestions a check has decided on, built up in place before
 * a single `context.report()` at the end.
 * @typedef {{ messageId: string, suggest: Array<SuggestionDescriptor> }} MessageAndSuggestions
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const TARGET_NODE_TYPE = /^(?:Arrow)?FunctionExpression$/u;
const TARGET_METHODS =
	/^(?:every|filter|find(?:Last)?(?:Index)?|flatMap|forEach|map|reduce(?:Right)?|some|sort|toSorted)$/u;

/**
 * Checks a given node is a member access which has the specified name's
 * property.
 * @param {ASTNode} node A node to check.
 * @returns {boolean} `true` if the node is a member access which has
 *      the specified name's property. The node may be a `(Chain|Member)Expression` node.
 */
function isTargetMethod(node) {
	return astUtils.isSpecificMemberAccess(node, null, TARGET_METHODS);
}

/**
 * Returns a human-legible description of an array method
 * @param {string} arrayMethodName A method name to fully qualify
 * @returns {string} the method name prefixed with `Array.` if it is a class method,
 *      or else `Array.prototype.` if it is an instance method.
 */
function fullMethodName(arrayMethodName) {
	if (["from", "fromAsync", "of", "isArray"].includes(arrayMethodName)) {
		return "Array.".concat(arrayMethodName);
	}
	return "Array.prototype.".concat(arrayMethodName);
}

/**
 * Checks whether or not a given node is a function expression which is the
 * callback of an array method, returning the method name.
 * Generators are excluded. Async functions are allowed only for `Array.fromAsync`.
 * @param {ASTNode} node A node to check. This is one of
 *      FunctionExpression or ArrowFunctionExpression.
 * @returns {string | null} The method name if the node is a callback method,
 *      null otherwise.
 */
function getArrayMethodName(node) {
	// Generators are not checked for any methods.
	if (node.generator) {
		return null;
	}
	let currentNode = node;

	while (currentNode) {
		const parent = currentNode.parent;

		switch (parent.type) {
			/*
			 * Looks up the destination. e.g.,
			 * foo.every(nativeFoo || function foo() { ... });
			 */
			case "LogicalExpression":
			case "ConditionalExpression":
			case "ChainExpression":
				currentNode = parent;
				break;

			/*
			 * If the upper function is IIFE, checks the destination of the return value.
			 * e.g.
			 *   foo.every((function() {
			 *     // setup...
			 *     return function callback() { ... };
			 *   })());
			 */
			case "ReturnStatement": {
				const func = astUtils.getUpperFunction(parent);

				if (func === null || !astUtils.isCallee(func)) {
					return null;
				}
				currentNode = func.parent;
				break;
			}

			/*
			 * e.g.
			 *   Array.from([], function() {});
			 *   list.every(function() {});
			 */
			case "CallExpression":
				if (!node.async) {
					if (astUtils.isArrayFromMethod(parent.callee)) {
						if (
							parent.arguments.length >= 2 &&
							parent.arguments[1] === currentNode
						) {
							return "from";
						}
					}
					if (isTargetMethod(parent.callee)) {
						if (
							parent.arguments.length >= 1 &&
							parent.arguments[0] === currentNode
						) {
							return astUtils.getStaticPropertyName(
								parent.callee,
							);
						}
					}
				}
				if (astUtils.isArrayFromAsyncMethod(parent.callee)) {
					if (
						parent.arguments.length >= 2 &&
						parent.arguments[1] === currentNode
					) {
						return "fromAsync";
					}
				}
				return null;

			// Otherwise this node is not target.
			default:
				return null;
		}
	}

	/* c8 ignore next */
	return null;
}

/**
 * Checks if the given node is a void expression.
 * @param {ASTNode} node The node to check.
 * @returns {boolean} `true` if the node is a void expression
 */
function isExpressionVoid(node) {
	return node.type === "UnaryExpression" && node.operator === "void";
}

/**
 * Fixes the linting error by prepending "void " to the given node
 * @param {SourceCode} sourceCode context given by context.sourceCode
 * @param {ASTNode} node The node to fix.
 * @param {RuleFixer} fixer The fixer object provided by ESLint.
 * @returns {Array<EditInfo>} An array of fix objects to apply to the node.
 */
function voidPrependFixer(sourceCode, node, fixer) {
	const requiresParens =
		// prepending `void ` will fail if the node has a lower precedence than void
		astUtils.getPrecedence(node) <
			astUtils.getPrecedence(
				/** @type {ASTNode} */ (
					/** @type {unknown} */ ({
						type: "UnaryExpression",
						operator: "void",
					})
				),
			) &&
		// check if there are parentheses around the node to avoid redundant parentheses
		!astUtils.isParenthesised(sourceCode, node);

	// avoid parentheses issues
	/*
	 * The node being fixed is either an arrow body or a `return` argument, so
	 * the `=>` or `return` that introduces it is always there, and a token
	 * always follows it.
	 */
	const returnOrArrowToken = /** @type {Token} */ (
		sourceCode.getTokenBefore(
			node,
			node.parent.type === "ArrowFunctionExpression"
				? astUtils.isArrowToken
				: // isReturnToken
					(/** @type {Token} */ token) =>
						token.type === "Keyword" && token.value === "return",
		)
	);

	const firstToken = /** @type {Token} */ (
		sourceCode.getTokenAfter(returnOrArrowToken)
	);

	const prependSpace =
		// is return token, as => allows void to be adjacent
		returnOrArrowToken.value === "return" &&
		// If two tokens (return and "(") are adjacent
		returnOrArrowToken.range[1] === firstToken.range[0];

	return [
		fixer.insertTextBefore(
			firstToken,
			`${prependSpace ? " " : ""}void ${requiresParens ? "(" : ""}`,
		),
		fixer.insertTextAfter(node, requiresParens ? ")" : ""),
	];
}

/**
 * Fixes the linting error by `wrapping {}` around the given node's body.
 * @param {SourceCode} sourceCode context given by context.sourceCode
 * @param {ASTNode} node The node to fix.
 * @param {RuleFixer} fixer The fixer object provided by ESLint.
 * @returns {Array<EditInfo>} An array of fix objects to apply to the node.
 */
function curlyWrapFixer(sourceCode, node, fixer) {
	// An arrow function always has a `=>`, a body, and a last token.
	const arrowToken = /** @type {Token} */ (
		sourceCode.getTokenBefore(node.body, astUtils.isArrowToken)
	);
	const firstToken = /** @type {Token} */ (
		sourceCode.getTokenAfter(arrowToken)
	);
	const lastToken = /** @type {Token} */ (sourceCode.getLastToken(node));

	return [
		fixer.insertTextBefore(firstToken, "{"),
		fixer.insertTextAfter(lastToken, "}"),
	];
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				allowImplicit: false,
				checkForEach: false,
				allowVoid: false,
			},
		],

		docs: {
			description:
				"Enforce `return` statements in callbacks of array methods",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/array-callback-return",
		},

		hasSuggestions: true,

		schema: [
			{
				type: "object",
				properties: {
					allowImplicit: {
						type: "boolean",
					},
					checkForEach: {
						type: "boolean",
					},
					allowVoid: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			expectedAtEnd:
				"{{arrayMethodName}}() expects a value to be returned at the end of {{name}}.",
			expectedInside:
				"{{arrayMethodName}}() expects a return value from {{name}}.",
			expectedReturnValue:
				"{{arrayMethodName}}() expects a return value from {{name}}.",
			expectedNoReturnValue:
				"{{arrayMethodName}}() expects no useless return value from {{name}}.",
			wrapBraces: "Wrap the expression in `{}`.",
			prependVoid: "Prepend `void` to the expression.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [options] = context.options;
		const sourceCode = context.sourceCode;

		/*
		 * The root of the `upper` chain. It stands in for "no enclosing
		 * function" and is never inspected: `shouldCheck` is `false`, so every
		 * check returns before reading `currentSegments`, and `upper` is only
		 * followed from an entry pushed by `onCodePathStart`.
		 */
		let funcInfo = /** @type {FuncInfo} */ (
			/** @type {unknown} */ ({
				arrayMethodName: null,
				upper: null,
				codePath: null,
				hasReturn: false,
				shouldCheck: false,
				node: null,
			})
		);

		/**
		 * Checks whether or not the last code path segment is reachable.
		 * Then reports this function if the segment is reachable.
		 *
		 * If the last code path segment is reachable, there are paths which are not
		 * returned or thrown.
		 * @param {ASTNode} node A node to check.
		 * @returns {void}
		 */
		function checkLastSegment(node) {
			if (!funcInfo.shouldCheck) {
				return;
			}

			/** @type {MessageAndSuggestions} */
			const messageAndSuggestions = { messageId: "", suggest: [] };

			if (funcInfo.arrayMethodName === "forEach") {
				if (
					options.checkForEach &&
					node.type === "ArrowFunctionExpression" &&
					node.expression
				) {
					if (options.allowVoid) {
						if (isExpressionVoid(node.body)) {
							return;
						}

						messageAndSuggestions.messageId =
							"expectedNoReturnValue";
						messageAndSuggestions.suggest = [
							{
								messageId: "wrapBraces",
								fix(fixer) {
									return curlyWrapFixer(
										sourceCode,
										node,
										fixer,
									);
								},
							},
							{
								messageId: "prependVoid",
								fix(fixer) {
									return voidPrependFixer(
										sourceCode,
										node.body,
										fixer,
									);
								},
							},
						];
					} else {
						messageAndSuggestions.messageId =
							"expectedNoReturnValue";
						messageAndSuggestions.suggest = [
							{
								messageId: "wrapBraces",
								fix(fixer) {
									return curlyWrapFixer(
										sourceCode,
										node,
										fixer,
									);
								},
							},
						];
					}
				}
			} else {
				if (
					node.body.type === "BlockStatement" &&
					isAnySegmentReachable(funcInfo.currentSegments)
				) {
					messageAndSuggestions.messageId = funcInfo.hasReturn
						? "expectedAtEnd"
						: "expectedInside";
				}
			}

			if (messageAndSuggestions.messageId) {
				const name = astUtils.getFunctionNameWithKind(node);

				context.report({
					node,
					loc: astUtils.getFunctionHeadLoc(node, sourceCode),
					messageId: messageAndSuggestions.messageId,
					data: {
						name,
						arrayMethodName: fullMethodName(
							/*
							 * `shouldCheck` is only `true` when
							 * `getArrayMethodName()` found a name, and the
							 * check above returns early when it is `false`.
							 */
							/** @type {string} */ (funcInfo.arrayMethodName),
						),
					},
					suggest:
						messageAndSuggestions.suggest.length !== 0
							? messageAndSuggestions.suggest
							: null,
				});
			}
		}

		return {
			// Stacks this function's information.
			onCodePathStart(codePath, node) {
				let methodName = null;

				if (TARGET_NODE_TYPE.test(node.type)) {
					methodName = getArrayMethodName(node);
				}

				funcInfo = {
					arrayMethodName: methodName,
					upper: funcInfo,
					codePath,
					hasReturn: false,
					shouldCheck: !!methodName,
					node,
					currentSegments: new Set(),
				};
			},

			// Pops this function's information.
			onCodePathEnd() {
				funcInfo = funcInfo.upper;
			},

			onUnreachableCodePathSegmentStart(segment) {
				funcInfo.currentSegments.add(segment);
			},

			onUnreachableCodePathSegmentEnd(segment) {
				funcInfo.currentSegments.delete(segment);
			},

			onCodePathSegmentStart(segment) {
				funcInfo.currentSegments.add(segment);
			},

			onCodePathSegmentEnd(segment) {
				funcInfo.currentSegments.delete(segment);
			},

			// Checks the return statement is valid.
			ReturnStatement(node) {
				if (!funcInfo.shouldCheck) {
					return;
				}

				funcInfo.hasReturn = true;

				/** @type {MessageAndSuggestions} */
				const messageAndSuggestions = { messageId: "", suggest: [] };

				if (funcInfo.arrayMethodName === "forEach") {
					// if checkForEach: true, returning a value at any path inside a forEach is not allowed
					if (options.checkForEach && node.argument) {
						if (options.allowVoid) {
							if (isExpressionVoid(node.argument)) {
								return;
							}

							messageAndSuggestions.messageId =
								"expectedNoReturnValue";
							messageAndSuggestions.suggest = [
								{
									messageId: "prependVoid",
									fix(fixer) {
										return voidPrependFixer(
											sourceCode,
											node.argument,
											fixer,
										);
									},
								},
							];
						} else {
							messageAndSuggestions.messageId =
								"expectedNoReturnValue";
						}
					}
				} else {
					// if allowImplicit: false, should also check node.argument
					if (!options.allowImplicit && !node.argument) {
						messageAndSuggestions.messageId = "expectedReturnValue";
					}
				}

				if (messageAndSuggestions.messageId) {
					context.report({
						node,
						messageId: messageAndSuggestions.messageId,
						data: {
							// As in `checkLastSegment()`: `shouldCheck` implies both.
							name: astUtils.getFunctionNameWithKind(
								/** @type {ASTNode} */ (funcInfo.node),
							),
							arrayMethodName: fullMethodName(
								/** @type {string} */ (
									funcInfo.arrayMethodName
								),
							),
						},
						suggest:
							messageAndSuggestions.suggest.length !== 0
								? messageAndSuggestions.suggest
								: null,
					});
				}
			},

			// Reports a given function if the last path is reachable.
			"FunctionExpression:exit": checkLastSegment,
			"ArrowFunctionExpression:exit": checkLastSegment,
		};
	},
};

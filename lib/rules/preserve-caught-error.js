/**
 * @fileoverview Rule to preserve caught errors when re-throwing exceptions
 * @author Amnish Singh Arora
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
/** @typedef {import("./utils/ast-utils.js").Scope} Scope */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

/**
 * What the `cause` property of a thrown error was found to be set to.
 * @typedef {Object} ErrorCause
 * @property {ASTNode} value The node the `cause` property is set to.
 * @property {boolean} multipleDefinitions Whether the options object defines `cause` more than once.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/*
 * This is an indicator of an error cause node, that is too complicated to be detected and fixed.
 * Eg, when error options is an `Identifier` or a `SpreadElement`.
 */
const UNKNOWN_CAUSE = Symbol("unknown_cause");

const BUILT_IN_ERROR_TYPES = new Set([
	"Error",
	"EvalError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
	"AggregateError",
]);

/**
 * Finds and returns information about the `cause` property of an error being thrown.
 * @param {ASTNode} throwStatement `ThrowStatement` to be checked.
 * @param {number} optionsIndex The index of the options argument in the error constructor.
 * @returns {ErrorCause | typeof UNKNOWN_CAUSE | null} Information about the `cause` of the
 * error being thrown, such as the value node and whether there are multiple definitions of
 * `cause`. `UNKNOWN_CAUSE` if the options are too complicated to analyze, and `null` if there
 * is no `cause`.
 */
function getErrorCause(throwStatement, optionsIndex) {
	const throwExpression = throwStatement.argument;

	/*
	 * Make sure there is no `SpreadElement` at or before the `optionsIndex`
	 * as this messes up the effective order of arguments and makes it complicated
	 * to track where the actual error options need to be at
	 */
	const spreadExpressionIndex = throwExpression.arguments.findIndex(
		(/** @type {ASTNode} */ arg) => arg.type === "SpreadElement",
	);
	if (spreadExpressionIndex >= 0 && spreadExpressionIndex <= optionsIndex) {
		return UNKNOWN_CAUSE;
	}

	const errorOptions = throwExpression.arguments[optionsIndex];

	if (errorOptions) {
		if (errorOptions.type === "ObjectExpression") {
			if (
				errorOptions.properties.some(
					(/** @type {ASTNode} */ prop) =>
						prop.type === "SpreadElement",
				)
			) {
				/*
				 * If there is a spread element as part of error options, it is too complicated
				 * to verify if the cause is used properly and auto-fix.
				 */
				return UNKNOWN_CAUSE;
			}

			const causeProperties = errorOptions.properties.filter(
				(/** @type {ASTNode} */ prop) =>
					astUtils.getStaticPropertyName(prop) === "cause",
			);

			const causeProperty = causeProperties.at(-1);
			return causeProperty
				? {
						value: causeProperty.value,
						multipleDefinitions: causeProperties.length > 1,
					}
				: null;
		}

		// Error options exist, but too complicated to be analyzed/fixed
		return UNKNOWN_CAUSE;
	}

	return null;
}

/**
 * Finds and returns the `CatchClause` node, that the `node` is part of.
 * @param {ASTNode} node The AST node to be evaluated.
 * @returns {ASTNode | null} The closest parent `CatchClause` node, `null` if the `node` is not in a catch block.
 */
function findParentCatch(node) {
	// The walk stops at `Program`, whose `parent` is `null`.
	let currentNode = /** @type {ASTNode | null} */ (node);

	while (currentNode && currentNode.type !== "CatchClause") {
		if (
			[
				"FunctionDeclaration",
				"FunctionExpression",
				"ArrowFunctionExpression",
				"StaticBlock",
			].includes(currentNode.type)
		) {
			/*
			 * Make sure the ThrowStatement is not made inside a function definition or a static block inside a high level catch.
			 * In such cases, the caught error is not directly related to the Throw.
			 *
			 * For example,
			 * try {
			 * } catch (error) {
			 * 	foo = {
			 * 		bar() {
			 *	 	throw new Error();
			 * 	  }
			 * };
			 * }
			 */
			return null;
		}
		currentNode = currentNode.parent;
	}

	return currentNode;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				requireCatchParameter: false,
				errorClassNames: [],
			},
		],

		docs: {
			description:
				"Disallow losing originally caught error when re-throwing custom errors",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/preserve-caught-error", // URL to the documentation page for this rule
		},
		schema: [
			{
				type: "object",
				properties: {
					requireCatchParameter: {
						type: "boolean",
						description:
							"Requires the catch blocks to always have the caught error parameter so it is not discarded.",
					},
					errorClassNames: {
						type: "array",
						description:
							"Additional error class names to check for cause preservation.",
						items: {
							oneOf: [
								{
									type: "string",
								},
								{
									type: "object",
									required: ["name", "argumentPosition"],
									properties: {
										name: {
											type: "string",
										},
										argumentPosition: {
											type: "integer",
											minimum: 1,
										},
									},
									additionalProperties: false,
								},
							],
						},
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			missingCause:
				"There is no `cause` attached to the symptom error being thrown.",
			incorrectCause:
				"The symptom error is being thrown with an incorrect `cause`.",
			includeCause:
				"Include the original caught error as the `cause` of the symptom error.",
			missingCatchErrorParam:
				"The caught error is not accessible because the catch clause lacks the error parameter. Start referencing the caught error using the catch parameter.",
			partiallyLostError:
				"Re-throws cannot preserve the caught error as a part of it is being lost due to destructuring.",
			caughtErrorShadowed:
				"The caught error is being attached as `cause`, but is shadowed by a closer scoped redeclaration.",
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
		const [{ requireCatchParameter, errorClassNames }] = context.options;

		const errorClassNamesMap = new Map();
		for (const item of errorClassNames) {
			const name = typeof item === "string" ? item : item.name;
			const argumentPosition =
				typeof item === "string" ? 2 : item.argumentPosition;

			errorClassNamesMap.set(name, argumentPosition);
		}

		//----------------------------------------------------------------------
		// Helpers
		//----------------------------------------------------------------------

		/**
		 * Checks if the given callee refers to a built-in global Error constructor.
		 * @param {ASTNode} callee The callee node.
		 * @returns {boolean} `true` if the callee is a built-in global Error constructor.
		 */
		function isBuiltInGlobalError(callee) {
			return (
				callee.type === "Identifier" &&
				BUILT_IN_ERROR_TYPES.has(callee.name) &&
				sourceCode.isGlobalReference(callee)
			);
		}

		/**
		 * Checks if a `ThrowStatement` is constructing and throwing a new `Error` object.
		 *
		 * Covers all the error types on `globalThis` that support `cause` property:
		 * https://github.com/microsoft/TypeScript/blob/main/src/lib/es2022.error.d.ts
		 * @param {ASTNode} throwStatement The `ThrowStatement` that needs to be checked.
		 * @returns {boolean} `true` if a new "Error" is being thrown, else `false`.
		 */
		function isThrowingNewError(throwStatement) {
			if (!(
				throwStatement.argument.type === "NewExpression" ||
				throwStatement.argument.type === "CallExpression"
			)) {
				return false;
			}

			const callee = throwStatement.argument.callee;

			/*
			 * Make sure the thrown Error instance is one of the built-in global error types.
			 * Custom imports could shadow this, which would lead to false positives.
			 * e.g. import { Error } from "./my-custom-error.js";
			 *      throw Error("Failed to perform error prone operations");
			 */
			if (isBuiltInGlobalError(callee)) {
				return true;
			}

			const target =
				callee.type === "MemberExpression" && !callee.computed
					? callee.property
					: callee;

			return (
				target.type === "Identifier" &&
				errorClassNamesMap.has(target.name)
			);
		}

		/**
		 * Inserts `cause: <caughtErrorName>` into an inline options object expression.
		 * @param {RuleFixer} fixer The fixer object.
		 * @param {ASTNode} optionsNode The options object node.
		 * @param {string} caughtErrorName The name of the caught error (e.g., "err").
		 * @returns {EditInfo} The fix object.
		 */
		function insertCauseIntoOptions(fixer, optionsNode, caughtErrorName) {
			const properties = optionsNode.properties;

			if (properties.length === 0) {
				// Insert inside empty braces: `{}` → `{ cause: err }`
				return fixer.insertTextAfter(
					// An `ObjectExpression` always starts with its `{` token.
					/** @type {Token} */ (
						sourceCode.getFirstToken(optionsNode)
					),
					`cause: ${caughtErrorName}`,
				);
			}

			const lastProp = properties.at(-1);
			return fixer.insertTextAfter(
				lastProp,
				`, cause: ${caughtErrorName}`,
			);
		}

		/**
		 * Finds the first token that isn't followed by a closing parenthesis in a specified range.
		 * This is the token after which new arguments should be inserted.
		 * @param {Token} firstToken The first token to start searching from.
		 * @param {Token} lastToken The last token to scan up to (inclusive).
		 * @returns {Token} The first token that isn't followed by a closing parenthesis, or `lastToken` if none is found.
		 */
		function findInsertionTokenAfterParens(firstToken, lastToken) {
			const lastIndex = lastToken.range[1];
			let token = firstToken;

			/*
			 * Both tokens belong to a `ThrowStatement` inside a `CatchClause`, so
			 * the catch block's `}` always follows them: the scan can never run off
			 * the end of the program and `getTokenAfter()` never returns `null`.
			 */
			let nextToken = /** @type {Token} */ (
				sourceCode.getTokenAfter(token)
			);

			while (
				nextToken.range[1] <= lastIndex &&
				astUtils.isClosingParenToken(nextToken)
			) {
				token = nextToken;
				nextToken = /** @type {Token} */ (
					sourceCode.getTokenAfter(token)
				);
			}
			return token;
		}

		/**
		 * Adds arguments for a call/new expression with no arguments.
		 * Works for `new Error`, `new (Error)`, and forms that already include empty argument parentheses.
		 * @param {RuleFixer} fixer The fixer instance.
		 * @param {ASTNode} throwExpression The thrown CallExpression or NewExpression node.
		 * @param {string} text The arguments to insert.
		 * @returns {EditInfo} The fixer operation.
		 */
		function addArgumentsToEmptyCall(fixer, throwExpression, text) {
			/*
			 * Every node spans at least one token, so the last token of the
			 * expression and of its callee always exist.
			 */
			const callClosingParenToken = /** @type {Token} */ (
				sourceCode.getLastToken(throwExpression)
			);
			const lastCalleeToken = /** @type {Token} */ (
				sourceCode.getLastToken(throwExpression.callee)
			);
			const parenToken = sourceCode.getFirstTokenBetween(
				lastCalleeToken,
				callClosingParenToken,
				astUtils.isOpeningParenToken,
			);

			if (parenToken) {
				return fixer.insertTextAfter(parenToken, text);
			}

			const insertionToken = findInsertionTokenAfterParens(
				lastCalleeToken,
				callClosingParenToken,
			);

			return fixer.insertTextAfter(insertionToken, `(${text})`);
		}

		/**
		 * Appends additional arguments after the last argument of a call/new expression,
		 * accounting for any wrapping parentheses around that argument.
		 * @param {RuleFixer} fixer The fixer instance.
		 * @param {ASTNode} throwExpression The thrown CallExpression or NewExpression node.
		 * @param {string} text The additional arguments to insert, including the leading comma.
		 * @returns {EditInfo} The fixer operation.
		 */
		function appendArguments(fixer, throwExpression, text) {
			const lastArgument = throwExpression.arguments.at(-1);

			/*
			 * Callers only reach here when the call has at least one argument, so
			 * `lastArgument` spans a token, and the argument list's `)` is preceded
			 * by at least that token — both lookups therefore hit.
			 */
			const lastArgumentToken = /** @type {Token} */ (
				sourceCode.getLastToken(lastArgument)
			);
			const lastTokenBeforeArgListParen = /** @type {Token} */ (
				sourceCode.getLastToken(throwExpression, { skip: 1 })
			);
			const insertionToken = findInsertionTokenAfterParens(
				lastArgumentToken,
				lastTokenBeforeArgListParen,
			);

			return fixer.insertTextAfter(insertionToken, text);
		}

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------
		return {
			/**
			 * Checks a `throw` inside a `catch` for a preserved `cause`.
			 * @param {ASTNode} node The `ThrowStatement` node.
			 * @returns {void}
			 */
			ThrowStatement(node) {
				// Check if the throw is inside a catch block
				const parentCatch = findParentCatch(node);
				const throwStatement = node;

				// Check if a new error is being thrown in a catch block
				if (parentCatch && isThrowingNewError(throwStatement)) {
					if (
						parentCatch.param &&
						parentCatch.param.type !== "Identifier"
					) {
						/*
						 * When a part of the caught error is being lost at the parameter level, commonly due to destructuring.
						 * e.g. catch({ message, ...rest })
						 */
						context.report({
							messageId: "partiallyLostError",
							node: parentCatch,
						});
						return;
					}

					const caughtError =
						parentCatch.param?.type === "Identifier"
							? parentCatch.param
							: null;

					// Check if there are throw statements and caught error is being ignored
					if (!caughtError) {
						if (requireCatchParameter) {
							context.report({
								node: throwStatement,
								messageId: "missingCatchErrorParam",
							});
							return;
						}
						return;
					}

					// Determine the options argument index
					const callee = throwStatement.argument.callee;
					const errorClassName =
						callee.type === "Identifier"
							? callee.name
							: callee.property.name;

					const builtInGlobalError = isBuiltInGlobalError(callee);

					let optionsIndex;
					if (builtInGlobalError) {
						optionsIndex =
							errorClassName === "AggregateError" ? 2 : 1;
					} else {
						const argumentPosition =
							errorClassNamesMap.get(errorClassName);
						optionsIndex = argumentPosition - 1;
					}

					// Check if there is a cause attached to the new error
					const errorCauseInfo = getErrorCause(
						throwStatement,
						optionsIndex,
					);

					if (errorCauseInfo === UNKNOWN_CAUSE) {
						// Error options exist, but too complicated to be analyzed/fixed
						return;
					}

					if (errorCauseInfo === null) {
						// If there is no `cause` attached to the error being thrown.
						context.report({
							messageId: "missingCause",
							node: throwStatement,
							suggest: [
								{
									messageId: "includeCause",
									/**
									 * Adds the caught error as the `cause` of the thrown error.
									 * @param {RuleFixer} fixer The fixer to use.
									 * @returns {EditInfo | null} The fix, or `null` if none is safe.
									 */
									fix(fixer) {
										const throwExpression =
											throwStatement.argument;
										const args = throwExpression.arguments;

										/**
										 * Inserts `cause` into the options argument if it is an `ObjectExpression`.
										 * @param {ASTNode} optionsArg The options argument node.
										 * @returns {EditInfo | null} The fix, or `null` if the argument is not an object.
										 */
										function fixExistingOptions(
											optionsArg,
										) {
											if (
												optionsArg.type ===
												"ObjectExpression"
											) {
												return insertCauseIntoOptions(
													fixer,
													optionsArg,
													caughtError.name,
												);
											}
											return null;
										}

										// AggregateError: errors, message, options
										if (
											builtInGlobalError &&
											errorClassName === "AggregateError"
										) {
											const errorsArg = args[0];
											const messageArg = args[1];
											const optionsArg = args[2];

											if (!errorsArg) {
												// Case: `throw new AggregateError()` → insert all arguments
												return addArgumentsToEmptyCall(
													fixer,
													throwExpression,
													`[], "", { cause: ${caughtError.name} }`,
												);
											}

											if (!messageArg) {
												// Case: `throw new AggregateError([])` → insert message and options
												return appendArguments(
													fixer,
													throwExpression,
													`, "", { cause: ${caughtError.name} }`,
												);
											}

											if (!optionsArg) {
												// Case: `throw new AggregateError([], "")` → insert error options only
												return appendArguments(
													fixer,
													throwExpression,
													`, { cause: ${caughtError.name} }`,
												);
											}

											return fixExistingOptions(
												optionsArg,
											);
										}

										// Normal Error types
										if (builtInGlobalError) {
											const messageArg = args[0];
											const optionsArg = args[1];

											if (!messageArg) {
												// Case: `throw new Error()` → insert both message and options
												return addArgumentsToEmptyCall(
													fixer,
													throwExpression,
													`"", { cause: ${caughtError.name} }`,
												);
											}
											if (!optionsArg) {
												// Case: `throw new Error("Some message")` → insert only options
												return appendArguments(
													fixer,
													throwExpression,
													`, { cause: ${caughtError.name} }`,
												);
											}

											return fixExistingOptions(
												optionsArg,
											);
										}

										// Custom error types
										const optionsArg = args[optionsIndex];

										/*
										 * Custom error signature is unknown, so skip the suggestion rather
										 * than synthesize placeholder values for missing positional args.
										 */
										if (args.length < optionsIndex) {
											return null;
										}

										if (!optionsArg) {
											const lastProvidedArg = args.at(-1);

											if (lastProvidedArg) {
												// Options slot missing, all prior args provided → append options
												return appendArguments(
													fixer,
													throwExpression,
													`, { cause: ${caughtError.name} }`,
												);
											}

											// argumentPosition: 1 and no args → insert options inside parens
											return addArgumentsToEmptyCall(
												fixer,
												throwExpression,
												`{ cause: ${caughtError.name} }`,
											);
										}

										return fixExistingOptions(optionsArg);
									},
								},
							],
						});

						// We don't need to check further
						return;
					}

					const { value: thrownErrorCause } = errorCauseInfo;

					// If there is an attached cause, verify that it matches the caught error
					if (!(
						thrownErrorCause.type === "Identifier" &&
						thrownErrorCause.name === caughtError.name
					)) {
						const suggest = errorCauseInfo.multipleDefinitions
							? null // If there are multiple `cause` definitions, a suggestion could be confusing.
							: [
									{
										messageId: "includeCause",
										/**
										 * Replaces the wrong `cause` with the caught error.
										 * @param {RuleFixer} fixer The fixer to use.
										 * @returns {EditInfo} The fix.
										 */
										fix(fixer) {
											/*
											 * In case `cause` is attached using object property shorthand or as a method or accessor.
											 * e.g. throw Error("fail", { cause });
											 *      throw Error("fail", { cause() { doSomething(); } });
											 *      throw Error("fail", { get cause() { return error; } });
											 */
											if (
												thrownErrorCause.parent
													.method ||
												thrownErrorCause.parent
													.shorthand ||
												thrownErrorCause.parent.kind !==
													"init"
											) {
												return fixer.replaceText(
													thrownErrorCause.parent,
													`cause: ${caughtError.name}`,
												);
											}

											return fixer.replaceText(
												thrownErrorCause,
												caughtError.name,
											);
										},
									},
								];
						context.report({
							messageId: "incorrectCause",
							node: thrownErrorCause,
							suggest,
						});
						return;
					}

					/*
					 * If the attached cause matches the identifier name of the caught error,
					 * make sure it is not being shadowed by a closer scoped redeclaration.
					 *
					 * e.g. try {
					 *      doSomething();
					 * 	  } catch (error) {
					 * 	     if (whatever) {
					 * 	       const error = anotherError;
					 * 	       throw new Error("Something went wrong");
					 * 	     }
					 *   }
					 */
					// `scope.upper` is `null` on the global scope, ending the walk.
					let scope = /** @type {Scope | null} */ (
						sourceCode.getScope(throwStatement)
					);
					/*
					 * The body only re-runs while `scope` is truthy, and the first
					 * run gets a scope straight from `getScope()`, so `scope` is
					 * never `null` here. TypeScript does not carry the `while`
					 * condition's narrowing back across the `do` loop's back edge,
					 * hence the casts.
					 */
					do {
						const variable = /** @type {Scope} */ (scope).set.get(
							caughtError.name,
						);
						if (variable) {
							break;
						}
						scope = /** @type {Scope} */ (scope).upper;
					} while (scope);

					if (scope?.block !== parentCatch) {
						// Caught error is being shadowed
						context.report({
							messageId: "caughtErrorShadowed",
							node: throwStatement,
						});
					}
				}
			},
		};
	},
};

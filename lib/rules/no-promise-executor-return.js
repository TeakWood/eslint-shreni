/**
 * @fileoverview Rule to disallow returning values from Promise executor functions
 * @author Milos Djermanovic
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").SourceCode} SourceCode */
/** @typedef {import("./utils/types.js").SuggestionDescriptor} SuggestionDescriptor */
/** @typedef {import("./utils/types.js").CodePath} CodePath */

/**
 * The per-function state this rule stacks as the code path analysis walks the
 * file. `upper` links each entry to the one for the enclosing function.
 * @typedef {Object} FuncInfo
 * @property {FuncInfo} upper The entry for the enclosing function.
 * @property {boolean} shouldCheck Whether this function is a Promise executor worth checking.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const functionTypesToCheck = new Set([
	"ArrowFunctionExpression",
	"FunctionExpression",
]);

/**
 * Determines whether the given function node is used as a Promise executor.
 * @param {ASTNode} node The node to check.
 * @param {SourceCode} sourceCode Source code to which the node belongs.
 * @returns {boolean} `true` if the node is a Promise executor.
 */
function isPromiseExecutor(node, sourceCode) {
	const parent = node.parent;

	return (
		parent.type === "NewExpression" &&
		parent.arguments[0] === node &&
		parent.callee.type === "Identifier" &&
		parent.callee.name === "Promise" &&
		sourceCode.isGlobalReference(parent.callee)
	);
}

/**
 * Checks if the given node is a void expression.
 * @param {ASTNode} node The node to check.
 * @returns {boolean} `true` if the node is a void expression
 */
function expressionIsVoid(node) {
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
	/*
	 * A stand-in for the `void` operator, used only to look up its precedence.
	 * `getPrecedence()` reads `type` and `operator` and nothing else, so the
	 * `parent`, `range` and `loc` a real node would carry are never touched.
	 */
	/** @type {unknown} */
	const voidLiteral = { type: "UnaryExpression", operator: "void" };
	const voidExpression = /** @type {ASTNode} */ (voidLiteral);

	const requiresParens =
		// prepending `void ` will fail if the node has a lower precedence than void
		astUtils.getPrecedence(node) < astUtils.getPrecedence(voidExpression) &&
		// check if there are parentheses around the node to avoid redundant parentheses
		!astUtils.isParenthesised(sourceCode, node);

	/*
	 * `node` is the body of an arrow function or the argument of a `return`,
	 * so the token before it is the `=>` or the `return` keyword, and the
	 * token after that one is the first token of `node` itself. Neither
	 * lookup can run off the start or end of the file, and neither can land
	 * on a comment because both filters match punctuation or a keyword.
	 */
	// avoid parentheses issues
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
	/*
	 * `node` is an expression-bodied arrow function, so it always has an `=>`
	 * before its body, a first token of that body after the `=>`, and a last
	 * token of its own. None of these three lookups can return `null`, and
	 * the `=>` filter cannot land on a comment.
	 */
	// https://github.com/eslint/eslint/pull/17282#issuecomment-1592795923
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
				allowVoid: false,
			},
		],

		docs: {
			description:
				"Disallow returning values from Promise executor functions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-promise-executor-return",
		},

		hasSuggestions: true,

		schema: [
			{
				type: "object",
				properties: {
					allowVoid: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			returnsValue:
				"Return values from promise executor functions cannot be read.",

			// arrow and function suggestions
			prependVoid: "Prepend `void` to the expression.",

			// only arrow suggestions
			wrapBraces: "Wrap the expression in `{}`.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/*
		 * The root of the `upper` chain. It stands in for "no enclosing code
		 * path" and is never inspected: every handler that reads `funcInfo`
		 * runs between an `onCodePathStart` and its matching `onCodePathEnd`,
		 * and `upper` is only followed from an entry `onCodePathStart` pushed.
		 */
		let funcInfo = /** @type {FuncInfo} */ (/** @type {unknown} */ (null));
		const sourceCode = context.sourceCode;
		const [{ allowVoid }] = context.options;

		return {
			/**
			 * Records whether the function starting a code path is a Promise
			 * executor, and reports an expression-bodied arrow executor.
			 * @param {CodePath} _ The code path that is starting.
			 * @param {ASTNode} node The node that starts the code path.
			 * @returns {void}
			 */
			onCodePathStart(_, node) {
				funcInfo = {
					upper: funcInfo,
					shouldCheck:
						functionTypesToCheck.has(node.type) &&
						isPromiseExecutor(node, sourceCode),
				};

				if (
					// Is a Promise executor
					funcInfo.shouldCheck &&
					node.type === "ArrowFunctionExpression" &&
					node.expression &&
					// Except void
					!(allowVoid && expressionIsVoid(node.body))
				) {
					/** @type {Array<SuggestionDescriptor>} */
					const suggest = [];

					// prevent useless refactors
					if (allowVoid) {
						suggest.push({
							messageId: "prependVoid",
							/**
							 * Prepends `void ` to the arrow function's body.
							 * @param {RuleFixer} fixer The fixer object.
							 * @returns {Array<EditInfo>} The fixes to apply.
							 */
							fix(fixer) {
								return voidPrependFixer(
									sourceCode,
									node.body,
									fixer,
								);
							},
						});
					}

					// Do not suggest wrapping an unnamed function or class expression in braces as that would be invalid syntax.
					if (!(
						(node.body.type === "FunctionExpression" ||
							node.body.type === "ClassExpression") &&
						!node.body.id
					)) {
						suggest.push({
							messageId: "wrapBraces",
							/**
							 * Wraps the arrow function's body in braces.
							 * @param {RuleFixer} fixer The fixer object.
							 * @returns {Array<EditInfo>} The fixes to apply.
							 */
							fix(fixer) {
								return curlyWrapFixer(sourceCode, node, fixer);
							},
						});
					}

					context.report({
						node: node.body,
						messageId: "returnsValue",
						suggest,
					});
				}
			},

			/**
			 * Restores the state of the enclosing function.
			 * @returns {void}
			 */
			onCodePathEnd() {
				funcInfo = funcInfo.upper;
			},

			/**
			 * Reports a `return` with a value inside a Promise executor.
			 * @param {ASTNode} node The ReturnStatement node.
			 * @returns {void}
			 */
			ReturnStatement(node) {
				if (!(funcInfo.shouldCheck && node.argument)) {
					return;
				}

				// node is `return <expression>`
				if (!allowVoid) {
					context.report({ node, messageId: "returnsValue" });
					return;
				}

				if (expressionIsVoid(node.argument)) {
					return;
				}

				// allowVoid && !expressionIsVoid
				context.report({
					node,
					messageId: "returnsValue",
					suggest: [
						{
							messageId: "prependVoid",
							/**
							 * Prepends `void ` to the returned expression.
							 * @param {RuleFixer} fixer The fixer object.
							 * @returns {Array<EditInfo>} The fixes to apply.
							 */
							fix(fixer) {
								return voidPrependFixer(
									sourceCode,
									node.argument,
									fixer,
								);
							},
						},
					],
				});
			},
		};
	},
};

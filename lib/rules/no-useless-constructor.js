/**
 * @fileoverview Rule to flag the use of redundant constructors in classes.
 * @author Alberto Rodríguez
 */

// @ts-check

"use strict";

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

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether any of a method's parameters have a decorator or are a parameter property.
 * @param {ASTNode} node A method definition node.
 * @returns {boolean} `true` if any parameter had a decorator or is a parameter property.
 */
function hasDecoratorsOrParameterProperty(node) {
	/** @type {Array<ASTNode>} */
	const params = node.value.params;

	return params.some(
		param =>
			param.decorators?.length || param.type === "TSParameterProperty",
	);
}

/**
 * Checks whether a node's accessibility makes it not useless.
 * @param {ASTNode} node A method definition node.
 * @returns {boolean} `true` if the node has a useful accessibility.
 */
function hasUsefulAccessibility(node) {
	switch (node.accessibility) {
		case "protected":
		case "private":
			return true;
		case "public":
			return !!node.parent.parent.superClass;
		default:
			return false;
	}
}

/**
 * Checks whether a given array of statements is a single call of `super`.
 * @param {Array<ASTNode>} body An array of statements to check.
 * @returns {boolean} `true` if the body is a single call of `super`.
 */
function isSingleSuperCall(body) {
	return (
		body.length === 1 &&
		body[0].type === "ExpressionStatement" &&
		body[0].expression.type === "CallExpression" &&
		body[0].expression.callee.type === "Super"
	);
}

/**
 * Checks whether a given node is a pattern which doesn't have any side effects.
 * Default parameters and Destructuring parameters can have side effects.
 * @param {ASTNode} node A pattern node.
 * @returns {boolean} `true` if the node doesn't have any side effects.
 */
function isSimple(node) {
	return node.type === "Identifier" || node.type === "RestElement";
}

/**
 * Checks whether a given array of expressions is `...arguments` or not.
 * `super(...arguments)` passes all arguments through.
 * @param {Array<ASTNode>} superArgs An array of expressions to check.
 * @returns {boolean} `true` if the superArgs is `...arguments`.
 */
function isSpreadArguments(superArgs) {
	return (
		superArgs.length === 1 &&
		superArgs[0].type === "SpreadElement" &&
		superArgs[0].argument.type === "Identifier" &&
		superArgs[0].argument.name === "arguments"
	);
}

/**
 * Checks whether given 2 nodes are identifiers which have the same name or not.
 * @param {ASTNode} ctorParam A node to check.
 * @param {ASTNode} superArg A node to check.
 * @returns {boolean} `true` if the nodes are identifiers which have the same
 *      name.
 */
function isValidIdentifierPair(ctorParam, superArg) {
	return (
		ctorParam.type === "Identifier" &&
		superArg.type === "Identifier" &&
		ctorParam.name === superArg.name
	);
}

/**
 * Checks whether given 2 nodes are a rest/spread pair which has the same values.
 * @param {ASTNode} ctorParam A node to check.
 * @param {ASTNode} superArg A node to check.
 * @returns {boolean} `true` if the nodes are a rest/spread pair which has the
 *      same values.
 */
function isValidRestSpreadPair(ctorParam, superArg) {
	return (
		ctorParam.type === "RestElement" &&
		superArg.type === "SpreadElement" &&
		isValidIdentifierPair(ctorParam.argument, superArg.argument)
	);
}

/**
 * Checks whether given 2 nodes have the same value or not.
 * @param {ASTNode} ctorParam A node to check.
 * @param {ASTNode} superArg A node to check.
 * @returns {boolean} `true` if the nodes have the same value or not.
 */
function isValidPair(ctorParam, superArg) {
	return (
		isValidIdentifierPair(ctorParam, superArg) ||
		isValidRestSpreadPair(ctorParam, superArg)
	);
}

/**
 * Checks whether the parameters of a constructor and the arguments of `super()`
 * have the same values or not.
 * @param {Array<ASTNode>} ctorParams The parameters of a constructor to check.
 * @param {Array<ASTNode>} superArgs The arguments of `super()` to check.
 * @returns {boolean} `true` if those have the same values.
 */
function isPassingThrough(ctorParams, superArgs) {
	if (ctorParams.length !== superArgs.length) {
		return false;
	}

	for (let i = 0; i < ctorParams.length; ++i) {
		if (!isValidPair(ctorParams[i], superArgs[i])) {
			return false;
		}
	}

	return true;
}

/**
 * Checks whether the constructor body is a redundant super call.
 * @param {Array<ASTNode>} body constructor body content.
 * @param {Array<ASTNode>} ctorParams The params to check against super call.
 * @returns {boolean} true if the constructor body is redundant
 */
function isRedundantSuperCall(body, ctorParams) {
	return (
		isSingleSuperCall(body) &&
		ctorParams.every(isSimple) &&
		(isSpreadArguments(body[0].expression.arguments) ||
			isPassingThrough(ctorParams, body[0].expression.arguments))
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow unnecessary constructors",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-useless-constructor",
		},

		hasSuggestions: true,

		schema: [],

		messages: {
			noUselessConstructor: "Useless constructor.",
			removeConstructor: "Remove the constructor.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const { sourceCode } = context;

		/**
		 * Checks whether a node is a redundant constructor
		 * @param {ASTNode} node node to check
		 * @returns {void}
		 */
		function checkForConstructor(node) {
			if (
				node.kind !== "constructor" ||
				node.value.type !== "FunctionExpression" ||
				hasDecoratorsOrParameterProperty(node) ||
				hasUsefulAccessibility(node)
			) {
				return;
			}

			/*
			 * Prevent crashing on parsers which do not require class constructor
			 * to have a body, e.g. typescript and flow
			 */
			if (!node.value.body) {
				return;
			}

			const body = node.value.body.body;
			const ctorParams = node.value.params;
			const superClass = node.parent.parent.superClass;
			/*
			 * A constructor always has a parameter list, so the `(` token is
			 * always found, and its preceding token is always the `constructor`
			 * key, so neither lookup can return `null` here.
			 */
			const parenToken = /** @type {Token} */ (
				sourceCode.getFirstToken(node, astUtils.isOpeningParenToken)
			);
			const keyToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(parenToken)
			);
			const loc = {
				start: node.loc.start,
				end: keyToken.loc.end,
			};

			if (
				superClass
					? isRedundantSuperCall(body, ctorParams)
					: body.length === 0
			) {
				context.report({
					loc,
					messageId: "noUselessConstructor",
					suggest: [
						{
							messageId: "removeConstructor",
							/**
							 * Removes the useless constructor.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {Generator<EditInfo>} The fixes to apply.
							 */
							*fix(fixer) {
								// A class body always ends with `}`, so there is always a token after the constructor.
								const nextToken = /** @type {Token} */ (
									sourceCode.getTokenAfter(node)
								);
								const addSemiColon =
									astUtils.canContinueExpressionInClassBody(
										nextToken,
									) &&
									astUtils.needsPrecedingSemicolon(
										sourceCode,
										node,
									);

								yield fixer.replaceText(
									node,
									addSemiColon ? ";" : "",
								);
							},
						},
					],
				});
			}
		}

		return {
			MethodDefinition: checkForConstructor,
		};
	},
};

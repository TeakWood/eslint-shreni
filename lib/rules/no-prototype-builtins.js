/**
 * @fileoverview Rule to disallow use of Object.prototype builtins on objects
 * @author Andrew Levine
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

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Returns true if the node or any of the objects
 * to the left of it in the member/call chain is optional.
 *
 * e.g. `a?.b`, `a?.b.c`, `a?.()`, `a()?.()`
 * @param {ASTNode} node The expression to check
 * @returns {boolean} `true` if there is a short-circuiting optional `?.`
 * in the same option chain to the left of this call or member expression,
 * or the node itself is an optional call or member `?.`.
 */
function isAfterOptional(node) {
	let leftNode;

	if (node.type === "MemberExpression") {
		leftNode = node.object;
	} else if (node.type === "CallExpression") {
		leftNode = node.callee;
	} else {
		return false;
	}
	if (node.optional) {
		return true;
	}
	return isAfterOptional(leftNode);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow calling some `Object.prototype` methods directly on objects",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-prototype-builtins",
		},

		hasSuggestions: true,

		schema: [],

		messages: {
			prototypeBuildIn:
				"Do not access Object.prototype method '{{prop}}' from target object.",
			callObjectPrototype: "Call Object.prototype.{{prop}} explicitly.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const DISALLOWED_PROPS = new Set([
			"hasOwnProperty",
			"isPrototypeOf",
			"propertyIsEnumerable",
		]);

		/**
		 * Reports if a disallowed property is used in a CallExpression
		 * @param {ASTNode} node The CallExpression node.
		 * @returns {void}
		 */
		function disallowBuiltIns(node) {
			const callee = astUtils.skipChainExpression(node.callee);

			if (callee.type !== "MemberExpression") {
				return;
			}

			const propName = astUtils.getStaticPropertyName(callee);

			if (propName !== null && DISALLOWED_PROPS.has(propName)) {
				context.report({
					messageId: "prototypeBuildIn",
					loc: callee.property.loc,
					data: { prop: propName },
					node,
					suggest: [
						{
							messageId: "callObjectPrototype",
							data: { prop: propName },
							/**
							 * Rewrites the call as an explicit `Object.prototype` call.
							 * @param {RuleFixer} fixer The fixer to build edits with.
							 * @returns {Array<EditInfo> | null} The edits, or `null` when the call cannot be fixed safely.
							 */
							fix(fixer) {
								const sourceCode = context.sourceCode;

								/*
								 * A call after an optional chain (e.g. a?.b.hasOwnProperty(c))
								 * must be fixed manually because the call can be short-circuited
								 */
								if (isAfterOptional(node)) {
									return null;
								}

								/*
								 * A call on a ChainExpression (e.g. (a?.hasOwnProperty)(c)) will trigger
								 * no-unsafe-optional-chaining which should be fixed before this suggestion
								 */
								if (node.callee.type === "ChainExpression") {
									return null;
								}

								const objectVariable =
									astUtils.getVariableByName(
										sourceCode.getScope(node),
										"Object",
									);

								/*
								 * We can't use Object if the global Object was shadowed,
								 * or Object does not exist in the global scope for some reason
								 */
								if (
									!objectVariable ||
									objectVariable.scope.type !== "global" ||
									objectVariable.defs.length > 0
								) {
									return null;
								}

								let objectText = sourceCode.getText(
									callee.object,
								);

								/*
								 * `getPrecedence()` reads nothing but `node.type`,
								 * so a bare type tag stands in for a real node.
								 */
								const sequenceExpression =
									/** @type {ASTNode} */ ({
										type: "SequenceExpression",
									});

								if (
									astUtils.getPrecedence(callee.object) <=
									astUtils.getPrecedence(sequenceExpression)
								) {
									objectText = `(${objectText})`;
								}

								/*
								 * A `CallExpression` always has a `(` somewhere
								 * after its callee, so this lookup never comes
								 * back `null`, and a filtered token lookup never
								 * returns a comment.
								 */
								const openParenToken = /** @type {Token} */ (
									sourceCode.getTokenAfter(
										node.callee,
										astUtils.isOpeningParenToken,
									)
								);
								const isEmptyParameters =
									node.arguments.length === 0;
								const delim = isEmptyParameters ? "" : ", ";
								const fixes = [
									fixer.replaceText(
										callee,
										`Object.prototype.${propName}.call`,
									),
									fixer.insertTextAfter(
										openParenToken,
										objectText + delim,
									),
								];

								return fixes;
							},
						},
					],
				});
			}
		}

		return {
			CallExpression: disallowBuiltIns,
		};
	},
};

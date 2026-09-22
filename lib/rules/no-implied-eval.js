/**
 * @fileoverview Rule to flag use of implied eval via setTimeout and setInterval
 * @author James Allardice
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");
const { getStaticValue } = require("@eslint-community/eslint-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Variable} Variable */
/** @typedef {import("estree").Node} ESTreeNode */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types `Reference#identifier` as a bare ESTree `Identifier`: no
 * `parent`, and `range` and `loc` optional. The linter populates all three
 * before any rule runs, so this is the same object a visitor would have
 * received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow the use of `eval()`-like methods",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-implied-eval",
		},

		schema: [],

		messages: {
			impliedEval:
				"Implied eval. Consider passing a function instead of a string.",
			execScript: "Implied eval. Do not use execScript().",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const GLOBAL_CANDIDATES = Object.freeze([
			"global",
			"window",
			"globalThis",
			"self",
		]);
		const EVAL_LIKE_FUNC_PATTERN =
			/^(?:set(?:Interval|Timeout)|execScript)$/u;
		const sourceCode = context.sourceCode;

		/**
		 * Checks whether a node is evaluated as a string or not.
		 * @param {ASTNode} node A node to check.
		 * @returns {boolean} True if the node is evaluated as a string.
		 */
		function isEvaluatedString(node) {
			if (
				(node.type === "Literal" && typeof node.value === "string") ||
				node.type === "TemplateLiteral"
			) {
				return true;
			}
			if (node.type === "BinaryExpression" && node.operator === "+") {
				return (
					isEvaluatedString(node.left) ||
					isEvaluatedString(node.right)
				);
			}
			return false;
		}

		/**
		 * Reports if the `CallExpression` node has evaluated argument.
		 * @param {ASTNode} node A CallExpression to check.
		 * @returns {void}
		 */
		function reportImpliedEvalCallExpression(node) {
			// `node` is a `CallExpression`, so `arguments` is its argument list.
			const [firstArgument] = /** @type {Array<ASTNode>} */ (
				node.arguments
			);

			if (firstArgument) {
				// `getStaticValue()` types its node parameter as the bare ESTree union.
				const argumentNode = /** @type {ESTreeNode} */ (firstArgument);
				const staticValue = getStaticValue(
					argumentNode,
					sourceCode.getScope(node),
				);
				const isStaticString =
					staticValue && typeof staticValue.value === "string";
				const isString =
					isStaticString || isEvaluatedString(firstArgument);

				if (isString) {
					const calleeName =
						node.callee.type === "Identifier"
							? node.callee.name
							: astUtils.getStaticPropertyName(node.callee);
					const isExecScript = calleeName === "execScript";
					context.report({
						node,
						messageId: isExecScript ? "execScript" : "impliedEval",
					});
				}
			}
		}

		/**
		 * Reports calls of `implied eval` via the global references.
		 * @param {Variable} globalVar A global variable to check.
		 * @returns {void}
		 */
		function reportImpliedEvalViaGlobal(globalVar) {
			const { references, name } = globalVar;

			references.forEach(ref => {
				const identifier = asNode(ref.identifier);
				let node = identifier.parent;

				while (astUtils.isSpecificMemberAccess(node, null, name)) {
					node = node.parent;
				}

				if (
					astUtils.isSpecificMemberAccess(
						node,
						null,
						EVAL_LIKE_FUNC_PATTERN,
					)
				) {
					const calleeNode =
						node.parent.type === "ChainExpression"
							? node.parent
							: node;
					const parent = calleeNode.parent;

					if (
						parent.type === "CallExpression" &&
						parent.callee === calleeNode
					) {
						reportImpliedEvalCallExpression(parent);
					}
				}
			});
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			CallExpression(node) {
				if (
					astUtils.isSpecificId(
						node.callee,
						EVAL_LIKE_FUNC_PATTERN,
					) &&
					sourceCode.isGlobalReference(node.callee)
				) {
					reportImpliedEvalCallExpression(node);
				}
			},
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);

				GLOBAL_CANDIDATES.map(candidate =>
					astUtils.getVariableByName(globalScope, candidate),
				)
					.filter(
						/**
						 * Keeps only the candidates that resolved to a variable nothing in the program declares.
						 * @param {Variable | null} globalVar The variable the candidate name resolved to, if any.
						 * @returns {globalVar is Variable} `true` if the variable exists and is undeclared.
						 */
						globalVar => !!globalVar && globalVar.defs.length === 0,
					)
					.forEach(reportImpliedEvalViaGlobal);
			},
		};
	},
};

/**
 * @fileoverview restrict values that can be used as Promise rejection reasons
 * @author Teddy Katz
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Variable} Variable */
/** @typedef {import("eslint-scope").Reference} Reference */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets an `eslint-scope` identifier as a rules-layer node.
 *
 * `Reference#identifier` is typed as a bare ESTree identifier: no `parent`,
 * and `range` and `loc` optional. The linter populates all three before any
 * rule runs, so the identifier is the same object a visitor would have
 * received and is reinterpreted rather than re-checked.
 * @param {Reference["identifier"]} identifier The identifier to reinterpret.
 * @returns {ASTNode} The same identifier, as the rules layer sees it.
 */
function asNode(identifier) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (identifier));
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				allowEmptyReject: false,
			},
		],

		docs: {
			description:
				"Require using Error objects as Promise rejection reasons",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/prefer-promise-reject-errors",
		},

		fixable: null,

		schema: [
			{
				type: "object",
				properties: {
					allowEmptyReject: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],

		messages: {
			rejectAnError:
				"Expected the Promise rejection reason to be an Error.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ allowEmptyReject }] = context.options;
		const sourceCode = context.sourceCode;

		//----------------------------------------------------------------------
		// Helpers
		//----------------------------------------------------------------------

		/**
		 * Checks the argument of a reject() or Promise.reject() CallExpression, and reports it if it can't be an Error
		 * @param {ASTNode} callExpression A CallExpression node which is used to reject a Promise
		 * @returns {void}
		 */
		function checkRejectCall(callExpression) {
			if (!callExpression.arguments.length && allowEmptyReject) {
				return;
			}

			const rejectionReason = callExpression.arguments[0];

			if (
				!callExpression.arguments.length ||
				!astUtils.couldBeError(rejectionReason) ||
				(rejectionReason.type === "Identifier" &&
					rejectionReason.name === "undefined" &&
					sourceCode.isGlobalReference(rejectionReason))
			) {
				context.report({
					node: callExpression,
					messageId: "rejectAnError",
				});
			}
		}

		/**
		 * Determines whether a function call is a Promise.reject() call
		 * @param {ASTNode} node A CallExpression node
		 * @returns {boolean} `true` if the call is a Promise.reject() call
		 */
		function isPromiseRejectCall(node) {
			return (
				astUtils.isSpecificMemberAccess(
					node.callee,
					"Promise",
					"reject",
				) &&
				sourceCode.isGlobalReference(
					astUtils.skipChainExpression(node.callee).object,
				)
			);
		}

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------

		return {
			/**
			 * Check `Promise.reject(value)` calls.
			 * @param {ASTNode} node The `CallExpression` node to check.
			 * @returns {void}
			 */
			CallExpression(node) {
				if (isPromiseRejectCall(node)) {
					checkRejectCall(node);
				}
			},

			/**
			 * Check for `new Promise((resolve, reject) => {})`, and check for reject() calls.
			 *
			 * This function is run on "NewExpression:exit" instead of "NewExpression" to ensure that
			 * the nodes in the expression already have the `parent` property.
			 * @param {ASTNode} node The `NewExpression` node to check.
			 * @returns {void}
			 */
			"NewExpression:exit"(node) {
				if (
					node.callee.type === "Identifier" &&
					node.callee.name === "Promise" &&
					sourceCode.isGlobalReference(node.callee) &&
					node.arguments.length &&
					astUtils.isFunction(node.arguments[0]) &&
					node.arguments[0].params.length > 1 &&
					node.arguments[0].params[1].type === "Identifier"
				) {
					/*
					 * Find the first variable that matches the second parameter's name.
					 * If the first parameter has the same name as the second parameter, then the variable will actually
					 * be "declared" when the first parameter is evaluated, but then it will be immediately overwritten
					 * by the second parameter. It's not possible for an expression with the variable to be evaluated before
					 * the variable is overwritten, because functions with duplicate parameters cannot have destructuring or
					 * default assignments in their parameter lists. Therefore, it's not necessary to explicitly account for
					 * this case.
					 *
					 * The second parameter is an `Identifier` (checked above) of a
					 * function whose scope was just built, so a variable with that
					 * name is always among the declared variables and the lookup
					 * never comes back empty.
					 */
					const rejectVariable = /** @type {Variable} */ (
						sourceCode
							.getDeclaredVariables(node.arguments[0])
							.find(
								variable =>
									variable.name ===
									node.arguments[0].params[1].name,
							)
					);

					// Get the references to that variable.
					rejectVariable.references
						// Only check the references that read the parameter's value.
						.filter(ref => ref.isRead())

						// Only check the references that are used as the callee in a function call, e.g. `reject(foo)`.
						.filter(ref => {
							const identifier = asNode(ref.identifier);

							return (
								identifier.parent.type === "CallExpression" &&
								identifier === identifier.parent.callee
							);
						})

						// Check the argument of the function call to determine whether it's an Error.
						.forEach(ref =>
							checkRejectCall(asNode(ref.identifier).parent),
						);
				}
			},
		};
	},
};

/**
 * @fileoverview Disallow shadowing of globalThis, NaN, undefined, and Infinity (ES2020 section 18.1)
 * @author Michael Ficarra
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Variable} Variable */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Determines if a variable safely shadows undefined.
 * This is the case when a variable named `undefined` is never assigned to a value (i.e. it always shares the same value
 * as the global).
 * @param {Variable} variable The variable to check
 * @returns {boolean} true if this variable safely shadows `undefined`
 */
function safelyShadowsUndefined(variable) {
	return (
		variable.name === "undefined" &&
		variable.references.every(ref => !ref.isWrite()) &&
		variable.defs.every(
			def =>
				def.node.type === "VariableDeclarator" &&
				def.node.init === null,
		)
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				reportGlobalThis: true,
			},
		],

		docs: {
			description: "Disallow identifiers from shadowing restricted names",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-shadow-restricted-names",
		},

		schema: [
			{
				type: "object",
				properties: {
					reportGlobalThis: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			shadowingRestrictedName: "Shadowing of global property '{{name}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ reportGlobalThis }] = context.options;

		const RESTRICTED = new Set([
			"undefined",
			"NaN",
			"Infinity",
			"arguments",
			"eval",
		]);

		if (reportGlobalThis) {
			RESTRICTED.add("globalThis");
		}

		const sourceCode = context.sourceCode;

		// Track reported nodes to avoid duplicate reports. For example, on class declarations.
		const reportedNodes = new Set();

		return {
			/**
			 * Reports every declared variable whose name is a restricted global.
			 * @param {ASTNode} node The node that declares the variables.
			 * @returns {void}
			 */
			"VariableDeclaration, :function, CatchClause, ImportDeclaration, ClassDeclaration, ClassExpression"(
				node,
			) {
				for (const variable of sourceCode.getDeclaredVariables(node)) {
					if (
						variable.defs.length > 0 &&
						RESTRICTED.has(variable.name) &&
						!safelyShadowsUndefined(variable)
					) {
						for (const def of variable.defs) {
							/*
							 * `eslint-scope` types `Definition#name` as a bare
							 * ESTree `Identifier`: no `parent`, and `range`
							 * and `loc` optional. The linter populates all
							 * three before any rule runs, so this is the same
							 * object a visitor would have received and is
							 * reinterpreted rather than re-checked.
							 */
							const nodeToReport = /** @type {ASTNode} */ (
								/** @type {unknown} */ (def.name)
							);

							if (!reportedNodes.has(nodeToReport)) {
								reportedNodes.add(nodeToReport);
								context.report({
									node: nodeToReport,
									messageId: "shadowingRestrictedName",
									data: {
										name: variable.name,
									},
								});
							}
						}
					}
				}
			},
		};
	},
};

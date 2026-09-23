/**
 * @fileoverview Rule to flag use of alert, confirm, prompt
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const {
	getStaticPropertyName: getPropertyName,
	getVariableByName,
	skipChainExpression,
} = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Reference} Reference */
/** @typedef {import("eslint-scope").Scope} Scope */

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
 * @param {Object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

/**
 * Checks if the given name is a prohibited identifier.
 * @param {string | null} name The name to check.
 * @returns {boolean} Whether or not the name is prohibited.
 */
function isProhibitedIdentifier(name) {
	return /^(?:alert|confirm|prompt)$/u.test(/** @type {string} */ (name));
}

/**
 * Finds the eslint-scope reference in the given scope.
 * @param {Scope} scope The scope to search.
 * @param {ASTNode} node The identifier node.
 * @returns {Reference | null} Returns the found reference or null if none were found.
 */
function findReference(scope, node) {
	const references = scope.references.filter(
		reference =>
			asNode(reference.identifier).range[0] === node.range[0] &&
			asNode(reference.identifier).range[1] === node.range[1],
	);

	if (references.length === 1) {
		return references[0];
	}
	return null;
}

/**
 * Checks if the given identifier node is shadowed in the given scope.
 *
 * Returns `null` rather than `false` when the identifier has no reference at
 * all in the scope; every caller reads the result in a boolean position.
 * @param {Scope} scope The current scope.
 * @param {ASTNode} node The identifier node to check.
 * @returns {boolean | null} Whether or not the name is shadowed.
 */
function isShadowed(scope, node) {
	const reference = findReference(scope, node);

	return (
		reference && reference.resolved && reference.resolved.defs.length > 0
	);
}

/**
 * Checks if the given identifier node is a ThisExpression in the global scope or the global window property.
 * @param {Scope} scope The current scope.
 * @param {ASTNode} node The identifier node to check.
 * @returns {boolean} Whether or not the node is a reference to the global object.
 */
function isGlobalThisReferenceOrGlobalWindow(scope, node) {
	if (scope.type === "global" && node.type === "ThisExpression") {
		return true;
	}
	if (
		node.type === "Identifier" &&
		(node.name === "window" ||
			(node.name === "globalThis" &&
				getVariableByName(scope, "globalThis")))
	) {
		return !isShadowed(scope, node);
	}

	return false;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow the use of `alert`, `confirm`, and `prompt`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-alert",
		},

		schema: [],

		messages: {
			unexpected: "Unexpected {{name}}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports calls to `alert`, `confirm`, and `prompt`.
			 * @param {ASTNode} node The `CallExpression` node to check.
			 * @returns {void} No return value.
			 */
			CallExpression(node) {
				const callee = skipChainExpression(node.callee),
					currentScope = sourceCode.getScope(node);

				// without window.
				if (callee.type === "Identifier") {
					const name = callee.name;

					if (
						!isShadowed(currentScope, callee) &&
						isProhibitedIdentifier(callee.name)
					) {
						context.report({
							node,
							messageId: "unexpected",
							data: { name },
						});
					}
				} else if (
					callee.type === "MemberExpression" &&
					isGlobalThisReferenceOrGlobalWindow(
						currentScope,
						callee.object,
					)
				) {
					const name = getPropertyName(callee);

					if (isProhibitedIdentifier(name)) {
						context.report({
							node,
							messageId: "unexpected",
							data: { name },
						});
					}
				}
			},
		};
	},
};

/**
 * @fileoverview Rule for disallowing require() outside of the top-level module context
 * @author Jamund Ferguson
 * @deprecated in ESLint v7.0.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Reference} Reference */
/** @typedef {import("eslint-scope").Scope} Scope */

const ACCEPTABLE_PARENTS = new Set([
	"AssignmentExpression",
	"VariableDeclarator",
	"MemberExpression",
	"ExpressionStatement",
	"CallExpression",
	"ConditionalExpression",
	"Program",
	"VariableDeclaration",
	"ChainExpression",
]);

/**
 * Reinterprets an `eslint-scope` identifier as a rules-layer node.
 *
 * `Reference#identifier` is typed as a bare ESTree identifier: no `parent`, and
 * `range` and `loc` optional. The linter populates all three before any rule
 * runs, so the identifier is the same object a visitor would have received and
 * is reinterpreted rather than re-checked.
 * @param {Reference["identifier"]} identifier The identifier to reinterpret.
 * @returns {ASTNode} The same identifier, as the rules layer sees it.
 * @private
 */
function asNode(identifier) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (identifier));
}

/**
 * Finds the eslint-scope reference in the given scope.
 * @param {Scope} scope The scope to search.
 * @param {ASTNode} node The identifier node.
 * @returns {Reference|null} Returns the found reference or null if none were found.
 */
function findReference(scope, node) {
	const references = scope.references.filter(reference => {
		const identifier = asNode(reference.identifier);

		return (
			identifier.range[0] === node.range[0] &&
			identifier.range[1] === node.range[1]
		);
	});

	if (references.length === 1) {
		return references[0];
	}

	/* c8 ignore next */
	return null;
}

/**
 * Checks if the given identifier node is shadowed in the given scope.
 * @param {Scope} scope The current scope.
 * @param {ASTNode} node The identifier node to check.
 * @returns {boolean} Whether or not the name is shadowed.
 */
function isShadowed(scope, node) {
	const reference = findReference(scope, node);

	// The `&&` chain is only ever consumed for its truthiness.
	return /** @type {boolean} */ (
		reference && reference.resolved && reference.resolved.defs.length > 0
	);
}

module.exports = {
	meta: {
		deprecated: {
			message: "Node.js rules were moved out of ESLint core.",
			url: "https://eslint.org/docs/latest/use/migrating-to-7.0.0#deprecate-node-rules",
			deprecatedSince: "7.0.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"eslint-plugin-n now maintains deprecated Node.js-related rules.",
					plugin: {
						name: "eslint-plugin-n",
						url: "https://github.com/eslint-community/eslint-plugin-n",
					},
					rule: {
						name: "global-require",
						url: "https://github.com/eslint-community/eslint-plugin-n/tree/master/docs/rules/global-require.md",
					},
				},
			],
		},

		type: "suggestion",

		docs: {
			description:
				"Require `require()` calls to be placed at top-level module scope",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/global-require",
		},

		schema: [],
		messages: {
			unexpected: "Unexpected require().",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports a `require()` call that is not at top-level module scope.
			 * @param {ASTNode} node The call expression to check.
			 * @returns {void}
			 */
			CallExpression(node) {
				const currentScope = sourceCode.getScope(node);

				if (
					node.callee.name === "require" &&
					!isShadowed(currentScope, node.callee)
				) {
					const isGoodRequire = sourceCode
						.getAncestors(node)
						.every(parent => ACCEPTABLE_PARENTS.has(parent.type));

					if (!isGoodRequire) {
						context.report({ node, messageId: "unexpected" });
					}
				}
			},
		};
	},
};

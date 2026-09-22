/**
 * @fileoverview Rule to
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Scope} Scope */
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

/**
 * Gets the variable object of `arguments` which is defined implicitly.
 * @param {Scope} scope A scope to get.
 * @returns {Variable | null} The found variable object.
 */
function getVariableOfArguments(scope) {
	const variables = scope.variables;

	for (let i = 0; i < variables.length; ++i) {
		const variable = variables[i];

		if (variable.name === "arguments") {
			/*
			 * If there was a parameter which is named "arguments", the implicit "arguments" is not defined.
			 * So does fast return with null.
			 */
			return variable.identifiers.length === 0 ? variable : null;
		}
	}

	/* c8 ignore next */
	return null;
}

/**
 * Checks if the given reference is not normal member access.
 *
 * - arguments         .... true    // not member access
 * - arguments[i]      .... true    // computed member access
 * - arguments[0]      .... true    // computed member access
 * - arguments.length  .... false   // normal member access
 * @param {Reference} reference The reference to check.
 * @returns {boolean} `true` if the reference is not normal member access.
 */
function isNotNormalMemberAccess(reference) {
	const id = asNode(reference.identifier);
	const parent = id.parent;

	return !(
		parent.type === "MemberExpression" &&
		parent.object === id &&
		!parent.computed
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Require rest parameters instead of `arguments`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/prefer-rest-params",
		},

		schema: [],

		messages: {
			preferRestParams: "Use the rest parameters instead of 'arguments'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Reports a given reference.
		 * @param {Reference} reference A reference to report.
		 * @returns {void}
		 */
		function report(reference) {
			const id = asNode(reference.identifier);

			context.report({
				node: id,
				loc: id.loc,
				messageId: "preferRestParams",
			});
		}

		/**
		 * Reports references of the implicit `arguments` variable if exist.
		 * @param {ASTNode} node The node representing the function.
		 * @returns {void}
		 */
		function checkForArguments(node) {
			const argumentsVar = getVariableOfArguments(
				sourceCode.getScope(node),
			);

			if (argumentsVar) {
				argumentsVar.references
					.filter(isNotNormalMemberAccess)
					.forEach(report);
			}
		}

		return {
			"FunctionDeclaration:exit": checkForArguments,
			"FunctionExpression:exit": checkForArguments,
		};
	},
};

/**
 * @fileoverview Rule to disallow assignments to native objects or read-only global variables
 * @author Ilya Volodin
 * @deprecated in ESLint v3.3.0
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

/**
 * A variable in the global scope. The linter tags every global it seeds the
 * global scope with as writeable or not, from the `globals` config and the
 * environment's builtin list; `eslint-scope` itself never sets the property,
 * so it is absent on variables that were not seeded that way.
 * @typedef {import("eslint-scope").Variable & { writeable?: boolean }} Variable
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — `Reference#identifier` here — as
 * bare ESTree nodes: no `parent`, and `range` and `loc` optional. The linter
 * populates all three before any rule runs, so this is the same object a
 * visitor would have received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
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
			description:
				"Disallow assignments to native objects or read-only global variables",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-native-reassign",
		},

		deprecated: {
			message: "Renamed rule.",
			url: "https://eslint.org/blog/2016/08/eslint-v3.3.0-released/#deprecated-rules",
			deprecatedSince: "3.3.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					rule: {
						name: "no-global-assign",
						url: "https://eslint.org/docs/rules/no-global-assign",
					},
				},
			],
		},

		schema: [
			{
				type: "object",
				properties: {
					exceptions: {
						type: "array",
						items: { type: "string" },
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			nativeReassign:
				"Read-only global '{{name}}' should not be modified.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const config = context.options[0];
		const exceptions = (config && config.exceptions) || [];
		const sourceCode = context.sourceCode;

		/**
		 * Reports write references.
		 * @param {Reference} reference A reference to check.
		 * @param {number} index The index of the reference in the references.
		 * @param {Array<Reference>} references The array that the reference belongs to.
		 * @returns {void}
		 */
		function checkReference(reference, index, references) {
			const identifier = reference.identifier;

			if (
				reference.init === false &&
				reference.isWrite() &&
				/*
				 * Destructuring assignments can have multiple default value,
				 * so possibly there are multiple writeable references for the same identifier.
				 */
				(index === 0 || references[index - 1].identifier !== identifier)
			) {
				context.report({
					node: identifier,
					messageId: "nativeReassign",

					// The message reads `{{name}}` off the identifier itself.
					data: asNode(identifier),
				});
			}
		}

		/**
		 * Reports write references if a given variable is read-only builtin.
		 * @param {Variable} variable A variable to check.
		 * @returns {void}
		 */
		function checkVariable(variable) {
			if (
				variable.writeable === false &&
				!exceptions.includes(variable.name)
			) {
				variable.references.forEach(checkReference);
			}
		}

		return {
			/**
			 * Checks every global for read-only reassignment.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			Program(node) {
				const globalScope = sourceCode.getScope(node);

				globalScope.variables.forEach(checkVariable);
			},
		};
	},
};

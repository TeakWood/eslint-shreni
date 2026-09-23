/**
 * @fileoverview Rule to enforce consistent naming of "this" context variables
 * @author Raphael Pigulla
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

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Converts an `eslint-scope` node to the rules-layer `ASTNode` shape. The two
 * describe the same objects; `eslint-scope` simply declares a narrower view of
 * them that omits `parent` and makes `range`/`loc` optional.
 * @param {Object} node The node to convert.
 * @returns {ASTNode} The same node, typed as an `ASTNode`.
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
				"Enforce consistent naming when capturing the current execution context",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/consistent-this",
		},

		schema: {
			type: "array",
			items: {
				type: "string",
				minLength: 1,
			},
			uniqueItems: true,
		},

		defaultOptions: ["that"],

		messages: {
			aliasNotAssignedToThis:
				"Designated alias '{{name}}' is not assigned to 'this'.",
			unexpectedAlias: "Unexpected alias '{{name}}' for 'this'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const aliases = /** @type {Array<string>} */ (context.options);
		const sourceCode = context.sourceCode;

		/**
		 * Reports that a variable declarator or assignment expression is assigning
		 * a non-'this' value to the specified alias.
		 * @param {ASTNode} node The assigning node.
		 * @param {string} name the name of the alias that was incorrectly used.
		 * @returns {void}
		 */
		function reportBadAssignment(node, name) {
			context.report({
				node,
				messageId: "aliasNotAssignedToThis",
				data: { name },
			});
		}

		/**
		 * Checks that an assignment to an identifier only assigns 'this' to the
		 * appropriate alias, and the alias is only assigned to 'this'.
		 * @param {ASTNode} node The assigning node.
		 * @param {string} name The name of the variable assigned to.
		 * @param {ASTNode} value The value of the assignment.
		 * @returns {void}
		 */
		function checkAssignment(node, name, value) {
			const isThis = value.type === "ThisExpression";

			if (aliases.includes(name)) {
				if (!isThis || (node.operator && node.operator !== "=")) {
					reportBadAssignment(node, name);
				}
			} else if (isThis) {
				context.report({
					node,
					messageId: "unexpectedAlias",
					data: { name },
				});
			}
		}

		/**
		 * Ensures that a variable declaration of the alias in a program or function
		 * is assigned to the correct value.
		 * @param {string} alias alias the check the assignment of.
		 * @param {Scope} scope scope of the current code we are checking.
		 * @returns {void}
		 * @private
		 */
		function checkWasAssigned(alias, scope) {
			const variable = scope.set.get(alias);

			if (!variable) {
				return;
			}

			if (
				variable.defs.some(
					def =>
						def.node.type === "VariableDeclarator" &&
						def.node.init !== null,
				)
			) {
				return;
			}

			/*
			 * The alias has been declared and not assigned: check it was
			 * assigned later in the same scope.
			 */
			if (
				!variable.references.some(reference => {
					const write = reference.writeExpr;

					return (
						reference.from === scope &&
						write &&
						write.type === "ThisExpression" &&
						asNode(write).parent.operator === "="
					);
				})
			) {
				variable.defs
					.map(def => def.node)
					.forEach(node => {
						reportBadAssignment(asNode(node), alias);
					});
			}
		}

		/**
		 * Check each alias to ensure that is was assigned to the correct value.
		 * @param {ASTNode} node The node that represents the scope to check.
		 * @returns {void}
		 */
		function ensureWasAssigned(node) {
			const scope = sourceCode.getScope(node);

			// if this is program scope we also need to check module scope
			const extraScope =
				node.type === "Program" && node.sourceType === "module"
					? scope.childScopes[0]
					: null;

			aliases.forEach(alias => {
				checkWasAssigned(alias, scope);

				if (extraScope) {
					checkWasAssigned(alias, extraScope);
				}
			});
		}

		return {
			"Program:exit": ensureWasAssigned,
			"FunctionExpression:exit": ensureWasAssigned,
			"FunctionDeclaration:exit": ensureWasAssigned,

			/**
			 * Checks a variable declarator that initializes an identifier.
			 * @param {ASTNode} node The variable declarator to check.
			 * @returns {void}
			 */
			VariableDeclarator(node) {
				const id = node.id;
				const isDestructuring =
					id.type === "ArrayPattern" || id.type === "ObjectPattern";

				if (node.init !== null && !isDestructuring) {
					checkAssignment(node, id.name, node.init);
				}
			},

			/**
			 * Checks an assignment whose target is a plain identifier.
			 * @param {ASTNode} node The assignment expression to check.
			 * @returns {void}
			 */
			AssignmentExpression(node) {
				if (node.left.type === "Identifier") {
					checkAssignment(node, node.left.name, node.right);
				}
			},
		};
	},
};

/**
 * @fileoverview Rule to flag non-matching identifiers
 * @author Matthieu Larcher
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Scope} Scope */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — here `Reference#identifier` — as a
 * bare ESTree node: no `parent`, and `range` and `loc` optional. The linter
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

		defaultOptions: [
			"^.+$",
			{
				classFields: false,
				ignoreDestructuring: false,
				onlyDeclarations: false,
				properties: false,
			},
		],

		docs: {
			description:
				"Require identifiers to match a specified regular expression",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/id-match",
		},

		schema: [
			{
				type: "string",
			},
			{
				type: "object",
				properties: {
					properties: {
						type: "boolean",
					},
					classFields: {
						type: "boolean",
					},
					onlyDeclarations: {
						type: "boolean",
					},
					ignoreDestructuring: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			notMatch:
				"Identifier '{{name}}' does not match the pattern '{{pattern}}'.",
			notMatchPrivate:
				"Identifier '#{{name}}' does not match the pattern '{{pattern}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		//--------------------------------------------------------------------------
		// Options
		//--------------------------------------------------------------------------
		const [
			pattern,
			{
				classFields: checkClassFields,
				ignoreDestructuring,
				onlyDeclarations,
				properties: checkProperties,
			},
		] = context.options;
		const regexp = new RegExp(pattern, "u");

		const sourceCode = context.sourceCode;

		/** @type {Scope} */
		let globalScope;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		// contains reported nodes to avoid reporting twice on destructuring with shorthand notation
		const reportedNodes = new Set();
		const ALLOWED_PARENT_TYPES = new Set([
			"CallExpression",
			"NewExpression",
		]);
		const DECLARATION_TYPES = new Set([
			"FunctionDeclaration",
			"VariableDeclarator",
		]);
		const IMPORT_TYPES = new Set([
			"ImportSpecifier",
			"ImportNamespaceSpecifier",
			"ImportDefaultSpecifier",
		]);

		/**
		 * Checks whether the given node represents a reference to a global variable that is not declared in the source code.
		 * These identifiers will be allowed, as it is assumed that user has no control over the names of external global variables.
		 * @param {ASTNode} node `Identifier` node to check.
		 * @returns {boolean} `true` if the node is a reference to a global variable.
		 */
		function isReferenceToGlobalVariable(node) {
			const variable = globalScope.set.get(node.name);

			/*
			 * `!!` only normalizes the `undefined` that `Map#get()` returns for
			 * an unknown name into `false`; every caller already used this in a
			 * boolean position, so the observable behavior is unchanged.
			 */
			return (
				!!variable &&
				variable.defs.length === 0 &&
				variable.references.some(ref => asNode(ref.identifier) === node)
			);
		}

		/**
		 * Checks if a string matches the provided pattern
		 * @param {string} name The string to check.
		 * @returns {boolean} if the string is a match
		 * @private
		 */
		function isInvalid(name) {
			return !regexp.test(name);
		}

		/**
		 * Checks if a parent of a node is an ObjectPattern.
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} if the node is inside an ObjectPattern
		 * @private
		 */
		function isInsideObjectPattern(node) {
			let { parent } = node;

			while (parent) {
				if (parent.type === "ObjectPattern") {
					return true;
				}

				parent = parent.parent;
			}

			return false;
		}

		/**
		 * Verifies if we should report an error or not based on the effective
		 * parent node and the identifier name.
		 * @param {ASTNode} effectiveParent The effective parent node of the node to be reported
		 * @param {string} name The identifier name of the identifier node
		 * @returns {boolean} whether an error should be reported or not
		 */
		function shouldReport(effectiveParent, name) {
			return (
				(!onlyDeclarations ||
					DECLARATION_TYPES.has(effectiveParent.type)) &&
				!ALLOWED_PARENT_TYPES.has(effectiveParent.type) &&
				isInvalid(name)
			);
		}

		/**
		 * Reports an AST node as a rule violation.
		 * @param {ASTNode} node The node to report.
		 * @returns {void} No return value.
		 * @private
		 */
		function report(node) {
			/*
			 * We used the range instead of the node because it's possible
			 * for the same identifier to be represented by two different
			 * nodes, with the most clear example being shorthand properties:
			 * { foo }
			 * In this case, "foo" is represented by one node for the name
			 * and one for the value. The only way to know they are the same
			 * is to look at the range.
			 */
			if (!reportedNodes.has(node.range.toString())) {
				const messageId =
					node.type === "PrivateIdentifier"
						? "notMatchPrivate"
						: "notMatch";

				context.report({
					node,
					messageId,
					data: {
						name: node.name,
						pattern,
					},
				});
				reportedNodes.add(node.range.toString());
			}
		}

		return {
			/**
			 * Records the global scope.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void} No return value.
			 */
			Program(node) {
				globalScope = sourceCode.getScope(node);
			},

			/**
			 * Checks an identifier against the pattern.
			 * @param {ASTNode} node The `Identifier` node.
			 * @returns {void} No return value.
			 */
			Identifier(node) {
				const name = node.name,
					parent = node.parent,
					effectiveParent =
						parent.type === "MemberExpression"
							? parent.parent
							: parent;

				if (
					isReferenceToGlobalVariable(node) ||
					astUtils.isImportAttributeKey(node) ||
					parent.type === "MetaProperty"
				) {
					return;
				}

				if (parent.type === "MemberExpression") {
					if (!checkProperties) {
						return;
					}

					// Always check object names
					if (
						parent.object.type === "Identifier" &&
						parent.object.name === name
					) {
						if (isInvalid(name)) {
							report(node);
						}

						// Report AssignmentExpressions left side's assigned variable id
					} else if (
						effectiveParent.type === "AssignmentExpression" &&
						effectiveParent.left.type === "MemberExpression" &&
						effectiveParent.left.property.name === node.name
					) {
						if (isInvalid(name)) {
							report(node);
						}

						// Report AssignmentExpressions only if they are the left side of the assignment
					} else if (
						effectiveParent.type === "AssignmentExpression" &&
						effectiveParent.right.type !== "MemberExpression"
					) {
						if (isInvalid(name)) {
							report(node);
						}
					}

					// For https://github.com/eslint/eslint/issues/15123
				} else if (
					parent.type === "Property" &&
					parent.parent.type === "ObjectExpression" &&
					parent.key === node &&
					!parent.computed
				) {
					if (checkProperties && isInvalid(name)) {
						report(node);
					}

					/*
					 * Properties have their own rules, and
					 * AssignmentPattern nodes can be treated like Properties:
					 * e.g.: const { no_camelcased = false } = bar;
					 */
				} else if (
					parent.type === "Property" ||
					parent.type === "AssignmentPattern"
				) {
					if (
						parent.parent &&
						parent.parent.type === "ObjectPattern"
					) {
						if (
							!ignoreDestructuring &&
							parent.shorthand &&
							parent.value.left &&
							isInvalid(name)
						) {
							report(node);
						}

						const assignmentKeyEqualsValue =
							parent.key.name === parent.value.name;

						// prevent checking righthand side of destructured object
						if (!assignmentKeyEqualsValue && parent.key === node) {
							return;
						}

						const valueIsInvalid =
							parent.value.name && isInvalid(name);

						// ignore destructuring if the option is set, unless a new identifier is created
						if (
							valueIsInvalid &&
							!(assignmentKeyEqualsValue && ignoreDestructuring)
						) {
							report(node);
						}
					}

					// never check properties or always ignore destructuring
					if (
						(!checkProperties && !parent.computed) ||
						(ignoreDestructuring && isInsideObjectPattern(node))
					) {
						return;
					}

					// don't check right hand side of AssignmentExpression to prevent duplicate warnings
					if (
						parent.right !== node &&
						shouldReport(effectiveParent, name)
					) {
						report(node);
					}

					// Check if it's an import specifier
				} else if (IMPORT_TYPES.has(parent.type)) {
					// Report only if the local imported identifier is invalid
					if (
						parent.local &&
						parent.local.name === node.name &&
						isInvalid(name)
					) {
						report(node);
					}
				} else if (parent.type === "PropertyDefinition") {
					if (checkClassFields && isInvalid(name)) {
						report(node);
					}

					// Report anything that is invalid that isn't a CallExpression
				} else if (shouldReport(effectiveParent, name)) {
					report(node);
				}
			},

			/**
			 * Checks a private identifier against the pattern.
			 * @param {ASTNode} node The `PrivateIdentifier` node.
			 * @returns {void} No return value.
			 */
			PrivateIdentifier(node) {
				const isClassField = node.parent.type === "PropertyDefinition";

				if (isClassField && !checkClassFields) {
					return;
				}

				if (isInvalid(node.name)) {
					report(node);
				}
			},
		};
	},
};

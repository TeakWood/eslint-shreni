/**
 * @fileoverview Rule to check for implicit global variables, functions and classes.
 * @author Joshua Peek
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").GlobalScope} GlobalScope */

/**
 * A global variable as the linter hands it to a rule. The linter adds two
 * members that `eslint-scope` knows nothing about: `writeable`, which only
 * variables created from a `globals` config carry, and `eslintExported`, which
 * marks variables named in an `exported` block comment.
 * @typedef {import("eslint-scope").Variable & { writeable?: boolean, eslintExported?: boolean }} Variable
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const ASSIGNMENT_NODES = new Set([
	"AssignmentExpression",
	"ForInStatement",
	"ForOfStatement",
]);

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — here `Definition#node` and
 * `Reference#identifier` — as a bare ESTree node: no `parent`, and `range` and
 * `loc` optional. The linter populates all three before any rule runs, so this
 * is the same object a visitor would have received and is reinterpreted rather
 * than re-checked.
 * @param {Object} node The `eslint-scope` node.
 * @returns {ASTNode} The same node, typed for the rules layer.
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
			{
				lexicalBindings: false,
			},
		],

		docs: {
			description: "Disallow declarations in the global scope",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-implicit-globals",
		},

		schema: [
			{
				type: "object",
				properties: {
					lexicalBindings: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			globalNonLexicalBinding:
				"Unexpected {{kind}} declaration in the global scope, wrap in an IIFE for a local variable, assign as global property for a global variable.",
			globalLexicalBinding:
				"Unexpected {{kind}} declaration in the global scope, wrap in a block or in an IIFE.",
			globalVariableLeak:
				"Global variable leak, declare the variable if it is intended to be local.",
			assignmentToReadonlyGlobal:
				"Unexpected assignment to read-only global variable.",
			redeclarationOfReadonlyGlobal:
				"Unexpected redeclaration of read-only global variable.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ lexicalBindings: checkLexicalBindings }] = context.options;
		const sourceCode = context.sourceCode;

		/**
		 * Reports the node.
		 * @param {ASTNode} node Node to report.
		 * @param {string} messageId Id of the message to report.
		 * @param {string} [kind] Declaration kind, can be 'var', 'const', 'let', function or class.
		 * @returns {void}
		 */
		function report(node, messageId, kind) {
			context.report({
				node,
				messageId,
				data: {
					kind,
				},
			});
		}

		return {
			/**
			 * Reports every declaration and leak that lands in the global scope.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			Program(node) {
				// The scope of a `Program` node is always the global scope.
				const scope = /** @type {GlobalScope} */ (
					sourceCode.getScope(node)
				);

				// The linter has already decorated these with its own members.
				const variables = /** @type {Array<Variable>} */ (
					scope.variables
				);

				variables.forEach(variable => {
					// Only ESLint global variables have the `writable` key.
					const isReadonlyEslintGlobalVariable =
						variable.writeable === false;
					const isWritableEslintGlobalVariable =
						variable.writeable === true;

					if (isWritableEslintGlobalVariable) {
						// Everything is allowed with writable ESLint global variables.
						return;
					}

					// Variables exported by "exported" block comments
					if (variable.eslintExported) {
						return;
					}

					variable.defs.forEach(def => {
						const defNode = asNode(def.node);

						if (
							def.type === "FunctionName" ||
							(def.type === "Variable" &&
								def.parent.kind === "var")
						) {
							if (isReadonlyEslintGlobalVariable) {
								report(
									defNode,
									"redeclarationOfReadonlyGlobal",
								);
							} else {
								report(
									defNode,
									"globalNonLexicalBinding",
									def.type === "FunctionName"
										? "function"
										: `'${def.parent.kind}'`,
								);
							}
						}

						if (checkLexicalBindings) {
							if (
								def.type === "ClassName" ||
								(def.type === "Variable" &&
									(def.parent.kind === "let" ||
										def.parent.kind === "const"))
							) {
								if (isReadonlyEslintGlobalVariable) {
									report(
										defNode,
										"redeclarationOfReadonlyGlobal",
									);
								} else {
									report(
										defNode,
										"globalLexicalBinding",
										def.type === "ClassName"
											? "class"
											: `'${def.parent.kind}'`,
									);
								}
							}
						}
					});

					if (
						isReadonlyEslintGlobalVariable &&
						variable.defs.length === 0
					) {
						variable.references.forEach(reference => {
							if (reference.isWrite() && !reference.isRead()) {
								const identifier = asNode(reference.identifier);

								// The `Program` node at the top of the walk has no parent.
								/** @type {ASTNode | null} */
								let assignmentParent = identifier.parent;

								while (
									assignmentParent &&
									!ASSIGNMENT_NODES.has(assignmentParent.type)
								) {
									assignmentParent = assignmentParent.parent;
								}

								report(
									assignmentParent ?? identifier,
									"assignmentToReadonlyGlobal",
								);
							}
						});
					}
				});

				// Undeclared assigned variables.
				scope.implicit.variables.forEach(variable => {
					// def.node is an AssignmentExpression, ForInStatement or ForOfStatement.
					variable.defs.forEach(def => {
						report(asNode(def.node), "globalVariableLeak");
					});
				});
			},
		};
	},
};

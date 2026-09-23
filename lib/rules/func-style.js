/**
 * @fileoverview Rule to enforce a particular function style
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			"expression",
			{
				allowArrowFunctions: false,
				allowTypeAnnotation: false,
				overrides: {},
			},
		],

		docs: {
			description:
				"Enforce the consistent use of either `function` declarations or expressions assigned to variables",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/func-style",
		},

		schema: [
			{
				enum: ["declaration", "expression"],
			},
			{
				type: "object",
				properties: {
					allowArrowFunctions: {
						type: "boolean",
					},
					allowTypeAnnotation: {
						type: "boolean",
					},
					overrides: {
						type: "object",
						properties: {
							namedExports: {
								enum: ["declaration", "expression", "ignore"],
							},
						},
						additionalProperties: false,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			expression: "Expected a function expression.",
			declaration: "Expected a function declaration.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [style, { allowArrowFunctions, allowTypeAnnotation, overrides }] =
			context.options;
		const enforceDeclarations = style === "declaration";
		const { namedExports: exportFunctionStyle } = overrides;

		// Tracks, per enclosing function, whether it contains `this` or `super`.
		/** @type {Array<boolean>} */
		const stack = [];

		/**
		 * Checks if a function declaration is part of an overloaded function
		 * @param {ASTNode} node The function declaration node to check
		 * @returns {boolean} True if the function is overloaded
		 */
		function isOverloadedFunction(node) {
			const functionName = node.id.name;

			if (node.parent.type === "ExportNamedDeclaration") {
				return node.parent.parent.body.some(
					(/** @type {ASTNode} */ member) =>
						member.type === "ExportNamedDeclaration" &&
						member.declaration?.type === "TSDeclareFunction" &&
						member.declaration.id.name === functionName,
				);
			}

			if (node.parent.type === "SwitchCase") {
				return node.parent.parent.cases.some(
					(/** @type {ASTNode} */ switchCase) =>
						switchCase.consequent.some(
							(/** @type {ASTNode} */ member) =>
								member.type === "TSDeclareFunction" &&
								member.id.name === functionName,
						),
				);
			}

			return (
				Array.isArray(node.parent.body) &&
				node.parent.body.some(
					(/** @type {ASTNode} */ member) =>
						member.type === "TSDeclareFunction" &&
						member.id.name === functionName,
				)
			);
		}

		/** @type {RuleVisitor} */
		const nodesToCheck = {
			/**
			 * Checks a function declaration against the configured style.
			 * @param {ASTNode} node The `FunctionDeclaration` node to check.
			 * @returns {void}
			 */
			FunctionDeclaration(node) {
				stack.push(false);

				if (
					!enforceDeclarations &&
					node.parent.type !== "ExportDefaultDeclaration" &&
					(typeof exportFunctionStyle === "undefined" ||
						node.parent.type !== "ExportNamedDeclaration") &&
					!isOverloadedFunction(node)
				) {
					context.report({ node, messageId: "expression" });
				}

				if (
					node.parent.type === "ExportNamedDeclaration" &&
					exportFunctionStyle === "expression" &&
					!isOverloadedFunction(node)
				) {
					context.report({ node, messageId: "expression" });
				}
			},
			/**
			 * Discards the `this`/`super` flag collected for the function.
			 * @returns {void}
			 */
			"FunctionDeclaration:exit"() {
				stack.pop();
			},

			/**
			 * Checks a function expression against the configured style.
			 * @param {ASTNode} node The `FunctionExpression` node to check.
			 * @returns {void}
			 */
			FunctionExpression(node) {
				stack.push(false);

				if (
					enforceDeclarations &&
					node.parent.type === "VariableDeclarator" &&
					(typeof exportFunctionStyle === "undefined" ||
						node.parent.parent.parent.type !==
							"ExportNamedDeclaration") &&
					!(allowTypeAnnotation && node.parent.id.typeAnnotation)
				) {
					context.report({
						node: node.parent,
						messageId: "declaration",
					});
				}

				if (
					node.parent.type === "VariableDeclarator" &&
					node.parent.parent.parent.type ===
						"ExportNamedDeclaration" &&
					exportFunctionStyle === "declaration" &&
					!(allowTypeAnnotation && node.parent.id.typeAnnotation)
				) {
					context.report({
						node: node.parent,
						messageId: "declaration",
					});
				}
			},
			/**
			 * Discards the `this`/`super` flag collected for the function.
			 * @returns {void}
			 */
			"FunctionExpression:exit"() {
				stack.pop();
			},

			/**
			 * Records that the innermost function contains `this` or `super`.
			 * @returns {void}
			 */
			"ThisExpression, Super"() {
				if (stack.length > 0) {
					stack[stack.length - 1] = true;
				}
			},
		};

		if (!allowArrowFunctions) {
			/**
			 * Starts tracking `this`/`super` usage for the arrow function.
			 * @returns {void}
			 */
			nodesToCheck.ArrowFunctionExpression = function () {
				stack.push(false);
			};

			/**
			 * Checks an arrow function against the configured style.
			 * @param {ASTNode} node The `ArrowFunctionExpression` node to check.
			 * @returns {void}
			 */
			nodesToCheck["ArrowFunctionExpression:exit"] = function (node) {
				const hasThisOrSuperExpr = stack.pop();

				if (
					!hasThisOrSuperExpr &&
					node.parent.type === "VariableDeclarator"
				) {
					if (
						enforceDeclarations &&
						(typeof exportFunctionStyle === "undefined" ||
							node.parent.parent.parent.type !==
								"ExportNamedDeclaration") &&
						!(allowTypeAnnotation && node.parent.id.typeAnnotation)
					) {
						context.report({
							node: node.parent,
							messageId: "declaration",
						});
					}

					if (
						node.parent.parent.parent.type ===
							"ExportNamedDeclaration" &&
						exportFunctionStyle === "declaration" &&
						!(allowTypeAnnotation && node.parent.id.typeAnnotation)
					) {
						context.report({
							node: node.parent,
							messageId: "declaration",
						});
					}
				}
			};
		}

		return nodesToCheck;
	},
};

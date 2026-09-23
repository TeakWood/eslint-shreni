/**
 * @fileoverview A rule to control the style of variable initializations.
 * @author Colin Ihrig
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
// Helpers
//------------------------------------------------------------------------------

const CONSTANT_BINDINGS = new Set(["const", "using", "await using"]);

/**
 * Checks whether or not a given node is a for loop.
 * @param {ASTNode} block A node to check.
 * @returns {boolean} `true` when the node is a for loop.
 */
function isForLoop(block) {
	return (
		block.type === "ForInStatement" ||
		block.type === "ForOfStatement" ||
		block.type === "ForStatement"
	);
}

/**
 * Checks whether or not a given declarator node has its initializer.
 * @param {ASTNode} node A declarator node to check.
 * @returns {boolean} `true` when the node has its initializer.
 */
function isInitialized(node) {
	const declaration = node.parent;
	const block = declaration.parent;

	if (isForLoop(block)) {
		if (block.type === "ForStatement") {
			return block.init === declaration;
		}
		return block.left === declaration;
	}
	return Boolean(node.init);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Require or disallow initialization in variable declarations",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/init-declarations",
		},

		schema: {
			anyOf: [
				{
					type: "array",
					items: [
						{
							enum: ["always"],
						},
					],
					minItems: 0,
					maxItems: 1,
				},
				{
					type: "array",
					items: [
						{
							enum: ["never"],
						},
						{
							type: "object",
							properties: {
								ignoreForLoopInit: {
									type: "boolean",
								},
							},
							additionalProperties: false,
						},
					],
					minItems: 0,
					maxItems: 2,
				},
			],
		},

		defaultOptions: ["always"],

		messages: {
			initialized:
				"Variable '{{idName}}' should be initialized on declaration.",
			notInitialized:
				"Variable '{{idName}}' should not be initialized on declaration.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const mode = context.options[0];
		const params = context.options[1] || {};

		// Track whether we're inside a declared namespace
		let insideDeclaredNamespace = false;

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			/**
			 * Records that traversal has entered a declared namespace.
			 * @param {ASTNode} node The `TSModuleDeclaration` node.
			 * @returns {void} No return value.
			 */
			TSModuleDeclaration(node) {
				if (node.declare) {
					insideDeclaredNamespace = true;
				}
			},

			/**
			 * Records that traversal has left a declared namespace.
			 * @param {ASTNode} node The `TSModuleDeclaration` node.
			 * @returns {void} No return value.
			 */
			"TSModuleDeclaration:exit"(node) {
				if (node.declare) {
					insideDeclaredNamespace = false;
				}
			},

			/**
			 * Checks the declarators of a variable declaration for initializers.
			 * @param {ASTNode} node The `VariableDeclaration` node.
			 * @returns {void} No return value.
			 */
			"VariableDeclaration:exit"(node) {
				const kind = node.kind,
					declarations = node.declarations;

				if (node.declare || insideDeclaredNamespace) {
					return;
				}

				for (let i = 0; i < declarations.length; ++i) {
					const declaration = declarations[i],
						id = declaration.id,
						initialized = isInitialized(declaration),
						isIgnoredForLoop =
							params.ignoreForLoopInit && isForLoop(node.parent);
					let messageId = "";

					if (mode === "always" && !initialized) {
						messageId = "initialized";
					} else if (
						mode === "never" &&
						!CONSTANT_BINDINGS.has(kind) &&
						initialized &&
						!isIgnoredForLoop
					) {
						messageId = "notInitialized";
					}

					if (id.type === "Identifier" && messageId) {
						context.report({
							node: declaration,
							messageId,
							data: {
								idName: id.name,
							},
						});
					}
				}
			},
		};
	},
};

/**
 * @fileoverview Rule to enforce declarations in program or function body root.
 * @author Brandon Mills
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

/**
 * The rule's second option object. `meta.defaultOptions` has already filled the
 * member in by the time `create()` runs, so it is not optional here.
 * @typedef {Object} RuleOptions
 * @property {"allow" | "disallow"} blockScopedFunctions Whether a block-scoped function declaration is allowed in strict mode code.
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const validParent = new Set([
	"Program",
	"StaticBlock",
	"ExportNamedDeclaration",
	"ExportDefaultDeclaration",
]);
const validBlockStatementParent = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ArrowFunctionExpression",
]);

/**
 * Finds the nearest enclosing context where this rule allows declarations and returns its description.
 * @param {ASTNode} node Node to search from.
 * @returns {string} Description. One of "program", "function body", "class static block body".
 */
function getAllowedBodyDescription(node) {
	let { parent } = node;

	while (parent) {
		if (parent.type === "StaticBlock") {
			return "class static block body";
		}

		if (astUtils.isFunction(parent)) {
			return "function body";
		}

		({ parent } = parent);
	}

	return "program";
}

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: ["functions", { blockScopedFunctions: "allow" }],

		docs: {
			description:
				"Disallow variable or `function` declarations in nested blocks",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-inner-declarations",
		},

		schema: [
			{
				enum: ["functions", "both"],
			},
			{
				type: "object",
				properties: {
					blockScopedFunctions: {
						enum: ["allow", "disallow"],
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			moveDeclToRoot: "Move {{type}} declaration to {{body}} root.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const both = context.options[0] === "both";
		const { blockScopedFunctions } = /** @type {RuleOptions} */ (
			context.options[1]
		);

		const sourceCode = context.sourceCode;
		const ecmaVersion = context.languageOptions.ecmaVersion;

		/**
		 * Ensure that a given node is at a program or function body's root.
		 * @param {ASTNode} node Declaration node to check.
		 * @returns {void}
		 */
		function check(node) {
			const parent = node.parent;

			if (
				parent.type === "BlockStatement" &&
				validBlockStatementParent.has(parent.parent.type)
			) {
				return;
			}

			if (validParent.has(parent.type)) {
				return;
			}

			context.report({
				node,
				messageId: "moveDeclToRoot",
				data: {
					type:
						node.type === "FunctionDeclaration"
							? "function"
							: "variable",
					body: getAllowedBodyDescription(node),
				},
			});
		}

		return {
			FunctionDeclaration(node) {
				// A function's own scope always has an enclosing scope; at minimum the global one.
				const upperScope = /** @type {Scope} */ (
					sourceCode.getScope(node).upper
				);
				const isInStrictCode = upperScope.isStrict;

				if (
					blockScopedFunctions === "allow" &&
					ecmaVersion >= 2015 &&
					isInStrictCode
				) {
					return;
				}

				check(node);
			},
			VariableDeclaration(node) {
				if (both && node.kind === "var") {
					check(node);
				}
			},
		};
	},
};

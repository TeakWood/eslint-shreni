/**
 * @fileoverview Rule to flag when initializing to undefined
 * @author Ilya Volodin
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
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const CONSTANT_BINDINGS = new Set(["const", "using", "await using"]);

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow initializing variables to `undefined`",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-undef-init",
		},

		schema: [],
		fixable: "code",

		messages: {
			unnecessaryUndefinedInit:
				"It's not necessary to initialize '{{name}}' to undefined.",
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
			 * Reports a declarator that is explicitly initialized to `undefined`.
			 * @param {ASTNode} node The `VariableDeclarator` node.
			 * @returns {void}
			 */
			VariableDeclarator(node) {
				// A declarator always spans at least its `id`, so it always has a last token.
				const name = sourceCode.getText(node.id),
					init = node.init && node.init.name,
					scope = sourceCode.getScope(node),
					undefinedVar = astUtils.getVariableByName(
						scope,
						"undefined",
					),
					shadowed = undefinedVar && undefinedVar.defs.length > 0,
					lastToken = /** @type {Token} */ (
						sourceCode.getLastToken(node)
					);

				if (
					init === "undefined" &&
					!CONSTANT_BINDINGS.has(node.parent.kind) &&
					!shadowed
				) {
					context.report({
						node,
						messageId: "unnecessaryUndefinedInit",
						data: { name },
						/**
						 * Removes the `= undefined` initializer.
						 * @param {RuleFixer} fixer The fixer to build the edit with.
						 * @returns {EditInfo | null} The edit, or `null` when removing it would not be safe.
						 */
						fix(fixer) {
							if (node.parent.kind === "var") {
								return null;
							}

							if (
								node.id.type === "ArrayPattern" ||
								node.id.type === "ObjectPattern"
							) {
								// Don't fix destructuring assignment to `undefined`.
								return null;
							}

							if (
								sourceCode.commentsExistBetween(
									node.id,
									lastToken,
								)
							) {
								return null;
							}

							return fixer.removeRange([
								node.id.range[1],
								node.range[1],
							]);
						},
					});
				}
			},
		};
	},
};

/**
 * @fileoverview Rule to flag when using constructor for wrapper objects
 * @author Ilya Volodin
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { getVariableByName } = require("./utils/ast-utils");

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

		docs: {
			description:
				"Disallow `new` operators with the `String`, `Number`, and `Boolean` objects",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-new-wrappers",
		},

		schema: [],

		messages: {
			noConstructor: "Do not use {{fn}} as a constructor.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const { sourceCode } = context;

		return {
			/**
			 * Reports `new String()`, `new Number()`, and `new Boolean()` calls
			 * that resolve to the globals rather than a local shadow.
			 * @param {ASTNode} node The `NewExpression` node.
			 * @returns {void}
			 */
			NewExpression(node) {
				const wrapperObjects = ["String", "Number", "Boolean"];
				const { name } = node.callee;

				if (wrapperObjects.includes(name)) {
					const variable = getVariableByName(
						sourceCode.getScope(node),
						name,
					);

					if (variable && variable.identifiers.length === 0) {
						context.report({
							node,
							messageId: "noConstructor",
							data: { fn: name },
						});
					}
				}
			},
		};
	},
};

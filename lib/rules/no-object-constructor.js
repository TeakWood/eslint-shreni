/**
 * @fileoverview Rule to disallow calls to the `Object` constructor without an argument
 * @author Francesco Trotta
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const {
	getVariableByName,
	isArrowToken,
	isStartOfExpressionStatement,
	needsPrecedingSemicolon,
} = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Disallow calls to the `Object` constructor without an argument",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-object-constructor",
		},

		hasSuggestions: true,

		schema: [],

		messages: {
			preferLiteral: "The object literal notation {} is preferable.",
			useLiteral: "Replace with '{{replacement}}'.",
			useLiteralAfterSemicolon:
				"Replace with '{{replacement}}', add preceding semicolon.",
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
		 * Determines whether or not an object literal that replaces a specified node needs to be enclosed in parentheses.
		 * @param {ASTNode} node The node to be replaced.
		 * @returns {boolean} Whether or not parentheses around the object literal are required.
		 */
		function needsParentheses(node) {
			if (isStartOfExpressionStatement(node)) {
				return true;
			}

			const prevToken = sourceCode.getTokenBefore(node);

			if (prevToken && isArrowToken(prevToken)) {
				return true;
			}

			return false;
		}

		/**
		 * Reports on nodes where the `Object` constructor is called without arguments.
		 * @param {ASTNode} node The node to evaluate.
		 * @returns {void}
		 */
		function check(node) {
			if (
				node.callee.type !== "Identifier" ||
				node.callee.name !== "Object" ||
				node.arguments.length
			) {
				return;
			}

			const variable = getVariableByName(
				sourceCode.getScope(node),
				"Object",
			);

			if (variable && variable.identifiers.length === 0) {
				let replacement;
				let fixText;
				let messageId = "useLiteral";

				if (needsParentheses(node)) {
					replacement = "({})";
					if (needsPrecedingSemicolon(sourceCode, node)) {
						fixText = ";({})";
						messageId = "useLiteralAfterSemicolon";
					} else {
						fixText = "({})";
					}
				} else {
					replacement = fixText = "{}";
				}

				context.report({
					node,
					messageId: "preferLiteral",
					suggest: [
						{
							messageId,
							data: { replacement },
							fix: (/** @type {RuleFixer} */ fixer) =>
								fixer.replaceText(node, fixText),
						},
					],
				});
			}
		}

		return {
			CallExpression: check,
			NewExpression: check,
		};
	},
};

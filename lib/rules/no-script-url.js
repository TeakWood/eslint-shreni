/**
 * @fileoverview Rule to disallow `javascript:` URLs
 * @author Ilya Volodin
 */
/* eslint no-script-url: 0 -- Code is checking to report such URLs */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

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
			description: "Disallow `javascript:` URLs",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-script-url",
		},

		schema: [],

		messages: {
			unexpectedScriptURL: "Script URL is a form of eval.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/**
		 * Check whether a node's static value starts with `javascript:` or not.
		 * And report an error for unexpected script URL.
		 * @param {ASTNode} node node to check
		 * @returns {void}
		 */
		function check(node) {
			const value = astUtils.getStaticStringValue(node);

			if (
				typeof value === "string" &&
				value.toLowerCase().indexOf("javascript:") === 0
			) {
				context.report({ node, messageId: "unexpectedScriptURL" });
			}
		}
		return {
			/**
			 * Checks a string literal for a `javascript:` URL.
			 * @param {ASTNode} node The `Literal` node.
			 * @returns {void}
			 */
			Literal(node) {
				if (node.value && typeof node.value === "string") {
					check(node);
				}
			},

			/**
			 * Checks an untagged template literal for a `javascript:` URL.
			 * @param {ASTNode} node The `TemplateLiteral` node.
			 * @returns {void}
			 */
			TemplateLiteral(node) {
				if (!(
					node.parent &&
					node.parent.type === "TaggedTemplateExpression"
				)) {
					check(node);
				}
			},
		};
	},
};

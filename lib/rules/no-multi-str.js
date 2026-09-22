/**
 * @fileoverview Rule to flag when using multiline strings
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow multiline strings",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-multi-str",
		},

		schema: [],

		messages: {
			multilineString:
				"Multiline support is limited to browsers supporting ES5 only.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/**
		 * Determines if a given node is part of JSX syntax.
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} True if the node is a JSX node, false if not.
		 * @private
		 */
		function isJSXElement(node) {
			return node.type.indexOf("JSX") === 0;
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports a string literal whose raw text spans more than one line.
			 * @param {ASTNode} node The `Literal` node.
			 * @returns {void}
			 */
			Literal(node) {
				if (
					astUtils.LINEBREAK_MATCHER.test(node.raw) &&
					!isJSXElement(node.parent)
				) {
					context.report({
						node,
						messageId: "multilineString",
					});
				}
			},
		};
	},
};

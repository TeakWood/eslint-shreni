/**
 * @fileoverview Rule to flag octal escape sequences in string literals.
 * @author Ian Christian Myers
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

		docs: {
			description: "Disallow octal escape sequences in string literals",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-octal-escape",
		},

		schema: [],

		messages: {
			octalEscapeSequence:
				"Don't use octal: '\\{{sequence}}'. Use '\\u....' instead.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		return {
			/**
			 * Reports a string literal containing an octal escape sequence.
			 * @param {ASTNode} node The `Literal` node.
			 * @returns {void}
			 */
			Literal(node) {
				if (typeof node.value !== "string") {
					return;
				}

				// \0 represents a valid NULL character if it isn't followed by a digit.
				const match = node.raw.match(
					/^(?:[^\\]|\\.)*?\\([0-3][0-7]{1,2}|[4-7][0-7]|0(?=[89])|[1-7])/su,
				);

				if (match) {
					context.report({
						node,
						messageId: "octalEscapeSequence",
						data: { sequence: match[1] },
					});
				}
			},
		};
	},
};

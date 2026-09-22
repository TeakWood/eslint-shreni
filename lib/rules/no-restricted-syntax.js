/**
 * @fileoverview Rule to flag use of certain node types
 * @author Burak Yigit Kaya
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * One entry of the rule's options: either a bare esquery selector, or that
 * selector paired with the message to report in place of the default one.
 * @typedef {string | { selector: string, message?: string }} RestrictedSyntaxOption
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow specified syntax",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-restricted-syntax",
		},

		schema: {
			type: "array",
			items: {
				oneOf: [
					{
						type: "string",
					},
					{
						type: "object",
						properties: {
							selector: { type: "string" },
							message: { type: "string" },
						},
						required: ["selector"],
						additionalProperties: false,
					},
				],
			},
			uniqueItems: true,
			minItems: 0,
		},

		defaultOptions: [],

		messages: {
			// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
			restrictedSyntax: "{{message}}",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		return context.options.reduce(
			/**
			 * Adds a handler for one configured selector to the visitor.
			 * @param {RuleVisitor} result The visitor built from the earlier options.
			 * @param {RestrictedSyntaxOption} selectorOrObject The option to add a handler for.
			 * @returns {RuleVisitor} The visitor, including this option's handler.
			 */
			(result, selectorOrObject) => {
				const isStringFormat = typeof selectorOrObject === "string";
				const hasCustomMessage =
					!isStringFormat && Boolean(selectorOrObject.message);

				const selector = isStringFormat
					? selectorOrObject
					: selectorOrObject.selector;
				const message = hasCustomMessage
					? selectorOrObject.message
					: `Using '${selector}' is not allowed.`;

				return Object.assign(result, {
					/**
					 * Reports a node matched by this option's selector.
					 * @param {ASTNode} node The matched node.
					 * @returns {void}
					 */
					[selector](node) {
						context.report({
							node,
							messageId: "restrictedSyntax",
							data: { message },
						});
					},
				});
			},
			{},
		);
	},
};

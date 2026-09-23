/**
 * @fileoverview Enforce a maximum number of classes per file
 * @author James Garbutt <https://github.com/43081j>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

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
			description: "Enforce a maximum number of classes per file",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/max-classes-per-file",
		},

		schema: [
			{
				oneOf: [
					{
						type: "integer",
						minimum: 1,
					},
					{
						type: "object",
						properties: {
							ignoreExpressions: {
								type: "boolean",
							},
							max: {
								type: "integer",
								minimum: 1,
							},
						},
						additionalProperties: false,
					},
				],
			},
		],

		defaultOptions: [1],

		messages: {
			maximumExceeded:
				"File has too many classes ({{ classCount }}). Maximum allowed is {{ max }}.",
		},
	},
	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const option = context.options[0];
		const [ignoreExpressions, max] =
			typeof option === "number"
				? [false, option]
				: [option.ignoreExpressions, option.max || 1];

		let classCount = 0;

		return {
			/**
			 * Resets the class counter at the start of the file.
			 * @returns {void}
			 */
			Program() {
				classCount = 0;
			},

			/**
			 * Reports the file if it declares more classes than allowed.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				if (classCount > max) {
					context.report({
						node,
						loc: {
							start: node.body[0].loc.start,
							end: node.body.at(-1).loc.end,
						},
						messageId: "maximumExceeded",
						data: {
							classCount,
							max,
						},
					});
				}
			},

			/**
			 * Counts a class declaration.
			 * @returns {void}
			 */
			ClassDeclaration() {
				classCount++;
			},

			/**
			 * Counts a class expression unless expressions are ignored.
			 * @returns {void}
			 */
			ClassExpression() {
				if (!ignoreExpressions) {
					classCount++;
				}
			},
		};
	},
};

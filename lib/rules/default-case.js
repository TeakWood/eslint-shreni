/**
 * @fileoverview require default case in switch statements
 * @author Aliaksei Shytkin
 */

// @ts-check

"use strict";

const DEFAULT_COMMENT_PATTERN = /^no default$/iu;

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Comment} Comment */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [{}],

		docs: {
			description: "Require `default` cases in `switch` statements",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/default-case",
		},

		schema: [
			{
				type: "object",
				properties: {
					commentPattern: {
						type: "string",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			missingDefaultCase: "Expected a default case.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [options] = context.options;
		const commentPattern = options.commentPattern
			? new RegExp(options.commentPattern, "u")
			: DEFAULT_COMMENT_PATTERN;

		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Shortcut to get last element of array
		 * @template T
		 * @param {Array<T>} collection Array
		 * @returns {T | undefined} Last element, or `undefined` if the array is empty.
		 */
		function last(collection) {
			return collection.at(-1);
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports a `switch` statement that has neither a `default` case nor
			 * a trailing comment matching the configured pattern.
			 * @param {ASTNode} node The `SwitchStatement` node to check.
			 * @returns {void}
			 */
			SwitchStatement(node) {
				if (!node.cases.length) {
					/*
					 * skip check of empty switch because there is no easy way
					 * to extract comments inside it now
					 */
					return;
				}

				const hasDefault = node.cases.some(
					/**
					 * Checks whether a case clause is the `default` clause.
					 * @param {ASTNode} v The `SwitchCase` node to check.
					 * @returns {boolean} `true` if the clause is `default`.
					 */
					v => v.test === null,
				);

				if (!hasDefault) {
					/** @type {Comment | undefined} */
					let comment;

					const lastCase = last(node.cases);
					const comments = sourceCode.getCommentsAfter(lastCase);

					if (comments.length) {
						// The array is non-empty, so `last()` returns an element.
						comment = /** @type {Comment} */ (last(comments));
					}

					if (
						!comment ||
						!commentPattern.test(comment.value.trim())
					) {
						context.report({
							node,
							messageId: "missingDefaultCase",
						});
					}
				}
			},
		};
	},
};

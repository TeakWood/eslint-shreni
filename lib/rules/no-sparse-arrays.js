/**
 * @fileoverview Disallow sparse arrays
 * @author Nicholas C. Zakas
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

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow sparse arrays",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-sparse-arrays",
		},

		schema: [],

		messages: {
			unexpectedSparseArray: "Unexpected comma in middle of array.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports every hole in an array literal.
			 * @param {ASTNode} node The `ArrayExpression` node.
			 * @returns {void}
			 */
			ArrayExpression(node) {
				if (!node.elements.includes(null)) {
					return;
				}

				const { sourceCode } = context;

				/** @type {Token | undefined} */
				let commaToken;

				/*
				 * An `ArrayExpression` always starts with `[`, so the search
				 * always has a token to start from; and every element that is
				 * not the last one, as well as every hole, is followed by a
				 * comma. Both lookups therefore always find a token.
				 */
				for (const [index, element] of node.elements.entries()) {
					if (index === node.elements.length - 1 && element) {
						return;
					}

					commaToken = /** @type {Token} */ (
						sourceCode.getTokenAfter(
							element ??
								commaToken ??
								/** @type {Token} */ (
									sourceCode.getFirstToken(node)
								),
							astUtils.isCommaToken,
						)
					);

					if (element) {
						continue;
					}

					context.report({
						node,
						loc: commaToken.loc,
						messageId: "unexpectedSparseArray",
					});
				}
			},
		};
	},
};

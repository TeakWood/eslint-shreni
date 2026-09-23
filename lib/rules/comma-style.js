/**
 * @fileoverview Comma style - enforces comma styles of two types: last and first
 * @author Vignesh Anand aka vegetableman
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").FixFunction} FixFunction */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("../shared/types.js").Range} Range */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		deprecated: {
			message: "Formatting rules are being moved out of ESLint core.",
			url: "https://eslint.org/blog/2023/10/deprecating-formatting-rules/",
			deprecatedSince: "8.53.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"ESLint Stylistic now maintains deprecated stylistic core rules.",
					url: "https://eslint.style/guide/migration",
					plugin: {
						name: "@stylistic/eslint-plugin",
						url: "https://eslint.style",
					},
					rule: {
						name: "comma-style",
						url: "https://eslint.style/rules/comma-style",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent comma style",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/comma-style",
		},

		fixable: "code",

		schema: [
			{
				enum: ["first", "last"],
			},
			{
				type: "object",
				properties: {
					exceptions: {
						type: "object",
						additionalProperties: {
							type: "boolean",
						},
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpectedLineBeforeAndAfterComma:
				"Bad line breaking before and after ','.",
			expectedCommaFirst: "',' should be placed first.",
			expectedCommaLast: "',' should be placed last.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const style = context.options[0] || "last",
			sourceCode = context.sourceCode;
		/** @type {Record<string, boolean>} */
		const exceptions = {
			ArrayPattern: true,
			ArrowFunctionExpression: true,
			CallExpression: true,
			FunctionDeclaration: true,
			FunctionExpression: true,
			ImportDeclaration: true,
			ObjectPattern: true,
			NewExpression: true,
		};

		if (
			context.options.length === 2 &&
			Object.hasOwn(context.options[1], "exceptions")
		) {
			const keys = Object.keys(context.options[1].exceptions);

			for (let i = 0; i < keys.length; i++) {
				exceptions[keys[i]] = context.options[1].exceptions[keys[i]];
			}
		}

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Modified text based on the style
		 * @param {string} styleType Style type
		 * @param {string} text Source code text
		 * @returns {string} modified text
		 * @private
		 */
		function getReplacedText(styleType, text) {
			switch (styleType) {
				case "between":
					return `,${text.replace(astUtils.LINEBREAK_MATCHER, "")}`;

				case "first":
					return `${text},`;

				case "last":
					return `,${text}`;

				default:
					return "";
			}
		}

		/**
		 * Determines the fixer function for a given style.
		 * @param {string} styleType comma style
		 * @param {Token} previousItemToken The token to check.
		 * @param {Token} commaToken The token to check.
		 * @param {Token} currentItemToken The token to check.
		 * @returns {FixFunction} Fixer function
		 * @private
		 */
		function getFixerFunction(
			styleType,
			previousItemToken,
			commaToken,
			currentItemToken,
		) {
			const text =
				sourceCode.text.slice(
					previousItemToken.range[1],
					commaToken.range[0],
				) +
				sourceCode.text.slice(
					commaToken.range[1],
					currentItemToken.range[0],
				);
			/** @type {Range} */
			const range = [
				previousItemToken.range[1],
				currentItemToken.range[0],
			];

			/**
			 * Rewrites the text between the two items with the comma in place.
			 * @param {RuleFixer} fixer The fixer to use.
			 * @returns {EditInfo} The edit that repositions the comma.
			 */
			return function (fixer) {
				return fixer.replaceTextRange(
					range,
					getReplacedText(styleType, text),
				);
			};
		}

		/**
		 * Validates the spacing around single items in lists.
		 * @param {Token} previousItemToken The last token from the previous item.
		 * @param {Token} commaToken The token representing the comma.
		 * @param {Token} currentItemToken The first token of the current item.
		 * @param {ASTNode | Token} reportItem The item to use when reporting an error.
		 * @returns {void}
		 * @private
		 */
		function validateCommaItemSpacing(
			previousItemToken,
			commaToken,
			currentItemToken,
			reportItem,
		) {
			// if single line
			if (
				astUtils.isTokenOnSameLine(commaToken, currentItemToken) &&
				astUtils.isTokenOnSameLine(previousItemToken, commaToken)
			) {
				// do nothing.
			} else if (
				!astUtils.isTokenOnSameLine(commaToken, currentItemToken) &&
				!astUtils.isTokenOnSameLine(previousItemToken, commaToken)
			) {
				const comment = sourceCode.getCommentsAfter(commaToken)[0];
				const styleType =
					comment &&
					comment.type === "Block" &&
					astUtils.isTokenOnSameLine(commaToken, comment)
						? style
						: "between";

				// lone comma
				context.report({
					node: reportItem,
					loc: commaToken.loc,
					messageId: "unexpectedLineBeforeAndAfterComma",
					fix: getFixerFunction(
						styleType,
						previousItemToken,
						commaToken,
						currentItemToken,
					),
				});
			} else if (
				style === "first" &&
				!astUtils.isTokenOnSameLine(commaToken, currentItemToken)
			) {
				context.report({
					node: reportItem,
					loc: commaToken.loc,
					messageId: "expectedCommaFirst",
					fix: getFixerFunction(
						style,
						previousItemToken,
						commaToken,
						currentItemToken,
					),
				});
			} else if (
				style === "last" &&
				astUtils.isTokenOnSameLine(commaToken, currentItemToken)
			) {
				context.report({
					node: reportItem,
					loc: commaToken.loc,
					messageId: "expectedCommaLast",
					fix: getFixerFunction(
						style,
						previousItemToken,
						commaToken,
						currentItemToken,
					),
				});
			}
		}

		/**
		 * Checks the comma placement with regards to a declaration/property/element
		 * @param {ASTNode} node The binary expression node to check
		 * @param {string} property The property of the node containing child nodes.
		 * @returns {void}
		 * @private
		 */
		function validateComma(node, property) {
			// Only `ArrayExpression#elements` and `ArrayPattern#elements` can hold `null` holes.
			const items = /** @type {Array<ASTNode | null>} */ (node[property]),
				arrayLiteral =
					node.type === "ArrayExpression" ||
					node.type === "ArrayPattern";

			if (items.length > 1 || arrayLiteral) {
				// seed as opening [, which every node with a list always has
				let previousItemToken = /** @type {Token} */ (
					sourceCode.getFirstToken(node)
				);

				items.forEach(item => {
					/*
					 * The grammar guarantees each of these tokens exists: an
					 * item is always preceded by a comma or by the opening
					 * delimiter, and a hole is always followed by the comma
					 * that delimits it.
					 */
					const commaToken = /** @type {Token} */ (
							item
								? sourceCode.getTokenBefore(item)
								: previousItemToken
						),
						currentItemToken = /** @type {Token} */ (
							item
								? sourceCode.getFirstToken(item)
								: sourceCode.getTokenAfter(commaToken)
						),
						reportItem = item || currentItemToken;

					/*
					 * This works by comparing three token locations:
					 * - previousItemToken is the last token of the previous item
					 * - commaToken is the location of the comma before the current item
					 * - currentItemToken is the first token of the current item
					 *
					 * These values get switched around if item is undefined.
					 * previousItemToken will refer to the last token not belonging
					 * to the current item, which could be a comma or an opening
					 * square bracket. currentItemToken could be a comma.
					 *
					 * All comparisons are done based on these tokens directly, so
					 * they are always valid regardless of an undefined item.
					 */
					if (astUtils.isCommaToken(commaToken)) {
						validateCommaItemSpacing(
							previousItemToken,
							commaToken,
							currentItemToken,
							reportItem,
						);
					}

					if (item) {
						const tokenAfterItem = sourceCode.getTokenAfter(
							item,
							astUtils.isNotClosingParenToken,
						);

						// The item itself is made of tokens, so both branches find one.
						previousItemToken = /** @type {Token} */ (
							tokenAfterItem
								? sourceCode.getTokenBefore(tokenAfterItem)
								: sourceCode.ast.tokens.at(-1)
						);
					} else {
						previousItemToken = currentItemToken;
					}
				});

				/*
				 * Special case for array literals that have empty last items, such
				 * as [ 1, 2, ]. These arrays only have two items show up in the
				 * AST, so we need to look at the token to verify that there's no
				 * dangling comma.
				 */
				if (arrayLiteral) {
					// An array literal is at least `[]`, so it has a closing bracket preceded by a token.
					const lastToken = /** @type {Token} */ (
							sourceCode.getLastToken(node)
						),
						nextToLastToken = /** @type {Token} */ (
							sourceCode.getTokenBefore(lastToken)
						);

					if (astUtils.isCommaToken(nextToLastToken)) {
						// A dangling comma is always preceded by the opening bracket or an element.
						const tokenBeforeComma = /** @type {Token} */ (
							sourceCode.getTokenBefore(nextToLastToken)
						);

						validateCommaItemSpacing(
							tokenBeforeComma,
							nextToLastToken,
							lastToken,
							lastToken,
						);
					}
				}
			}
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		/** @type {RuleVisitor} */
		const nodes = {};

		if (!exceptions.VariableDeclaration) {
			/**
			 * Checks the comma placement between the declarators.
			 * @param {ASTNode} node The `VariableDeclaration` node.
			 * @returns {void}
			 */
			nodes.VariableDeclaration = function (node) {
				validateComma(node, "declarations");
			};
		}
		if (!exceptions.ObjectExpression) {
			/**
			 * Checks the comma placement between the properties.
			 * @param {ASTNode} node The `ObjectExpression` node.
			 * @returns {void}
			 */
			nodes.ObjectExpression = function (node) {
				validateComma(node, "properties");
			};
		}
		if (!exceptions.ObjectPattern) {
			/**
			 * Checks the comma placement between the properties.
			 * @param {ASTNode} node The `ObjectPattern` node.
			 * @returns {void}
			 */
			nodes.ObjectPattern = function (node) {
				validateComma(node, "properties");
			};
		}
		if (!exceptions.ArrayExpression) {
			/**
			 * Checks the comma placement between the elements.
			 * @param {ASTNode} node The `ArrayExpression` node.
			 * @returns {void}
			 */
			nodes.ArrayExpression = function (node) {
				validateComma(node, "elements");
			};
		}
		if (!exceptions.ArrayPattern) {
			/**
			 * Checks the comma placement between the elements.
			 * @param {ASTNode} node The `ArrayPattern` node.
			 * @returns {void}
			 */
			nodes.ArrayPattern = function (node) {
				validateComma(node, "elements");
			};
		}
		if (!exceptions.FunctionDeclaration) {
			/**
			 * Checks the comma placement between the parameters.
			 * @param {ASTNode} node The `FunctionDeclaration` node.
			 * @returns {void}
			 */
			nodes.FunctionDeclaration = function (node) {
				validateComma(node, "params");
			};
		}
		if (!exceptions.FunctionExpression) {
			/**
			 * Checks the comma placement between the parameters.
			 * @param {ASTNode} node The `FunctionExpression` node.
			 * @returns {void}
			 */
			nodes.FunctionExpression = function (node) {
				validateComma(node, "params");
			};
		}
		if (!exceptions.ArrowFunctionExpression) {
			/**
			 * Checks the comma placement between the parameters.
			 * @param {ASTNode} node The `ArrowFunctionExpression` node.
			 * @returns {void}
			 */
			nodes.ArrowFunctionExpression = function (node) {
				validateComma(node, "params");
			};
		}
		if (!exceptions.CallExpression) {
			/**
			 * Checks the comma placement between the arguments.
			 * @param {ASTNode} node The `CallExpression` node.
			 * @returns {void}
			 */
			nodes.CallExpression = function (node) {
				validateComma(node, "arguments");
			};
		}
		if (!exceptions.ImportDeclaration) {
			/**
			 * Checks the comma placement between the specifiers.
			 * @param {ASTNode} node The `ImportDeclaration` node.
			 * @returns {void}
			 */
			nodes.ImportDeclaration = function (node) {
				validateComma(node, "specifiers");
			};
		}
		if (!exceptions.NewExpression) {
			/**
			 * Checks the comma placement between the arguments.
			 * @param {ASTNode} node The `NewExpression` node.
			 * @returns {void}
			 */
			nodes.NewExpression = function (node) {
				validateComma(node, "arguments");
			};
		}

		return nodes;
	},
};

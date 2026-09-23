/**
 * @fileoverview enforce consistent line breaks inside function parentheses
 * @author Teddy Katz
 * @deprecated in ESLint v8.53.0
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
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

/**
 * The parenthesis tokens of a node, as `getParenTokens()` reports them.
 * @typedef {{ leftParen: Token, rightParen: Token }} ParenTokens
 */

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
						name: "function-paren-newline",
						url: "https://eslint.style/rules/function-paren-newline",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent line breaks inside function parentheses",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/function-paren-newline",
		},

		fixable: "whitespace",

		schema: [
			{
				oneOf: [
					{
						enum: [
							"always",
							"never",
							"consistent",
							"multiline",
							"multiline-arguments",
						],
					},
					{
						type: "object",
						properties: {
							minItems: {
								type: "integer",
								minimum: 0,
							},
						},
						additionalProperties: false,
					},
				],
			},
		],

		messages: {
			expectedBefore: "Expected newline before ')'.",
			expectedAfter: "Expected newline after '('.",
			expectedBetween: "Expected newline between arguments/params.",
			unexpectedBefore: "Unexpected newline before ')'.",
			unexpectedAfter: "Unexpected newline after '('.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const rawOption = context.options[0] || "multiline";
		const multilineOption = rawOption === "multiline";
		const multilineArgumentsOption = rawOption === "multiline-arguments";
		const consistentOption = rawOption === "consistent";

		/**
		 * The minimum element count that forces newlines. `null` for the options
		 * that decide by some other means than a count, and `undefined` when the
		 * object option omits `minItems`.
		 * @type {number | null | undefined}
		 */
		let minItems;

		if (typeof rawOption === "object") {
			minItems = rawOption.minItems;
		} else if (rawOption === "always") {
			minItems = 0;
		} else if (rawOption === "never") {
			minItems = Infinity;
		} else {
			minItems = null;
		}

		//----------------------------------------------------------------------
		// Helpers
		//----------------------------------------------------------------------

		/**
		 * Determines whether there should be newlines inside function parens
		 * @param {Array<ASTNode>} elements The arguments or parameters in the list
		 * @param {boolean} hasLeftNewline `true` if the left paren has a newline in the current code.
		 * @returns {boolean} `true` if there should be newlines inside the function parens
		 */
		function shouldHaveNewlines(elements, hasLeftNewline) {
			if (multilineArgumentsOption && elements.length === 1) {
				return hasLeftNewline;
			}
			if (multilineOption || multilineArgumentsOption) {
				return elements.some(
					(element, index) =>
						index !== elements.length - 1 &&
						element.loc.end.line !==
							elements[index + 1].loc.start.line,
				);
			}
			if (consistentOption) {
				return hasLeftNewline;
			}
			/*
			 * Every option that leaves `minItems` non-numeric has returned by
			 * now, apart from an object option that omitted it -- and there the
			 * relational comparison's own coercion is what decides the answer.
			 */
			return elements.length >= /** @type {number} */ (minItems);
		}

		/**
		 * Validates parens
		 * @param {ParenTokens} parens An object with keys `leftParen` for the left paren token, and `rightParen` for the right paren token
		 * @param {Array<ASTNode>} elements The arguments or parameters in the list
		 * @returns {void}
		 */
		function validateParens(parens, elements) {
			const leftParen = parens.leftParen;
			const rightParen = parens.rightParen;

			// The matching right paren always follows the left one, so this lookup finds a token.
			const tokenAfterLeftParen = /** @type {Token} */ (
				sourceCode.getTokenAfter(leftParen)
			);

			// The matching left paren always precedes the right one, so this lookup finds a token.
			const tokenBeforeRightParen = /** @type {Token} */ (
				sourceCode.getTokenBefore(rightParen)
			);

			const hasLeftNewline = !astUtils.isTokenOnSameLine(
				leftParen,
				tokenAfterLeftParen,
			);
			const hasRightNewline = !astUtils.isTokenOnSameLine(
				tokenBeforeRightParen,
				rightParen,
			);
			const needsNewlines = shouldHaveNewlines(elements, hasLeftNewline);

			if (hasLeftNewline && !needsNewlines) {
				context.report({
					node: leftParen,
					messageId: "unexpectedAfter",
					/**
					 * Removes the newline after the left paren.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo|Array<EditInfo>|null} The fix, or `null` when a comment blocks it.
					 */
					fix(fixer) {
						return sourceCode
							.getText()
							.slice(
								leftParen.range[1],
								tokenAfterLeftParen.range[0],
							)
							.trim()
							? // If there is a comment between the ( and the first element, don't do a fix.
								null
							: fixer.removeRange([
									leftParen.range[1],
									tokenAfterLeftParen.range[0],
								]);
					},
				});
			} else if (!hasLeftNewline && needsNewlines) {
				context.report({
					node: leftParen,
					messageId: "expectedAfter",
					/**
					 * Inserts the required newline after the left paren.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix: fixer => fixer.insertTextAfter(leftParen, "\n"),
				});
			}

			if (hasRightNewline && !needsNewlines) {
				context.report({
					node: rightParen,
					messageId: "unexpectedBefore",
					/**
					 * Removes the newline before the right paren.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo|Array<EditInfo>|null} The fix, or `null` when a comment blocks it.
					 */
					fix(fixer) {
						return sourceCode
							.getText()
							.slice(
								tokenBeforeRightParen.range[1],
								rightParen.range[0],
							)
							.trim()
							? // If there is a comment between the last element and the ), don't do a fix.
								null
							: fixer.removeRange([
									tokenBeforeRightParen.range[1],
									rightParen.range[0],
								]);
					},
				});
			} else if (!hasRightNewline && needsNewlines) {
				context.report({
					node: rightParen,
					messageId: "expectedBefore",
					/**
					 * Inserts the required newline before the right paren.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix: fixer => fixer.insertTextBefore(rightParen, "\n"),
				});
			}
		}

		/**
		 * Validates a list of arguments or parameters
		 * @param {ParenTokens} parens An object with keys `leftParen` for the left paren token, and `rightParen` for the right paren token
		 * @param {Array<ASTNode>} elements The arguments or parameters in the list
		 * @returns {void}
		 */
		function validateArguments(parens, elements) {
			const leftParen = parens.leftParen;

			// The matching right paren always follows the left one, so this lookup finds a token.
			const tokenAfterLeftParen = /** @type {Token} */ (
				sourceCode.getTokenAfter(leftParen)
			);
			const hasLeftNewline = !astUtils.isTokenOnSameLine(
				leftParen,
				tokenAfterLeftParen,
			);
			const needsNewlines = shouldHaveNewlines(elements, hasLeftNewline);

			for (let i = 0; i <= elements.length - 2; i++) {
				const currentElement = elements[i];
				const nextElement = elements[i + 1];
				const hasNewLine =
					currentElement.loc.end.line !== nextElement.loc.start.line;

				if (!hasNewLine && needsNewlines) {
					context.report({
						node: currentElement,
						messageId: "expectedBetween",
						/**
						 * Inserts the required newline between two elements.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The fix.
						 */
						fix: fixer => fixer.insertTextBefore(nextElement, "\n"),
					});
				}
			}
		}

		/**
		 * Gets the left paren and right paren tokens of a node.
		 * @param {ASTNode} node The node with parens
		 * @throws {TypeError} Unexpected node type.
		 * @returns {ParenTokens|null} An object with keys `leftParen` for the left paren token, and `rightParen` for the right paren token.
		 * Can also return `null` if an expression has no parens (e.g. a NewExpression with no arguments, or an ArrowFunctionExpression
		 * with a single parameter)
		 */
		function getParenTokens(node) {
			switch (node.type) {
				case "NewExpression":
					// A `new` expression spans at least `new` and its callee, so both lookups below find a token.
					if (
						!node.arguments.length &&
						!(
							astUtils.isOpeningParenToken(
								/** @type {Token} */ (
									sourceCode.getLastToken(node, { skip: 1 })
								),
							) &&
							astUtils.isClosingParenToken(
								/** @type {Token} */ (
									sourceCode.getLastToken(node)
								),
							) &&
							node.callee.range[1] < node.range[1]
						)
					) {
						// If the NewExpression does not have parens (e.g. `new Foo`), return null.
						return null;
					}

				// falls through

				case "CallExpression":
					return {
						// A call always has an argument list, so its parens are both present.
						leftParen: /** @type {Token} */ (
							sourceCode.getTokenAfter(
								node.callee,
								astUtils.isOpeningParenToken,
							)
						),
						rightParen: /** @type {Token} */ (
							sourceCode.getLastToken(node)
						),
					};

				case "FunctionDeclaration":
				case "FunctionExpression": {
					// A function always has a parameter list, so its parens are both present.
					const leftParen = /** @type {Token} */ (
						sourceCode.getFirstToken(
							node,
							astUtils.isOpeningParenToken,
						)
					);
					const rightParen = /** @type {Token} */ (
						node.params.length
							? sourceCode.getTokenAfter(
									node.params.at(-1),
									astUtils.isClosingParenToken,
								)
							: sourceCode.getTokenAfter(leftParen)
					);

					return { leftParen, rightParen };
				}

				case "ArrowFunctionExpression": {
					// An arrow function is at least a parameter list and `=>`, so the lookup finds a token.
					const firstToken = /** @type {Token} */ (
						sourceCode.getFirstToken(node, {
							skip: node.async ? 1 : 0,
						})
					);

					if (!astUtils.isOpeningParenToken(firstToken)) {
						// If the ArrowFunctionExpression has a single param without parens, return null.
						return null;
					}

					// `firstToken` is the opening paren, so the paren closing the list is present.
					const rightParen = /** @type {Token} */ (
						node.params.length
							? sourceCode.getTokenAfter(
									node.params.at(-1),
									astUtils.isClosingParenToken,
								)
							: sourceCode.getTokenAfter(firstToken)
					);

					return {
						leftParen: firstToken,
						rightParen,
					};
				}

				case "ImportExpression": {
					// `import` is always followed by its parenthesized source.
					const leftParen = /** @type {Token} */ (
						sourceCode.getFirstToken(node, 1)
					);
					const rightParen = /** @type {Token} */ (
						sourceCode.getLastToken(node)
					);

					return { leftParen, rightParen };
				}

				default:
					throw new TypeError(
						`unexpected node with type ${node.type}`,
					);
			}
		}

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------

		return {
			/**
			 * Checks the parens of every node that has an argument or parameter
			 * list. The key is an array, which becomes the comma-separated
			 * selector esquery expects once the property name is coerced; the
			 * cast stands for that coercion, which tsc does not model.
			 * @param {ASTNode} node The node to check.
			 * @returns {void}
			 */
			[/** @type {any} */ ([
				"ArrowFunctionExpression",
				"CallExpression",
				"FunctionDeclaration",
				"FunctionExpression",
				"ImportExpression",
				"NewExpression",
			])](node) {
				const parens = getParenTokens(node);

				/** @type {Array<ASTNode>} */
				let params;

				if (node.type === "ImportExpression") {
					params = [node.source];
				} else if (astUtils.isFunction(node)) {
					params = node.params;
				} else {
					params = node.arguments;
				}

				if (parens) {
					validateParens(parens, params);

					if (multilineArgumentsOption) {
						validateArguments(parens, params);
					}
				}
			},
		};
	},
};

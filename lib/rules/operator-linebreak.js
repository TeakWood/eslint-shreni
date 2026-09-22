/**
 * @fileoverview Operator linebreak - enforces operator linebreak style of two types: after and before
 * @author Benoît Zugmeyer
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
/** @typedef {import("./utils/types.js").FixFunction} FixFunction */

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
						name: "operator-linebreak",
						url: "https://eslint.style/rules/operator-linebreak",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent linebreak style for operators",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/operator-linebreak",
		},

		schema: [
			{
				enum: ["after", "before", "none", null],
			},
			{
				type: "object",
				properties: {
					overrides: {
						type: "object",
						additionalProperties: {
							enum: ["after", "before", "none", "ignore"],
						},
					},
				},
				additionalProperties: false,
			},
		],

		fixable: "code",

		messages: {
			operatorAtBeginning:
				"'{{operator}}' should be placed at the beginning of the line.",
			operatorAtEnd:
				"'{{operator}}' should be placed at the end of the line.",
			badLinebreak: "Bad line breaking before and after '{{operator}}'.",
			noLinebreak:
				"There should be no line break before or after '{{operator}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const usedDefaultGlobal = !context.options[0];
		const globalStyle = context.options[0] || "after";
		const options = context.options[1] || {};

		/*
		 * The map is keyed by operator text, so every read of it is a computed
		 * lookup on a string that the schema never enumerates.
		 */
		/** @type {Record<string, string>} */
		const styleOverrides = options.overrides
			? Object.assign({}, options.overrides)
			: {};

		if (usedDefaultGlobal && !styleOverrides["?"]) {
			styleOverrides["?"] = "before";
		}

		if (usedDefaultGlobal && !styleOverrides[":"]) {
			styleOverrides[":"] = "before";
		}

		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Gets a fixer function to fix rule issues
		 * @param {Token} operatorToken The operator token of an expression
		 * @param {string} desiredStyle The style for the rule. One of 'before', 'after', 'none'
		 * @returns {FixFunction} A fixer function
		 */
		function getFixer(operatorToken, desiredStyle) {
			/**
			 * Moves the operator to the side the configured style asks for.
			 * @param {RuleFixer} fixer The fixer object.
			 * @returns {EditInfo|null} The fix, or `null` when a comment makes it unsafe.
			 */
			return fixer => {
				/*
				 * An operator always sits between two operands, so a token
				 * exists on each side of it.
				 */
				const tokenBefore = /** @type {Token} */ (
					sourceCode.getTokenBefore(operatorToken)
				);
				const tokenAfter = /** @type {Token} */ (
					sourceCode.getTokenAfter(operatorToken)
				);
				const textBefore = sourceCode.text.slice(
					tokenBefore.range[1],
					operatorToken.range[0],
				);
				const textAfter = sourceCode.text.slice(
					operatorToken.range[1],
					tokenAfter.range[0],
				);
				const hasLinebreakBefore = !astUtils.isTokenOnSameLine(
					tokenBefore,
					operatorToken,
				);
				const hasLinebreakAfter = !astUtils.isTokenOnSameLine(
					operatorToken,
					tokenAfter,
				);
				let newTextBefore, newTextAfter;

				if (
					hasLinebreakBefore !== hasLinebreakAfter &&
					desiredStyle !== "none"
				) {
					// If there is a comment before and after the operator, don't do a fix.
					if (
						sourceCode.getTokenBefore(operatorToken, {
							includeComments: true,
						}) !== tokenBefore &&
						sourceCode.getTokenAfter(operatorToken, {
							includeComments: true,
						}) !== tokenAfter
					) {
						return null;
					}

					/*
					 * If there is only one linebreak and it's on the wrong side of the operator, swap the text before and after the operator.
					 * foo &&
					 *           bar
					 * would get fixed to
					 * foo
					 *        && bar
					 */
					newTextBefore = textAfter;
					newTextAfter = textBefore;
				} else {
					const LINEBREAK_REGEX =
						astUtils.createGlobalLinebreakMatcher();

					// Otherwise, if no linebreak is desired and no comments interfere, replace the linebreaks with empty strings.
					newTextBefore =
						desiredStyle === "before" || textBefore.trim()
							? textBefore
							: textBefore.replace(LINEBREAK_REGEX, "");
					newTextAfter =
						desiredStyle === "after" || textAfter.trim()
							? textAfter
							: textAfter.replace(LINEBREAK_REGEX, "");

					// If there was no change (due to interfering comments), don't output a fix.
					if (
						newTextBefore === textBefore &&
						newTextAfter === textAfter
					) {
						return null;
					}
				}

				if (
					newTextAfter === "" &&
					tokenAfter.type === "Punctuator" &&
					"+-".includes(operatorToken.value) &&
					tokenAfter.value === operatorToken.value
				) {
					// To avoid accidentally creating a ++ or -- operator, insert a space if the operator is a +/- and the following token is a unary +/-.
					newTextAfter += " ";
				}

				return fixer.replaceTextRange(
					[tokenBefore.range[1], tokenAfter.range[0]],
					newTextBefore + operatorToken.value + newTextAfter,
				);
			};
		}

		/**
		 * Checks the operator placement
		 * @param {ASTNode} node The node to check
		 * @param {ASTNode} rightSide The node that comes after the operator in `node`
		 * @param {string} operator The operator
		 * @returns {void}
		 * @private
		 */
		function validateNode(node, rightSide, operator) {
			/*
			 * Find the operator token by searching from the right side, because between the left side and the operator
			 * there could be additional tokens from type annotations. Search specifically for the token which
			 * value equals the operator, in order to skip possible opening parentheses before the right side node.
			 *
			 * Every caller reaches here only for a node whose grammar puts
			 * `operator` before `rightSide`, and an operator always has an
			 * operand on each side, so all three lookups land on a token.
			 */
			const operatorToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(
					rightSide,
					(/** @type {Token} */ token) => token.value === operator,
				)
			);
			const leftToken = /** @type {Token} */ (
				sourceCode.getTokenBefore(operatorToken)
			);
			const rightToken = /** @type {Token} */ (
				sourceCode.getTokenAfter(operatorToken)
			);
			const operatorStyleOverride = styleOverrides[operator];
			const style = operatorStyleOverride || globalStyle;
			const fix = getFixer(operatorToken, style);

			// if single line
			if (
				astUtils.isTokenOnSameLine(leftToken, operatorToken) &&
				astUtils.isTokenOnSameLine(operatorToken, rightToken)
			) {
				// do nothing.
			} else if (
				operatorStyleOverride !== "ignore" &&
				!astUtils.isTokenOnSameLine(leftToken, operatorToken) &&
				!astUtils.isTokenOnSameLine(operatorToken, rightToken)
			) {
				// lone operator
				context.report({
					node,
					loc: operatorToken.loc,
					messageId: "badLinebreak",
					data: {
						operator,
					},
					fix,
				});
			} else if (
				style === "before" &&
				astUtils.isTokenOnSameLine(leftToken, operatorToken)
			) {
				context.report({
					node,
					loc: operatorToken.loc,
					messageId: "operatorAtBeginning",
					data: {
						operator,
					},
					fix,
				});
			} else if (
				style === "after" &&
				astUtils.isTokenOnSameLine(operatorToken, rightToken)
			) {
				context.report({
					node,
					loc: operatorToken.loc,
					messageId: "operatorAtEnd",
					data: {
						operator,
					},
					fix,
				});
			} else if (style === "none") {
				context.report({
					node,
					loc: operatorToken.loc,
					messageId: "noLinebreak",
					data: {
						operator,
					},
					fix,
				});
			}
		}

		/**
		 * Validates a binary expression using `validateNode`
		 * @param {ASTNode} node node to be validated
		 * @returns {void}
		 */
		function validateBinaryExpression(node) {
			validateNode(node, node.right, node.operator);
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			BinaryExpression: validateBinaryExpression,
			LogicalExpression: validateBinaryExpression,
			AssignmentExpression: validateBinaryExpression,
			/**
			 * Validates the `=` of an initialized variable declarator.
			 * @param {ASTNode} node The `VariableDeclarator` node.
			 * @returns {void}
			 */
			VariableDeclarator(node) {
				if (node.init) {
					validateNode(node, node.init, "=");
				}
			},

			/**
			 * Validates the `=` of an initialized property definition.
			 * @param {ASTNode} node The `PropertyDefinition` node.
			 * @returns {void}
			 */
			PropertyDefinition(node) {
				if (node.value) {
					validateNode(node, node.value, "=");
				}
			},

			/**
			 * Validates the `?` and `:` of a conditional expression.
			 * @param {ASTNode} node The `ConditionalExpression` node.
			 * @returns {void}
			 */
			ConditionalExpression(node) {
				validateNode(node, node.consequent, "?");
				validateNode(node, node.alternate, ":");
			},
		};
	},
};

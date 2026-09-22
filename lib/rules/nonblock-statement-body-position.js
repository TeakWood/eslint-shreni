/**
 * @fileoverview enforce the location of single-line statements
 * @author Teddy Katz
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const POSITION_SCHEMA = { enum: ["beside", "below", "any"] };

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
						name: "nonblock-statement-body-position",
						url: "https://eslint.style/rules/nonblock-statement-body-position",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce the location of single-line statements",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/nonblock-statement-body-position",
		},

		fixable: "whitespace",

		schema: [
			POSITION_SCHEMA,
			{
				properties: {
					overrides: {
						properties: {
							if: POSITION_SCHEMA,
							else: POSITION_SCHEMA,
							while: POSITION_SCHEMA,
							do: POSITION_SCHEMA,
							for: POSITION_SCHEMA,
						},
						additionalProperties: false,
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			expectNoLinebreak: "Expected no linebreak before this statement.",
			expectLinebreak: "Expected a linebreak before this statement.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//----------------------------------------------------------------------
		// Helpers
		//----------------------------------------------------------------------

		/**
		 * Gets the applicable preference for a particular keyword
		 * @param {string} keywordName The name of a keyword, e.g. 'if'
		 * @returns {string} The applicable option for the keyword, e.g. 'beside'
		 */
		function getOption(keywordName) {
			return (
				(context.options[1] &&
					context.options[1].overrides &&
					context.options[1].overrides[keywordName]) ||
				context.options[0] ||
				"beside"
			);
		}

		/**
		 * Validates the location of a single-line statement
		 * @param {ASTNode} node The single-line statement
		 * @param {string} keywordName The applicable keyword name for the single-line statement
		 * @returns {void}
		 */
		function validateStatement(node, keywordName) {
			const option = getOption(keywordName);

			if (node.type === "BlockStatement" || option === "any") {
				return;
			}

			/*
			 * Every statement passed here is the body of an `if`/`else`/`while`/
			 * `do`/`for`, so it is always preceded by at least the keyword or the
			 * closing paren of the header.
			 */
			const tokenBefore = /** @type {Token} */ (
				sourceCode.getTokenBefore(node)
			);

			if (
				tokenBefore.loc.end.line === node.loc.start.line &&
				option === "below"
			) {
				context.report({
					node,
					messageId: "expectLinebreak",
					/**
					 * Inserts the missing linebreak before the statement.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo} The fix.
					 */
					fix: fixer => fixer.insertTextBefore(node, "\n"),
				});
			} else if (
				tokenBefore.loc.end.line !== node.loc.start.line &&
				option === "beside"
			) {
				context.report({
					node,
					messageId: "expectNoLinebreak",
					/**
					 * Replaces the linebreak before the statement with a space.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo|null} The fix, or `null` if a comment is in the way.
					 */
					fix(fixer) {
						if (
							sourceCode
								.getText()
								.slice(tokenBefore.range[1], node.range[0])
								.trim()
						) {
							return null;
						}
						return fixer.replaceTextRange(
							[tokenBefore.range[1], node.range[0]],
							" ",
						);
					},
				});
			}
		}

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------

		return {
			/**
			 * Checks the location of the consequent and the alternate.
			 * @param {ASTNode} node The `IfStatement` node.
			 * @returns {void}
			 */
			IfStatement(node) {
				validateStatement(node.consequent, "if");

				// Check the `else` node, but don't check 'else if' statements.
				if (node.alternate && node.alternate.type !== "IfStatement") {
					validateStatement(node.alternate, "else");
				}
			},

			/**
			 * Checks the location of the loop body.
			 * @param {ASTNode} node The `WhileStatement` node.
			 * @returns {void}
			 */
			WhileStatement: node => validateStatement(node.body, "while"),

			/**
			 * Checks the location of the loop body.
			 * @param {ASTNode} node The `DoWhileStatement` node.
			 * @returns {void}
			 */
			DoWhileStatement: node => validateStatement(node.body, "do"),

			/**
			 * Checks the location of the loop body.
			 * @param {ASTNode} node The `ForStatement` node.
			 * @returns {void}
			 */
			ForStatement: node => validateStatement(node.body, "for"),

			/**
			 * Checks the location of the loop body.
			 * @param {ASTNode} node The `ForInStatement` node.
			 * @returns {void}
			 */
			ForInStatement: node => validateStatement(node.body, "for"),

			/**
			 * Checks the location of the loop body.
			 * @param {ASTNode} node The `ForOfStatement` node.
			 * @returns {void}
			 */
			ForOfStatement: node => validateStatement(node.body, "for"),
		};
	},
};

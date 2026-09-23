/**
 * @fileoverview Rule to flag the use of empty character classes in regular expressions
 * @author Ian Christian Myers
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { RegExpParser, visitRegExpAST } = require("@eslint-community/regexpp");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("@eslint-community/regexpp").AST.CharacterClass} CharacterClass */
/** @typedef {import("@eslint-community/regexpp").AST.Pattern} Pattern */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const parser = new RegExpParser();
const QUICK_TEST_REGEX = /\[\]/u;

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description:
				"Disallow empty character classes in regular expressions",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-empty-character-class",
		},

		schema: [],

		messages: {
			unexpected: "Empty class.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		return {
			/**
			 * Reports every empty, non-negated character class in a regex literal.
			 * @param {ASTNode} node The regex `Literal` node to check.
			 * @returns {void}
			 */
			"Literal[regex]"(node) {
				const { pattern, flags } = node.regex;

				if (!QUICK_TEST_REGEX.test(pattern)) {
					return;
				}

				/** @type {Pattern} */
				let regExpAST;

				try {
					regExpAST = parser.parsePattern(
						pattern,
						0,
						pattern.length,
						{
							unicode: flags.includes("u"),
							unicodeSets: flags.includes("v"),
						},
					);
				} catch {
					// Ignore regular expressions that regexpp cannot parse
					return;
				}

				visitRegExpAST(regExpAST, {
					/**
					 * Reports the literal if this character class is empty.
					 * @param {CharacterClass} characterClass The character class being entered.
					 * @returns {void}
					 */
					onCharacterClassEnter(characterClass) {
						if (
							!characterClass.negate &&
							characterClass.elements.length === 0
						) {
							context.report({ node, messageId: "unexpected" });
						}
					},
				});
			},
		};
	},
};

/**
 * @fileoverview Rule to count multiple spaces in regular expressions
 * @author Matt DuVall <http://www.mattduvall.com/>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");
const regexpp = require("@eslint-community/regexpp");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("@eslint-community/regexpp").AST.CharacterClass} CharacterClass */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const regExpParser = new regexpp.RegExpParser();
const DOUBLE_SPACE = / {2}/u;

/**
 * Check if node is a string
 * @param {ASTNode} node node to evaluate
 * @returns {boolean} True if its a string
 * @private
 */
function isString(node) {
	return node && node.type === "Literal" && typeof node.value === "string";
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow multiple spaces in regular expressions",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-regex-spaces",
		},

		schema: [],
		fixable: "code",

		messages: {
			multipleSpaces: "Spaces are hard to count. Use {{{length}}}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Validate regular expression
		 * @param {ASTNode} nodeToReport Node to report.
		 * @param {string} pattern Regular expression pattern to validate.
		 * @param {string} rawPattern Raw representation of the pattern in the source code.
		 * @param {number} rawPatternStartRange Start range of the pattern in the source code.
		 * @param {string} flags Regular expression flags.
		 * @returns {void}
		 * @private
		 */
		function checkRegex(
			nodeToReport,
			pattern,
			rawPattern,
			rawPatternStartRange,
			flags,
		) {
			// Skip if there are no consecutive spaces in the source code, to avoid reporting e.g., RegExp(' \ ').
			if (!DOUBLE_SPACE.test(rawPattern)) {
				return;
			}

			/** @type {Array<CharacterClass>} */
			const characterClassNodes = [];
			let regExpAST;

			try {
				regExpAST = regExpParser.parsePattern(
					pattern,
					0,
					pattern.length,
					{
						unicode: flags.includes("u"),
						unicodeSets: flags.includes("v"),
					},
				);
			} catch {
				// Ignore regular expressions with syntax errors
				return;
			}

			regexpp.visitRegExpAST(regExpAST, {
				/**
				 * Collects each character class so its span can be skipped later.
				 * @param {CharacterClass} ccNode The character class node.
				 * @returns {void}
				 */
				onCharacterClassEnter(ccNode) {
					characterClassNodes.push(ccNode);
				},
			});

			const spacesPattern = /( {2,})(?: [+*{?]|[^+*{?]|$)/gu;
			let match;

			while ((match = spacesPattern.exec(pattern))) {
				const {
					1: { length },
					index,
				} = match;

				// Report only consecutive spaces that are not in character classes.
				if (
					characterClassNodes.every(
						({ start, end }) => index < start || end <= index,
					)
				) {
					context.report({
						node: nodeToReport,
						messageId: "multipleSpaces",
						data: { length },
						/**
						 * Replaces the run of spaces with a quantified single space.
						 * @param {RuleFixer} fixer The fixer to build the edit with.
						 * @returns {EditInfo | null} The edit, or `null` when the raw pattern differs from the parsed one.
						 */
						fix(fixer) {
							if (pattern !== rawPattern) {
								return null;
							}
							return fixer.replaceTextRange(
								[
									rawPatternStartRange + index,
									rawPatternStartRange + index + length,
								],
								` {${length}}`,
							);
						},
					});

					// Report only the first occurrence of consecutive spaces
					return;
				}
			}
		}

		/**
		 * Validate regular expression literals
		 * @param {ASTNode} node node to validate
		 * @returns {void}
		 * @private
		 */
		function checkLiteral(node) {
			if (node.regex) {
				const pattern = node.regex.pattern;
				const rawPattern = node.raw.slice(1, node.raw.lastIndexOf("/"));
				const rawPatternStartRange = node.range[0] + 1;
				const flags = node.regex.flags;

				checkRegex(
					node,
					pattern,
					rawPattern,
					rawPatternStartRange,
					flags,
				);
			}
		}

		/**
		 * Validate strings passed to the RegExp constructor
		 * @param {ASTNode} node node to validate
		 * @returns {void}
		 * @private
		 */
		function checkFunction(node) {
			const scope = sourceCode.getScope(node);
			const regExpVar = astUtils.getVariableByName(scope, "RegExp");
			const shadowed = regExpVar && regExpVar.defs.length > 0;
			const patternNode = node.arguments[0];

			if (
				node.callee.type === "Identifier" &&
				node.callee.name === "RegExp" &&
				isString(patternNode) &&
				!shadowed
			) {
				const pattern = patternNode.value;
				const rawPattern = patternNode.raw.slice(1, -1);
				const rawPatternStartRange = patternNode.range[0] + 1;
				let flags;

				if (node.arguments.length < 2) {
					// It has no flags.
					flags = "";
				} else {
					const flagsNode = node.arguments[1];

					if (isString(flagsNode)) {
						flags = flagsNode.value;
					} else {
						// The flags cannot be determined.
						return;
					}
				}

				checkRegex(
					node,
					pattern,
					rawPattern,
					rawPatternStartRange,
					flags,
				);
			}
		}

		return {
			Literal: checkLiteral,
			CallExpression: checkFunction,
			NewExpression: checkFunction,
		};
	},
};

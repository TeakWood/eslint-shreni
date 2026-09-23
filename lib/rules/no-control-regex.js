/**
 * @fileoverview Rule to forbid control characters from regular expressions.
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const RegExpValidator = require("@eslint-community/regexpp").RegExpValidator;

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * A regex pattern and the flags it is evaluated under.
 * @typedef {Object} RegExpInfo
 * @property {string} pattern The pattern source.
 * @property {string | null} flags The flags, or `null` when they cannot be determined.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const collector = new (class {
	constructor() {
		this._source = "";

		/** @type {Array<string>} */
		this._controlChars = [];

		this._validator = new RegExpValidator(this);
	}

	/**
	 * Resets the collected control characters when a pattern is entered.
	 * @returns {void} No return value.
	 */
	onPatternEnter() {
		/*
		 * `RegExpValidator` may parse the pattern twice in one `validatePattern`.
		 * So `this._controlChars` should be cleared here as well.
		 *
		 * For example, the `/(?<a>\x1f)/` regex will parse the pattern twice.
		 * This is based on the content described in Annex B.
		 * If the regex contains a `GroupName` and the `u` flag is not used, `ParseText` will be called twice.
		 * See https://tc39.es/ecma262/2023/multipage/additional-ecmascript-features-for-web-browsers.html#sec-parsepattern-annexb
		 */
		this._controlChars = [];
	}

	/**
	 * Collects the character if it is a control character written literally or as an escape.
	 * @param {number} start The start offset of the character in the pattern.
	 * @param {number} end The end offset of the character in the pattern.
	 * @param {number} cp The code point of the character.
	 * @returns {void} No return value.
	 */
	onCharacter(start, end, cp) {
		if (
			cp >= 0x00 &&
			cp <= 0x1f &&
			(this._source.codePointAt(start) === cp ||
				this._source.slice(start, end).startsWith("\\x") ||
				this._source.slice(start, end).startsWith("\\u"))
		) {
			this._controlChars.push(`\\x${`0${cp.toString(16)}`.slice(-2)}`);
		}
	}

	/**
	 * Collects the control characters used in the given pattern.
	 * @param {string} regexpStr The pattern source to inspect.
	 * @param {string | null} flags The flags the pattern is evaluated under, or `null` when they cannot be determined.
	 * @returns {Array<string>} The control characters found, each as a `\xNN` escape.
	 */
	collectControlChars(regexpStr, flags) {
		const uFlag = typeof flags === "string" && flags.includes("u");
		const vFlag = typeof flags === "string" && flags.includes("v");

		this._controlChars = [];
		this._source = regexpStr;

		try {
			this._validator.validatePattern(regexpStr, void 0, void 0, {
				unicode: uFlag,
				unicodeSets: vFlag,
			}); // Call onCharacter hook
		} catch {
			// Ignore syntax errors in RegExp.
		}
		return this._controlChars;
	}
})();

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow control characters in regular expressions",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-control-regex",
		},

		schema: [],

		messages: {
			unexpected:
				"Unexpected control character(s) in regular expression: {{controlChars}}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Get the regex expression
		 * @param {ASTNode} node `Literal` node to evaluate
		 * @returns {RegExpInfo | null} Regex if found (the given node is either a regex literal
		 * or a string literal that is the pattern argument of a RegExp constructor call). Otherwise `null`. If flags cannot be determined,
		 * the `flags` property will be `null`.
		 * @private
		 */
		function getRegExp(node) {
			if (node.regex) {
				return node.regex;
			}
			if (
				typeof node.value === "string" &&
				(node.parent.type === "NewExpression" ||
					node.parent.type === "CallExpression") &&
				node.parent.callee.type === "Identifier" &&
				node.parent.callee.name === "RegExp" &&
				sourceCode.isGlobalReference(node.parent.callee) &&
				node.parent.arguments[0] === node
			) {
				const pattern = node.value;
				const flags =
					node.parent.arguments.length > 1 &&
					node.parent.arguments[1].type === "Literal" &&
					typeof node.parent.arguments[1].value === "string"
						? node.parent.arguments[1].value
						: null;

				return { pattern, flags };
			}

			return null;
		}

		return {
			/**
			 * Reports the literal if its pattern contains control characters.
			 * @param {ASTNode} node The `Literal` node to check.
			 * @returns {void} No return value.
			 */
			Literal(node) {
				const regExp = getRegExp(node);

				if (regExp) {
					const { pattern, flags } = regExp;
					const controlCharacters = collector.collectControlChars(
						pattern,
						flags,
					);

					if (controlCharacters.length > 0) {
						context.report({
							node,
							messageId: "unexpected",
							data: {
								controlChars: controlCharacters.join(", "),
							},
						});
					}
				}
			},
		};
	},
};

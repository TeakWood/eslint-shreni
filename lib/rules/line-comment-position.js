/**
 * @fileoverview Rule to enforce the position of line comments
 * @author Alberto Rodríguez
 * @deprecated in ESLint v9.3.0
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		deprecated: {
			message: "Formatting rules are being moved out of ESLint core.",
			url: "https://eslint.org/blog/2023/10/deprecating-formatting-rules/",
			deprecatedSince: "9.3.0",
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
						name: "line-comment-position",
						url: "https://eslint.style/rules/line-comment-position",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce position of line comments",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/line-comment-position",
		},

		schema: [
			{
				oneOf: [
					{
						enum: ["above", "beside"],
					},
					{
						type: "object",
						properties: {
							position: {
								enum: ["above", "beside"],
							},
							ignorePattern: {
								type: "string",
							},
							applyDefaultPatterns: {
								type: "boolean",
							},
							applyDefaultIgnorePatterns: {
								type: "boolean",
							},
						},
						additionalProperties: false,
					},
				],
			},
		],
		messages: {
			above: "Expected comment to be above code.",
			beside: "Expected comment to be beside code.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const options = context.options[0];

		/** @type {string|undefined} */
		let ignorePattern;

		let above,
			applyDefaultIgnorePatterns = true;

		if (!options || typeof options === "string") {
			above = !options || options === "above";
		} else {
			above = !options.position || options.position === "above";
			ignorePattern = options.ignorePattern;

			if (Object.hasOwn(options, "applyDefaultIgnorePatterns")) {
				applyDefaultIgnorePatterns = options.applyDefaultIgnorePatterns;
			} else {
				applyDefaultIgnorePatterns =
					options.applyDefaultPatterns !== false;
			}
		}

		const defaultIgnoreRegExp = astUtils.COMMENTS_IGNORE_PATTERN;
		const fallThroughRegExp = /^\s*falls?\s?through/u;

		/*
		 * `ignorePattern` is `undefined` unless the option supplied it, and the
		 * resulting empty regex is only ever consulted behind a truthiness check
		 * on the option itself.
		 */
		const ignorePatternSource = /** @type {string} */ (ignorePattern);
		const customIgnoreRegExp = new RegExp(ignorePatternSource, "u");
		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks the position of every line comment in the file.
			 * @returns {void}
			 */
			Program() {
				const comments = sourceCode.getAllComments();

				comments
					.filter(token => token.type === "Line")
					.forEach(node => {
						if (
							applyDefaultIgnorePatterns &&
							(defaultIgnoreRegExp.test(node.value) ||
								fallThroughRegExp.test(node.value))
						) {
							return;
						}

						if (
							ignorePattern &&
							customIgnoreRegExp.test(node.value)
						) {
							return;
						}

						const previous = sourceCode.getTokenBefore(node, {
							includeComments: true,
						});
						const isOnSameLine =
							previous &&
							previous.loc.end.line === node.loc.start.line;

						if (above) {
							if (isOnSameLine) {
								context.report({
									node,
									messageId: "above",
								});
							}
						} else {
							if (!isOnSameLine) {
								context.report({
									node,
									messageId: "beside",
								});
							}
						}
					});
			},
		};
	},
};

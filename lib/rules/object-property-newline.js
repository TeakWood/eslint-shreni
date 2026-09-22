/**
 * @fileoverview Rule to enforce placing object properties on separate lines.
 * @author Vitor Balocco
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
						name: "object-property-newline",
						url: "https://eslint.style/rules/object-property-newline",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce placing object properties on separate lines",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/object-property-newline",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowAllPropertiesOnSameLine: {
						type: "boolean",
						default: false,
					},
					allowMultiplePropertiesPerLine: {
						// Deprecated
						type: "boolean",
						default: false,
					},
				},
				additionalProperties: false,
			},
		],

		fixable: "whitespace",

		messages: {
			propertiesOnNewlineAll:
				"Object properties must go on a new line if they aren't all on the same line.",
			propertiesOnNewline: "Object properties must go on a new line.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const allowSameLine =
			context.options[0] &&
			(context.options[0].allowAllPropertiesOnSameLine ||
				context.options[0]
					.allowMultiplePropertiesPerLine); /* Deprecated */
		const messageId = allowSameLine
			? "propertiesOnNewlineAll"
			: "propertiesOnNewline";

		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports properties that share a line with the previous property.
			 * @param {ASTNode} node The `ObjectExpression` node.
			 * @returns {void}
			 */
			ObjectExpression(node) {
				if (allowSameLine) {
					if (node.properties.length > 1) {
						/*
						 * Every property spans at least one token, so the
						 * first and last token of one always exist.
						 */
						const firstTokenOfFirstProperty = /** @type {Token} */ (
							sourceCode.getFirstToken(node.properties[0])
						);
						const lastTokenOfLastProperty = /** @type {Token} */ (
							sourceCode.getLastToken(node.properties.at(-1))
						);

						if (
							firstTokenOfFirstProperty.loc.end.line ===
							lastTokenOfLastProperty.loc.start.line
						) {
							// All keys and values are on the same line
							return;
						}
					}
				}

				for (let i = 1; i < node.properties.length; i++) {
					// As above, each property spans at least one token.
					const lastTokenOfPreviousProperty = /** @type {Token} */ (
						sourceCode.getLastToken(node.properties[i - 1])
					);
					const firstTokenOfCurrentProperty = /** @type {Token} */ (
						sourceCode.getFirstToken(node.properties[i])
					);

					if (
						lastTokenOfPreviousProperty.loc.end.line ===
						firstTokenOfCurrentProperty.loc.start.line
					) {
						context.report({
							node,
							loc: firstTokenOfCurrentProperty.loc,
							messageId,
							/**
							 * Moves the property onto its own line.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo|null} The fix, or `null` when applying it would delete a comment.
							 */
							fix(fixer) {
								/*
								 * This property is not the first one, so the
								 * comma separating it from the previous one
								 * precedes its first token.
								 */
								const comma = /** @type {Token} */ (
									sourceCode.getTokenBefore(
										firstTokenOfCurrentProperty,
									)
								);
								const rangeAfterComma =
									/** @type {[number, number]} */ ([
										comma.range[1],
										firstTokenOfCurrentProperty.range[0],
									]);

								// Don't perform a fix if there are any comments between the comma and the next property.
								if (
									sourceCode.text
										.slice(
											rangeAfterComma[0],
											rangeAfterComma[1],
										)
										.trim()
								) {
									return null;
								}

								return fixer.replaceTextRange(
									rangeAfterComma,
									"\n",
								);
							},
						});
					}
				}
			},
		};
	},
};

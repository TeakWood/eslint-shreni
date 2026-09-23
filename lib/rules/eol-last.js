/**
 * @fileoverview Require or disallow newline at the end of files
 * @author Nodeca Team <https://github.com/nodeca>
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

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
						name: "eol-last",
						url: "https://eslint.style/rules/eol-last",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Require or disallow newline at the end of files",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/eol-last",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["always", "never", "unix", "windows"],
			},
		],

		messages: {
			missing: "Newline required at end of file but not found.",
			unexpected: "Newline not allowed at end of file.",
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
			 * Checks whether the file ends with a newline as configured.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			Program: function checkBadEOF(node) {
				const sourceCode = context.sourceCode,
					src = sourceCode.getText(),
					// `SourceCode` splits the text on line breaks, so `lines` always has at least one element.
					lastLine = /** @type {string} */ (sourceCode.lines.at(-1)),
					location = {
						column: lastLine.length,
						line: sourceCode.lines.length,
					},
					LF = "\n",
					CRLF = `\r${LF}`,
					endsWithNewline = src.endsWith(LF);

				/*
				 * Empty source is always valid: No content in file so we don't
				 * need to lint for a newline on the last line of content.
				 */
				if (!src.length) {
					return;
				}

				let mode = context.options[0] || "always",
					appendCRLF = false;

				if (mode === "unix") {
					// `"unix"` should behave exactly as `"always"`
					mode = "always";
				}
				if (mode === "windows") {
					// `"windows"` should behave exactly as `"always"`, but append CRLF in the fixer for backwards compatibility
					mode = "always";
					appendCRLF = true;
				}
				if (mode === "always" && !endsWithNewline) {
					// File is not newline-terminated, but should be
					context.report({
						node,
						loc: location,
						messageId: "missing",
						/**
						 * Appends the missing newline to the end of the file.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The edit that appends the newline.
						 */
						fix(fixer) {
							return fixer.insertTextAfterRange(
								[0, src.length],
								appendCRLF ? CRLF : LF,
							);
						},
					});
				} else if (mode === "never" && endsWithNewline) {
					// The source is non-empty and ends with a newline, so it was split into at least two lines.
					const secondLastLine = /** @type {string} */ (
						sourceCode.lines.at(-2)
					);

					// File is newline-terminated, but shouldn't be
					context.report({
						node,
						loc: {
							start: {
								line: sourceCode.lines.length - 1,
								column: secondLastLine.length,
							},
							end: { line: sourceCode.lines.length, column: 0 },
						},
						messageId: "unexpected",
						/**
						 * Removes the trailing newlines from the end of the file.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {EditInfo} The edit that removes the newlines.
						 */
						fix(fixer) {
							const finalEOLs = /(?:\r?\n)+$/u,
								// This fixer only runs when the source ends with a newline, so the pattern always matches.
								match = /** @type {RegExpExecArray} */ (
									finalEOLs.exec(sourceCode.text)
								),
								start = match.index,
								end = sourceCode.text.length;

							return fixer.replaceTextRange([start, end], "");
						},
					});
				}
			},
		};
	},
};

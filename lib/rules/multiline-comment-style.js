/**
 * @fileoverview enforce a particular style for multiline comments
 * @author Teddy Katz
 * @deprecated in ESLint v9.3.0
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").Comment} Comment */
/** @typedef {import("../shared/types.js").Range} Range */
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
						name: "multiline-comment-style",
						url: "https://eslint.style/rules/multiline-comment-style",
					},
				},
			],
		},
		type: "suggestion",
		docs: {
			description: "Enforce a particular style for multiline comments",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/multiline-comment-style",
		},

		fixable: "whitespace",
		schema: {
			anyOf: [
				{
					type: "array",
					items: [
						{
							enum: ["starred-block", "bare-block"],
						},
					],
					additionalItems: false,
				},
				{
					type: "array",
					items: [
						{
							enum: ["separate-lines"],
						},
						{
							type: "object",
							properties: {
								checkJSDoc: {
									type: "boolean",
								},
							},
							additionalProperties: false,
						},
					],
					additionalItems: false,
				},
			],
		},
		messages: {
			expectedBlock:
				"Expected a block comment instead of consecutive line comments.",
			expectedBareBlock:
				"Expected a block comment without padding stars.",
			startNewline: "Expected a linebreak after '/*'.",
			endNewline: "Expected a linebreak before '*/'.",
			missingStar: "Expected a '*' at the start of this line.",
			alignment:
				"Expected this line to be aligned with the start of the comment.",
			expectedLines:
				"Expected multiple line comments instead of a block comment.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const option = context.options[0] || "starred-block";
		const params = context.options[1] || {};
		const checkJSDoc = !!params.checkJSDoc;

		//----------------------------------------------------------------------
		// Helpers
		//----------------------------------------------------------------------

		/**
		 * Checks if a comment line is starred.
		 * @param {string} line A string representing a comment line.
		 * @returns {boolean} Whether or not the comment line is starred.
		 */
		function isStarredCommentLine(line) {
			return /^\s*\*/u.test(line);
		}

		/**
		 * Checks if a comment group is in starred-block form.
		 * @param {Array<Comment>} commentGroup A group of comments, containing either multiple line comments or a single block comment.
		 * @returns {boolean} Whether or not the comment group is in starred block form.
		 */
		function isStarredBlockComment([firstComment]) {
			if (firstComment.type !== "Block") {
				return false;
			}

			const lines = firstComment.value.split(astUtils.LINEBREAK_MATCHER);

			// The first and last lines can only contain whitespace.
			return (
				lines.length > 0 &&
				lines.every((line, i) =>
					(i === 0 || i === lines.length - 1
						? /^\s*$/u
						: /^\s*\*/u
					).test(line),
				)
			);
		}

		/**
		 * Checks if a comment group is in JSDoc form.
		 * @param {Array<Comment>} commentGroup A group of comments, containing either multiple line comments or a single block comment.
		 * @returns {boolean} Whether or not the comment group is in JSDoc form.
		 */
		function isJSDocComment([firstComment]) {
			if (firstComment.type !== "Block") {
				return false;
			}

			const lines = firstComment.value.split(astUtils.LINEBREAK_MATCHER);

			// `String#split()` always yields at least one element.
			const lastLine = /** @type {string} */ (lines.at(-1));

			return (
				/^\*\s*$/u.test(lines[0]) &&
				lines.slice(1, -1).every(line => /^\s* /u.test(line)) &&
				/^\s*$/u.test(lastLine)
			);
		}

		/**
		 * Processes a comment group that is currently in separate-line form, calculating the offset for each line.
		 * @param {Array<Comment>} commentGroup A group of comments containing multiple line comments.
		 * @returns {Array<string>} An array of the processed lines.
		 */
		function processSeparateLineComments(commentGroup) {
			const allLinesHaveLeadingSpace = commentGroup
				.map(({ value }) => value)
				.filter(line => line.trim().length)
				.every(line => line.startsWith(" "));

			return commentGroup.map(({ value }) =>
				allLinesHaveLeadingSpace ? value.replace(/^ /u, "") : value,
			);
		}

		/**
		 * Processes a comment group that is currently in starred-block form, calculating the offset for each line.
		 * @param {Comment} comment A single block comment token in starred-block form.
		 * @returns {Array<string>} An array of the processed lines.
		 */
		function processStarredBlockComment(comment) {
			const lines = comment.value
				.split(astUtils.LINEBREAK_MATCHER)
				.filter(
					(line, i, linesArr) =>
						!(i === 0 || i === linesArr.length - 1),
				)
				.map(line => line.replace(/^\s*$/u, ""));
			const allLinesHaveLeadingSpace = lines
				.map(line => line.replace(/\s*\*/u, ""))
				.filter(line => line.trim().length)
				.every(line => line.startsWith(" "));

			return lines.map(line =>
				line.replace(
					allLinesHaveLeadingSpace ? /\s*\* ?/u : /\s*\*/u,
					"",
				),
			);
		}

		/**
		 * Processes a comment group that is currently in bare-block form, calculating the offset for each line.
		 * @param {Comment} comment A single block comment token in bare-block form.
		 * @returns {Array<string>} An array of the processed lines.
		 */
		function processBareBlockComment(comment) {
			const lines = comment.value
				.split(astUtils.LINEBREAK_MATCHER)
				.map(line => line.replace(/^\s*$/u, ""));
			const leadingWhitespace = `${sourceCode.text.slice(comment.range[0] - comment.loc.start.column, comment.range[0])}   `;
			let offset = "";

			/*
			 * Calculate the offset of the least indented line and use that as the basis for offsetting all the lines.
			 * The first line should not be checked because it is inline with the opening block comment delimiter.
			 */
			for (const [i, line] of lines.entries()) {
				if (!line.trim().length || i === 0) {
					continue;
				}

				// The pattern is all-optional, so it matches every line.
				const [, lineOffset] = /** @type {RegExpMatchArray} */ (
					line.match(/^(\s*\*?\s*)/u)
				);

				if (lineOffset.length < leadingWhitespace.length) {
					const newOffset = leadingWhitespace.slice(
						lineOffset.length - leadingWhitespace.length,
					);

					if (newOffset.length > offset.length) {
						offset = newOffset;
					}
				}
			}

			return lines.map(line => {
				// The pattern is all-optional, so it matches every line.
				const match = /** @type {RegExpMatchArray} */ (
					line.match(/^(\s*\*?\s*)(.*)/u)
				);
				const [, lineOffset, lineContents] = match;

				if (lineOffset.length > leadingWhitespace.length) {
					return `${lineOffset.slice(leadingWhitespace.length - (offset.length + lineOffset.length))}${lineContents}`;
				}

				if (lineOffset.length < leadingWhitespace.length) {
					return `${lineOffset.slice(leadingWhitespace.length)}${lineContents}`;
				}

				return lineContents;
			});
		}

		/**
		 * Gets a list of comment lines in a group, formatting leading whitespace as necessary.
		 * @param {Array<Comment>} commentGroup A group of comments containing either multiple line comments or a single block comment.
		 * @returns {Array<string>} A list of comment lines.
		 */
		function getCommentLines(commentGroup) {
			const [firstComment] = commentGroup;

			if (firstComment.type === "Line") {
				return processSeparateLineComments(commentGroup);
			}

			if (isStarredBlockComment(commentGroup)) {
				return processStarredBlockComment(firstComment);
			}

			return processBareBlockComment(firstComment);
		}

		/**
		 * Gets the initial offset (whitespace) from the beginning of a line to a given comment token.
		 * @param {Comment} comment The token to check.
		 * @returns {string} The offset from the beginning of a line to the token.
		 */
		function getInitialOffset(comment) {
			return sourceCode.text.slice(
				comment.range[0] - comment.loc.start.column,
				comment.range[0],
			);
		}

		/**
		 * Converts a comment into starred-block form
		 * @param {Comment} firstComment The first comment of the group being converted
		 * @param {Array<string>} commentLinesList A list of lines to appear in the new starred-block comment
		 * @returns {string} A representation of the comment value in starred-block form, excluding start and end markers
		 */
		function convertToStarredBlock(firstComment, commentLinesList) {
			const initialOffset = getInitialOffset(firstComment);

			return `/*\n${commentLinesList.map(line => `${initialOffset} * ${line}`).join("\n")}\n${initialOffset} */`;
		}

		/**
		 * Converts a comment into separate-line form
		 * @param {Comment} firstComment The first comment of the group being converted
		 * @param {Array<string>} commentLinesList A list of lines to appear in the new starred-block comment
		 * @returns {string} A representation of the comment value in separate-line form
		 */
		function convertToSeparateLines(firstComment, commentLinesList) {
			return commentLinesList
				.map(line => `// ${line}`)
				.join(`\n${getInitialOffset(firstComment)}`);
		}

		/**
		 * Converts a comment into bare-block form
		 * @param {Comment} firstComment The first comment of the group being converted
		 * @param {Array<string>} commentLinesList A list of lines to appear in the new starred-block comment
		 * @returns {string} A representation of the comment value in bare-block form
		 */
		function convertToBlock(firstComment, commentLinesList) {
			return `/* ${commentLinesList.join(`\n${getInitialOffset(firstComment)}   `)} */`;
		}

		/**
		 * Each method checks a group of comments to see if it's valid according to the given option.
		 * A group is a list of comments that appear together, containing either a single block comment
		 * or multiple line comments.
		 * @type {Record<string, (commentGroup: Array<Comment>) => void>}
		 */
		const commentGroupCheckers = {
			/**
			 * Checks a comment group against the `starred-block` option.
			 * @param {Array<Comment>} commentGroup The group of comments to check.
			 * @returns {void}
			 */
			"starred-block"(commentGroup) {
				const [firstComment] = commentGroup;
				const commentLines = getCommentLines(commentGroup);

				if (commentLines.some(value => value.includes("*/"))) {
					return;
				}

				if (commentGroup.length > 1) {
					context.report({
						loc: {
							start: firstComment.loc.start,
							end: /** @type {Comment} */ (commentGroup.at(-1))
								.loc.end,
						},
						messageId: "expectedBlock",

						/**
						 * Replaces the consecutive line comments with one starred block comment.
						 * @param {RuleFixer} fixer The fixer.
						 * @returns {EditInfo | null} The fix, or `null` when the comment text cannot be moved safely.
						 */
						fix(fixer) {
							const lastComment = /** @type {Comment} */ (
								commentGroup.at(-1)
							);
							const range = /** @type {Range} */ ([
								firstComment.range[0],
								lastComment.range[1],
							]);

							return commentLines.some(value =>
								value.startsWith("/"),
							)
								? null
								: fixer.replaceTextRange(
										range,
										convertToStarredBlock(
											firstComment,
											commentLines,
										),
									);
						},
					});
				} else {
					const lines = firstComment.value.split(
						astUtils.LINEBREAK_MATCHER,
					);
					// `String#split()` always yields at least one element.
					const lastLine = /** @type {string} */ (lines.at(-1));
					const expectedLeadingWhitespace =
						getInitialOffset(firstComment);
					const expectedLinePrefix = `${expectedLeadingWhitespace} *`;

					if (!/^\*?\s*$/u.test(lines[0])) {
						const start = firstComment.value.startsWith("*")
							? firstComment.range[0] + 1
							: firstComment.range[0];

						context.report({
							loc: {
								start: firstComment.loc.start,
								end: {
									line: firstComment.loc.start.line,
									column: firstComment.loc.start.column + 2,
								},
							},
							messageId: "startNewline",

							/**
							 * Inserts the missing linebreak after the opening delimiter.
							 * @param {RuleFixer} fixer The fixer.
							 * @returns {EditInfo} The fix.
							 */
							fix: fixer =>
								fixer.insertTextAfterRange(
									[start, start + 2],
									`\n${expectedLinePrefix}`,
								),
						});
					}

					if (!/^\s*$/u.test(lastLine)) {
						context.report({
							loc: {
								start: {
									line: firstComment.loc.end.line,
									column: firstComment.loc.end.column - 2,
								},
								end: firstComment.loc.end,
							},
							messageId: "endNewline",

							/**
							 * Inserts the missing linebreak before the closing delimiter.
							 * @param {RuleFixer} fixer The fixer.
							 * @returns {EditInfo} The fix.
							 */
							fix: fixer =>
								fixer.replaceTextRange(
									[
										firstComment.range[1] - 2,
										firstComment.range[1],
									],
									`\n${expectedLinePrefix}/`,
								),
						});
					}

					for (
						let lineNumber = firstComment.loc.start.line + 1;
						lineNumber <= firstComment.loc.end.line;
						lineNumber++
					) {
						const lineText = sourceCode.lines[lineNumber - 1];
						const errorType = isStarredCommentLine(lineText)
							? "alignment"
							: "missingStar";

						if (!lineText.startsWith(expectedLinePrefix)) {
							context.report({
								loc: {
									start: { line: lineNumber, column: 0 },
									end: {
										line: lineNumber,
										column: lineText.length,
									},
								},
								messageId: errorType,

								/**
								 * Rewrites the line's prefix so it lines up with the expected one.
								 * @param {RuleFixer} fixer The fixer.
								 * @returns {EditInfo} The fix.
								 */
								fix(fixer) {
									const lineStartIndex =
										sourceCode.getIndexFromLoc({
											line: lineNumber,
											column: 0,
										});

									if (errorType === "alignment") {
										const [, commentTextPrefix = ""] =
											lineText.match(/^(\s*\*)/u) || [];
										const commentTextStartIndex =
											lineStartIndex +
											commentTextPrefix.length;

										return fixer.replaceTextRange(
											[
												lineStartIndex,
												commentTextStartIndex,
											],
											expectedLinePrefix,
										);
									}

									const [, commentTextPrefix = ""] =
										lineText.match(/^(\s*)/u) || [];
									const commentTextStartIndex =
										lineStartIndex +
										commentTextPrefix.length;
									let offset;

									for (const [idx, line] of lines.entries()) {
										if (!/\S+/u.test(line)) {
											continue;
										}

										const lineTextToAlignWith =
											sourceCode.lines[
												firstComment.loc.start.line -
													1 +
													idx
											];
										const [
											,
											prefix = "",
											initialOffset = "",
										] =
											lineTextToAlignWith.match(
												/^(\s*(?:\/?\*)?(\s*))/u,
											) || [];

										offset = `${commentTextPrefix.slice(prefix.length)}${initialOffset}`;

										if (
											/^\s*\//u.test(lineText) &&
											offset.length === 0
										) {
											offset += " ";
										}
										break;
									}

									return fixer.replaceTextRange(
										[lineStartIndex, commentTextStartIndex],
										`${expectedLinePrefix}${offset}`,
									);
								},
							});
						}
					}
				}
			},
			/**
			 * Checks a comment group against the `separate-lines` option.
			 * @param {Array<Comment>} commentGroup The group of comments to check.
			 * @returns {void}
			 */
			"separate-lines"(commentGroup) {
				const [firstComment] = commentGroup;

				const isJSDoc = isJSDocComment(commentGroup);

				if (firstComment.type !== "Block" || (!checkJSDoc && isJSDoc)) {
					return;
				}

				let commentLines = getCommentLines(commentGroup);

				if (isJSDoc) {
					commentLines = commentLines.slice(
						1,
						commentLines.length - 1,
					);
				}

				const tokenAfter = sourceCode.getTokenAfter(firstComment, {
					includeComments: true,
				});

				if (
					tokenAfter &&
					firstComment.loc.end.line === tokenAfter.loc.start.line
				) {
					return;
				}

				context.report({
					loc: {
						start: firstComment.loc.start,
						end: {
							line: firstComment.loc.start.line,
							column: firstComment.loc.start.column + 2,
						},
					},
					messageId: "expectedLines",

					/**
					 * Replaces the block comment with consecutive line comments.
					 * @param {RuleFixer} fixer The fixer.
					 * @returns {EditInfo} The fix.
					 */
					fix(fixer) {
						return fixer.replaceText(
							firstComment,
							convertToSeparateLines(firstComment, commentLines),
						);
					},
				});
			},
			/**
			 * Checks a comment group against the `bare-block` option.
			 * @param {Array<Comment>} commentGroup The group of comments to check.
			 * @returns {void}
			 */
			"bare-block"(commentGroup) {
				if (isJSDocComment(commentGroup)) {
					return;
				}

				const [firstComment] = commentGroup;
				const commentLines = getCommentLines(commentGroup);

				// Disallows consecutive line comments in favor of using a block comment.
				if (
					firstComment.type === "Line" &&
					commentLines.length > 1 &&
					!commentLines.some(value => value.includes("*/"))
				) {
					const lastComment = /** @type {Comment} */ (
						commentGroup.at(-1)
					);

					context.report({
						loc: {
							start: firstComment.loc.start,
							end: lastComment.loc.end,
						},
						messageId: "expectedBlock",

						/**
						 * Replaces the consecutive line comments with one bare block comment.
						 * @param {RuleFixer} fixer The fixer.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.replaceTextRange(
								[firstComment.range[0], lastComment.range[1]],
								convertToBlock(firstComment, commentLines),
							);
						},
					});
				}

				// Prohibits block comments from having a * at the beginning of each line.
				if (isStarredBlockComment(commentGroup)) {
					context.report({
						loc: {
							start: firstComment.loc.start,
							end: {
								line: firstComment.loc.start.line,
								column: firstComment.loc.start.column + 2,
							},
						},
						messageId: "expectedBareBlock",

						/**
						 * Strips the padding stars from the block comment.
						 * @param {RuleFixer} fixer The fixer.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.replaceText(
								firstComment,
								convertToBlock(firstComment, commentLines),
							);
						},
					});
				}
			},
		};

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------

		return {
			/**
			 * Groups the file's comments and checks each group against the configured option.
			 * @returns {void}
			 */
			Program() {
				return sourceCode
					.getAllComments()
					.filter(comment => comment.type !== "Shebang")
					.filter(
						comment =>
							!astUtils.COMMENTS_IGNORE_PATTERN.test(
								comment.value,
							),
					)
					.filter(comment => {
						const tokenBefore = sourceCode.getTokenBefore(comment, {
							includeComments: true,
						});

						return (
							!tokenBefore ||
							tokenBefore.loc.end.line < comment.loc.start.line
						);
					})
					.reduce(
						/**
						 * Adds a comment to the preceding group, or starts a new group.
						 * @param {Array<Array<Comment>>} commentGroups The groups built so far.
						 * @param {Comment} comment The comment being placed.
						 * @param {number} index The index of the comment in the list.
						 * @param {Array<Comment>} commentList The full list of comments.
						 * @returns {Array<Array<Comment>>} The updated groups.
						 */
						(commentGroups, comment, index, commentList) => {
							const tokenBefore = sourceCode.getTokenBefore(
								comment,
								{
									includeComments: true,
								},
							);

							if (
								comment.type === "Line" &&
								index &&
								commentList[index - 1].type === "Line" &&
								tokenBefore &&
								tokenBefore.loc.end.line ===
									comment.loc.start.line - 1 &&
								tokenBefore === commentList[index - 1]
							) {
								/*
								 * The first comment always takes the `else`
								 * branch, so a group exists by the time this
								 * branch can run.
								 */
								const lastGroup =
									/** @type {Array<Comment>} */ (
										commentGroups.at(-1)
									);

								lastGroup.push(comment);
							} else {
								commentGroups.push([comment]);
							}

							return commentGroups;
						},
						[],
					)
					.filter(
						commentGroup =>
							!(
								commentGroup.length === 1 &&
								commentGroup[0].loc.start.line ===
									commentGroup[0].loc.end.line
							),
					)
					.forEach(commentGroupCheckers[option]);
			},
		};
	},
};

/**
 * @fileoverview Disallow mixed spaces and tabs for indentation
 * @author Jary Niebur
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
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
						name: "no-mixed-spaces-and-tabs",
						url: "https://eslint.style/rules/no-mixed-spaces-and-tabs",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Disallow mixed spaces and tabs for indentation",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-mixed-spaces-and-tabs",
		},

		schema: [
			{
				enum: ["smart-tabs", true, false],
			},
		],

		messages: {
			mixedSpacesAndTabs: "Mixed spaces and tabs.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		let smartTabs;

		switch (context.options[0]) {
			case true: // Support old syntax, maybe add deprecation warning here
			case "smart-tabs":
				smartTabs = true;
				break;
			default:
				smartTabs = false;
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Reports every line whose indentation mixes spaces and tabs.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const lines = sourceCode.lines,
					comments = sourceCode.getAllComments(),
					/** @type {Set<number>} */
					ignoredCommentLines = new Set();

				// Add all lines except the first ones.
				comments.forEach(comment => {
					for (
						let i = comment.loc.start.line + 1;
						i <= comment.loc.end.line;
						i++
					) {
						ignoredCommentLines.add(i);
					}
				});

				/*
				 * At least one space followed by a tab
				 * or the reverse before non-tab/-space
				 * characters begin.
				 */
				let regex = /^(?=( +|\t+))\1(?:\t| )/u;

				if (smartTabs) {
					/*
					 * At least one space followed by a tab
					 * before non-tab/-space characters begin.
					 */
					// eslint-disable-next-line regexp/no-empty-lookarounds-assertion -- False positive
					regex = /^(?=(\t*))\1(?=( +))\2\t/u;
				}

				lines.forEach((line, i) => {
					const match = regex.exec(line);

					if (match) {
						const lineNumber = i + 1;
						const loc = {
							start: {
								line: lineNumber,
								column: match[0].length - 2,
							},
							end: {
								line: lineNumber,
								column: match[0].length,
							},
						};

						if (!ignoredCommentLines.has(lineNumber)) {
							const containingNode =
								sourceCode.getNodeByRangeIndex(
									sourceCode.getIndexFromLoc(loc.start),
								);

							if (!(
								containingNode &&
								["Literal", "TemplateElement"].includes(
									containingNode.type,
								)
							)) {
								context.report({
									node,
									loc,
									messageId: "mixedSpacesAndTabs",
								});
							}
						}
					}
				});
			},
		};
	},
};

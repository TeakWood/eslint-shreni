/**
 * @fileoverview A rule to ensure blank lines within blocks.
 * @author Mathias Schreck <https://github.com/lo1tuma>
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
						name: "padded-blocks",
						url: "https://eslint.style/rules/padded-blocks",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Require or disallow padding within blocks",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/padded-blocks",
		},

		fixable: "whitespace",

		schema: [
			{
				oneOf: [
					{
						enum: ["always", "never"],
					},
					{
						type: "object",
						properties: {
							blocks: {
								enum: ["always", "never"],
							},
							switches: {
								enum: ["always", "never"],
							},
							classes: {
								enum: ["always", "never"],
							},
						},
						additionalProperties: false,
						minProperties: 1,
					},
				],
			},
			{
				type: "object",
				properties: {
					allowSingleLineBlocks: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			alwaysPadBlock: "Block must be padded by blank lines.",
			neverPadBlock: "Block must not be padded by blank lines.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/*
		 * Keyed by option name, because `requirePaddingFor()` picks the entry
		 * from the node type and the rule tests for presence with
		 * `Object.hasOwn()` rather than declaring every key up front.
		 */
		/** @type {Record<string, boolean>} */
		const options = {};
		const typeOptions = context.options[0] || "always";
		const exceptOptions = context.options[1] || {};

		if (typeof typeOptions === "string") {
			const shouldHavePadding = typeOptions === "always";

			options.blocks = shouldHavePadding;
			options.switches = shouldHavePadding;
			options.classes = shouldHavePadding;
		} else {
			if (Object.hasOwn(typeOptions, "blocks")) {
				options.blocks = typeOptions.blocks === "always";
			}
			if (Object.hasOwn(typeOptions, "switches")) {
				options.switches = typeOptions.switches === "always";
			}
			if (Object.hasOwn(typeOptions, "classes")) {
				options.classes = typeOptions.classes === "always";
			}
		}

		if (Object.hasOwn(exceptOptions, "allowSingleLineBlocks")) {
			options.allowSingleLineBlocks =
				exceptOptions.allowSingleLineBlocks === true;
		}

		const sourceCode = context.sourceCode;

		/**
		 * Gets the open brace token from a given node.
		 *
		 * Each branch is backed by the grammar: a `switch` writes its `{`
		 * before the first case, a static block is `static` `{`, and a block
		 * statement or class body opens with `{`. The `switch` branch is only
		 * reached for a node with at least one case, which the visitor checks.
		 * @param {ASTNode} node A BlockStatement or SwitchStatement node from which to get the open brace.
		 * @returns {Token} The token of the open brace.
		 */
		function getOpenBrace(node) {
			if (node.type === "SwitchStatement") {
				return /** @type {Token} */ (
					sourceCode.getTokenBefore(node.cases[0])
				);
			}

			if (node.type === "StaticBlock") {
				return /** @type {Token} */ (
					sourceCode.getFirstToken(node, { skip: 1 })
				); // skip the `static` token
			}

			// `BlockStatement` or `ClassBody`
			return /** @type {Token} */ (sourceCode.getFirstToken(node));
		}

		/**
		 * Checks if the given parameter is a comment node
		 * @param {Token} node An AST node or token
		 * @returns {boolean} True if node is a comment
		 */
		function isComment(node) {
			return node.type === "Line" || node.type === "Block";
		}

		/**
		 * Checks if there is padding between two tokens
		 * @param {Token} first The first token
		 * @param {Token} second The second token
		 * @returns {boolean} True if there is at least a line between the tokens
		 */
		function isPaddingBetweenTokens(first, second) {
			return second.loc.start.line - first.loc.end.line >= 2;
		}

		/**
		 * Checks if the given token has a blank line after it.
		 * @param {Token} token The token to check.
		 * @returns {Token} Whether or not the token is followed by a blank line.
		 */
		function getFirstBlockToken(token) {
			let prev,
				first = token;

			do {
				prev = first;

				/*
				 * The walk starts at the block's open brace and only continues
				 * while it is sitting on a comment, so the matching close brace
				 * is always still ahead of it.
				 */
				first = /** @type {Token} */ (
					sourceCode.getTokenAfter(first, {
						includeComments: true,
					})
				);
			} while (
				isComment(first) &&
				first.loc.start.line === prev.loc.end.line
			);

			return first;
		}

		/**
		 * Checks if the given token is preceded by a blank line.
		 * @param {Token} token The token to check
		 * @returns {Token} Whether or not the token is preceded by a blank line
		 */
		function getLastBlockToken(token) {
			let last = token,
				next;

			do {
				next = last;

				/*
				 * The walk starts at the block's close brace and only continues
				 * while it is sitting on a comment, so the matching open brace
				 * is always still behind it.
				 */
				last = /** @type {Token} */ (
					sourceCode.getTokenBefore(last, {
						includeComments: true,
					})
				);
			} while (
				isComment(last) &&
				last.loc.end.line === next.loc.start.line
			);

			return last;
		}

		/**
		 * Checks if a node should be padded, according to the rule config.
		 * @param {ASTNode} node The AST node to check.
		 * @throws (Unreachable)
		 * @returns {boolean} True if the node should be padded, false otherwise.
		 */
		function requirePaddingFor(node) {
			switch (node.type) {
				case "BlockStatement":
				case "StaticBlock":
					return options.blocks;
				case "SwitchStatement":
					return options.switches;
				case "ClassBody":
					return options.classes;

				/* c8 ignore next */
				default:
					throw new Error("unreachable");
			}
		}

		/**
		 * Checks the given BlockStatement node to be padded if the block is not empty.
		 *
		 * The three lookups below are cast because the block is delimited: its
		 * open brace precedes `firstBlockToken`, its close brace is its last
		 * token, and that close brace follows `lastBlockToken`.
		 * @param {ASTNode} node The AST node of a BlockStatement.
		 * @returns {void} undefined.
		 */
		function checkPadding(node) {
			const openBrace = getOpenBrace(node),
				firstBlockToken = getFirstBlockToken(openBrace),
				tokenBeforeFirst = /** @type {Token} */ (
					sourceCode.getTokenBefore(firstBlockToken, {
						includeComments: true,
					})
				),
				closeBrace = /** @type {Token} */ (
					sourceCode.getLastToken(node)
				),
				lastBlockToken = getLastBlockToken(closeBrace),
				tokenAfterLast = /** @type {Token} */ (
					sourceCode.getTokenAfter(lastBlockToken, {
						includeComments: true,
					})
				),
				blockHasTopPadding = isPaddingBetweenTokens(
					tokenBeforeFirst,
					firstBlockToken,
				),
				blockHasBottomPadding = isPaddingBetweenTokens(
					lastBlockToken,
					tokenAfterLast,
				);

			if (
				options.allowSingleLineBlocks &&
				astUtils.isTokenOnSameLine(tokenBeforeFirst, tokenAfterLast)
			) {
				return;
			}

			if (requirePaddingFor(node)) {
				if (!blockHasTopPadding) {
					context.report({
						node,
						loc: {
							start: tokenBeforeFirst.loc.start,
							end: firstBlockToken.loc.start,
						},
						/**
						 * Adds the missing blank line at the top of the block.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.insertTextAfter(
								tokenBeforeFirst,
								"\n",
							);
						},
						messageId: "alwaysPadBlock",
					});
				}
				if (!blockHasBottomPadding) {
					context.report({
						node,
						loc: {
							end: tokenAfterLast.loc.start,
							start: lastBlockToken.loc.end,
						},
						/**
						 * Adds the missing blank line at the bottom of the block.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.insertTextBefore(tokenAfterLast, "\n");
						},
						messageId: "alwaysPadBlock",
					});
				}
			} else {
				if (blockHasTopPadding) {
					context.report({
						node,
						loc: {
							start: tokenBeforeFirst.loc.start,
							end: firstBlockToken.loc.start,
						},
						/**
						 * Removes the blank lines at the top of the block.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.replaceTextRange(
								[
									tokenBeforeFirst.range[1],
									firstBlockToken.range[0] -
										firstBlockToken.loc.start.column,
								],
								"\n",
							);
						},
						messageId: "neverPadBlock",
					});
				}

				if (blockHasBottomPadding) {
					context.report({
						node,
						loc: {
							end: tokenAfterLast.loc.start,
							start: lastBlockToken.loc.end,
						},
						messageId: "neverPadBlock",
						/**
						 * Removes the blank lines at the bottom of the block.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo} The fix.
						 */
						fix(fixer) {
							return fixer.replaceTextRange(
								[
									lastBlockToken.range[1],
									tokenAfterLast.range[0] -
										tokenAfterLast.loc.start.column,
								],
								"\n",
							);
						},
					});
				}
			}
		}

		/*
		 * The handlers are attached conditionally, so the object starts empty
		 * and is filled by name below.
		 */
		/** @type {RuleVisitor} */
		const rule = {};

		if (Object.hasOwn(options, "switches")) {
			/**
			 * Checks the padding of a non-empty switch statement.
			 * @param {ASTNode} node The `SwitchStatement` node.
			 * @returns {void}
			 */
			rule.SwitchStatement = function (node) {
				if (node.cases.length === 0) {
					return;
				}
				checkPadding(node);
			};
		}

		if (Object.hasOwn(options, "blocks")) {
			/**
			 * Checks the padding of a non-empty block.
			 * @param {ASTNode} node The `BlockStatement` or `StaticBlock` node.
			 * @returns {void}
			 */
			rule.BlockStatement = function (node) {
				if (node.body.length === 0) {
					return;
				}
				checkPadding(node);
			};
			rule.StaticBlock = rule.BlockStatement;
		}

		if (Object.hasOwn(options, "classes")) {
			/**
			 * Checks the padding of a non-empty class body.
			 * @param {ASTNode} node The `ClassBody` node.
			 * @returns {void}
			 */
			rule.ClassBody = function (node) {
				if (node.body.length === 0) {
					return;
				}
				checkPadding(node);
			};
		}

		return rule;
	},
};

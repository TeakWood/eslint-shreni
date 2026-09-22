/**
 * @fileoverview Rule to enforce location of semicolons.
 * @author Toru Nagashima
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

const SELECTOR = [
	"BreakStatement",
	"ContinueStatement",
	"DebuggerStatement",
	"DoWhileStatement",
	"ExportAllDeclaration",
	"ExportDefaultDeclaration",
	"ExportNamedDeclaration",
	"ExpressionStatement",
	"ImportDeclaration",
	"ReturnStatement",
	"ThrowStatement",
	"VariableDeclaration",
	"PropertyDefinition",
].join(",");

/**
 * Get the child node list of a given node.
 * This returns `BlockStatement#body`, `StaticBlock#body`, `Program#body`,
 * `ClassBody#body`, or `SwitchCase#consequent`.
 * This is used to check whether a node is the first/last child.
 * @param {ASTNode} node A node to get child node list.
 * @returns {Array<ASTNode> | null} The child node list.
 */
function getChildren(node) {
	const t = node.type;

	if (
		t === "BlockStatement" ||
		t === "StaticBlock" ||
		t === "Program" ||
		t === "ClassBody"
	) {
		return node.body;
	}
	if (t === "SwitchCase") {
		return node.consequent;
	}
	return null;
}

/**
 * Check whether a given node is the last statement in the parent block.
 * @param {ASTNode} node A node to check.
 * @returns {boolean} `true` if the node is the last statement in the parent block.
 */
function isLastChild(node) {
	const t = node.parent.type;

	if (
		t === "IfStatement" &&
		node.parent.consequent === node &&
		node.parent.alternate
	) {
		// before `else` keyword.
		return true;
	}
	if (t === "DoWhileStatement") {
		// before `while` keyword.
		return true;
	}
	const nodeList = getChildren(node.parent);

	return nodeList !== null && nodeList.at(-1) === node; // before `}` or etc.
}

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
						name: "semi-style",
						url: "https://eslint.style/rules/semi-style",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce location of semicolons",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/semi-style",
		},

		schema: [{ enum: ["last", "first"] }],
		fixable: "whitespace",

		messages: {
			expectedSemiColon: "Expected this semicolon to be at {{pos}}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const option = context.options[0] || "last";

		/**
		 * Check the given semicolon token.
		 * @param {Token} semiToken The semicolon token to check.
		 * @param {string} expected The expected location to check.
		 * @returns {void}
		 */
		function check(semiToken, expected) {
			const prevToken = sourceCode.getTokenBefore(semiToken);
			const nextToken = sourceCode.getTokenAfter(semiToken);
			const prevIsSameLine =
				!prevToken || astUtils.isTokenOnSameLine(prevToken, semiToken);
			const nextIsSameLine =
				!nextToken || astUtils.isTokenOnSameLine(semiToken, nextToken);

			if (
				(expected === "last" && !prevIsSameLine) ||
				(expected === "first" && !nextIsSameLine)
			) {
				context.report({
					loc: semiToken.loc,
					messageId: "expectedSemiColon",
					data: {
						pos:
							expected === "last"
								? "the end of the previous line"
								: "the beginning of the next line",
					},
					/**
					 * Moves the semicolon to the expected line.
					 * @param {RuleFixer} fixer The fixer to use.
					 * @returns {EditInfo | null} The fix, or `null` when comments make the move unsafe.
					 */
					fix(fixer) {
						if (
							prevToken &&
							nextToken &&
							sourceCode.commentsExistBetween(
								prevToken,
								nextToken,
							)
						) {
							return null;
						}

						const start = prevToken
							? prevToken.range[1]
							: semiToken.range[0];
						const end = nextToken
							? nextToken.range[0]
							: semiToken.range[1];
						const text = expected === "last" ? ";\n" : "\n;";

						return fixer.replaceTextRange([start, end], text);
					},
				});
			}
		}

		return {
			/**
			 * Checks the trailing semicolon of a statement-like node.
			 * @param {ASTNode} node The node to check.
			 * @returns {void}
			 */
			[SELECTOR](node) {
				if (option === "first" && isLastChild(node)) {
					return;
				}

				// Every node `SELECTOR` matches is a statement or declaration, so it always has at least one token.
				const lastToken = /** @type {Token} */ (
					sourceCode.getLastToken(node)
				);

				if (astUtils.isSemicolonToken(lastToken)) {
					check(lastToken, option);
				}
			},

			/**
			 * Checks the two semicolons in a `for` statement's head.
			 * @param {ASTNode} node The `ForStatement` node.
			 * @returns {void}
			 */
			ForStatement(node) {
				const firstSemi =
					node.init &&
					sourceCode.getTokenAfter(
						node.init,
						astUtils.isSemicolonToken,
					);
				const secondSemi =
					node.test &&
					sourceCode.getTokenAfter(
						node.test,
						astUtils.isSemicolonToken,
					);

				if (firstSemi) {
					check(firstSemi, "last");
				}
				if (secondSemi) {
					check(secondSemi, "last");
				}
			},
		};
	},
};

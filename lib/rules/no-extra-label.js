/**
 * @fileoverview Rule to disallow unnecessary labels
 * @author Toru Nagashima
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
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * One entry of the stack of enclosing breakable and labeled statements.
 * @typedef {Object} ScopeInfo
 * @property {ASTNode | null} label The label attached to this statement, if any.
 * @property {boolean} breakable Whether this statement is a breakable statement.
 * @property {ScopeInfo | null} upper The entry for the enclosing statement.
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow unnecessary labels",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-extra-label",
		},

		schema: [],
		fixable: "code",

		messages: {
			unexpected: "This label '{{name}}' is unnecessary.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/** @type {ScopeInfo | null} */
		let scopeInfo = null;

		/**
		 * Creates a new scope with a breakable statement.
		 * @param {ASTNode} node A node to create. This is a BreakableStatement.
		 * @returns {void}
		 */
		function enterBreakableStatement(node) {
			scopeInfo = {
				label:
					node.parent.type === "LabeledStatement"
						? node.parent.label
						: null,
				breakable: true,
				upper: scopeInfo,
			};
		}

		/**
		 * Removes the top scope of the stack.
		 * @returns {void}
		 */
		function exitBreakableStatement() {
			// `:exit` always pairs with the enter that pushed the entry, so the stack is never empty here.
			scopeInfo = /** @type {ScopeInfo} */ (scopeInfo).upper;
		}

		/**
		 * Creates a new scope with a labeled statement.
		 *
		 * This ignores it if the body is a breakable statement.
		 * In this case it's handled in the `enterBreakableStatement` function.
		 * @param {ASTNode} node A node to create. This is a LabeledStatement.
		 * @returns {void}
		 */
		function enterLabeledStatement(node) {
			if (!astUtils.isBreakableStatement(node.body)) {
				scopeInfo = {
					label: node.label,
					breakable: false,
					upper: scopeInfo,
				};
			}
		}

		/**
		 * Removes the top scope of the stack.
		 *
		 * This ignores it if the body is a breakable statement.
		 * In this case it's handled in the `exitBreakableStatement` function.
		 * @param {ASTNode} node A node. This is a LabeledStatement.
		 * @returns {void}
		 */
		function exitLabeledStatement(node) {
			if (!astUtils.isBreakableStatement(node.body)) {
				// Same pairing invariant as above: `enterLabeledStatement` pushed an entry for this node.
				scopeInfo = /** @type {ScopeInfo} */ (scopeInfo).upper;
			}
		}

		/**
		 * Reports a given control node if it's unnecessary.
		 * @param {ASTNode} node A node. This is a BreakStatement or a
		 *      ContinueStatement.
		 * @returns {void}
		 */
		function reportIfUnnecessary(node) {
			if (!node.label) {
				return;
			}

			const labelNode = node.label;

			for (let info = scopeInfo; info !== null; info = info.upper) {
				if (
					info.breakable ||
					(info.label && info.label.name === labelNode.name)
				) {
					if (
						info.breakable &&
						info.label &&
						info.label.name === labelNode.name
					) {
						context.report({
							node: labelNode,
							messageId: "unexpected",
							data: labelNode,
							/**
							 * Removes the unnecessary label from the `break` or `continue`.
							 * @param {RuleFixer} fixer The fixer to build the edit with.
							 * @returns {EditInfo | null} The edit, or `null` when a comment sits between the keyword and the label.
							 */
							fix(fixer) {
								// A `break`/`continue` statement always starts with its keyword token.
								const breakOrContinueToken =
									/** @type {Token} */ (
										sourceCode.getFirstToken(node)
									);

								if (
									sourceCode.commentsExistBetween(
										breakOrContinueToken,
										labelNode,
									)
								) {
									return null;
								}

								return fixer.removeRange([
									breakOrContinueToken.range[1],
									labelNode.range[1],
								]);
							},
						});
					}
					return;
				}
			}
		}

		return {
			WhileStatement: enterBreakableStatement,
			"WhileStatement:exit": exitBreakableStatement,
			DoWhileStatement: enterBreakableStatement,
			"DoWhileStatement:exit": exitBreakableStatement,
			ForStatement: enterBreakableStatement,
			"ForStatement:exit": exitBreakableStatement,
			ForInStatement: enterBreakableStatement,
			"ForInStatement:exit": exitBreakableStatement,
			ForOfStatement: enterBreakableStatement,
			"ForOfStatement:exit": exitBreakableStatement,
			SwitchStatement: enterBreakableStatement,
			"SwitchStatement:exit": exitBreakableStatement,
			LabeledStatement: enterLabeledStatement,
			"LabeledStatement:exit": exitLabeledStatement,
			BreakStatement: reportIfUnnecessary,
			ContinueStatement: reportIfUnnecessary,
		};
	},
};

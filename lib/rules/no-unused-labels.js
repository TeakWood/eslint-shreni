/**
 * @fileoverview Rule to disallow unused labels.
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * One entry of the stack of enclosing labeled statements. `upper` links to the
 * entry for the next label out, so the stack is walked as a linked list.
 * @typedef {Object} ScopeInfo
 * @property {string} label The name of the label.
 * @property {boolean} used Whether a `break` or `continue` referenced the label.
 * @property {ScopeInfo | null} upper The entry for the enclosing labeled statement.
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow unused labels",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-unused-labels",
		},

		schema: [],

		fixable: "code",

		messages: {
			unused: "'{{name}}:' is defined but never used.",
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
		 * Adds a scope info to the stack.
		 * @param {ASTNode} node A node to add. This is a LabeledStatement.
		 * @returns {void}
		 */
		function enterLabeledScope(node) {
			scopeInfo = {
				label: node.label.name,
				used: false,
				upper: scopeInfo,
			};
		}

		/**
		 * Checks if a `LabeledStatement` node is fixable.
		 * For a node to be fixable, there must be no comments between the label and the body.
		 * Furthermore, is must be possible to remove the label without turning the body statement into a
		 * directive after other fixes are applied.
		 * @param {ASTNode} node The node to evaluate.
		 * @returns {boolean} Whether or not the node is fixable.
		 */
		function isFixable(node) {
			/*
			 * Only perform a fix if there are no comments between the label and the body. This will be the case
			 * when there is exactly one token/comment (the ":") between the label and the body.
			 */
			if (
				sourceCode.getTokenAfter(node.label, {
					includeComments: true,
				}) !==
				sourceCode.getTokenBefore(node.body, { includeComments: true })
			) {
				return false;
			}

			// Looking for the node's deepest ancestor which is not a `LabeledStatement`.
			let ancestor = node.parent;

			while (ancestor.type === "LabeledStatement") {
				ancestor = ancestor.parent;
			}

			if (
				ancestor.type === "Program" ||
				(ancestor.type === "BlockStatement" &&
					astUtils.isFunction(ancestor.parent))
			) {
				const { body } = node;

				if (
					body.type === "ExpressionStatement" &&
					((body.expression.type === "Literal" &&
						typeof body.expression.value === "string") ||
						astUtils.isStaticTemplateLiteral(body.expression))
				) {
					return false; // potential directive
				}
			}
			return true;
		}

		/**
		 * Removes the top of the stack.
		 * At the same time, this reports the label if it's never used.
		 * @param {ASTNode} node A node to report. This is a LabeledStatement.
		 * @returns {void}
		 */
		function exitLabeledScope(node) {
			/*
			 * The `LabeledStatement` enter handler always runs before this exit
			 * handler for the same node, so the stack is never empty here.
			 */
			const currentScope = /** @type {ScopeInfo} */ (scopeInfo);

			if (!currentScope.used) {
				context.report({
					node: node.label,
					messageId: "unused",
					data: node.label,
					fix: isFixable(node)
						? (/** @type {RuleFixer} */ fixer) =>
								fixer.removeRange([
									node.range[0],
									node.body.range[0],
								])
						: null,
				});
			}

			scopeInfo = currentScope.upper;
		}

		/**
		 * Marks the label of a given node as used.
		 * @param {ASTNode} node A node to mark. This is a BreakStatement or
		 *      ContinueStatement.
		 * @returns {void}
		 */
		function markAsUsed(node) {
			if (!node.label) {
				return;
			}

			const label = node.label.name;
			let info = scopeInfo;

			while (info) {
				if (info.label === label) {
					info.used = true;
					break;
				}
				info = info.upper;
			}
		}

		return {
			LabeledStatement: enterLabeledScope,
			"LabeledStatement:exit": exitLabeledScope,
			BreakStatement: markAsUsed,
			ContinueStatement: markAsUsed,
		};
	},
};

/**
 * @fileoverview Rule to flag blocks with no reason to exist
 * @author Brandon Mills
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
		type: "suggestion",

		docs: {
			description: "Disallow unnecessary nested blocks",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-lone-blocks",
		},

		schema: [],

		messages: {
			redundantBlock: "Block is redundant.",
			redundantNestedBlock: "Nested block is redundant.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor that reports redundant blocks.
	 */
	create(context) {
		// A stack of lone blocks to be checked for block-level bindings
		/** @type {Array<ASTNode>} */
		const loneBlocks = [];
		/** @type {RuleVisitor} */
		let ruleDef;
		const sourceCode = context.sourceCode;

		/**
		 * Reports a node as invalid.
		 * @param {ASTNode} node The node to be reported.
		 * @returns {void}
		 */
		function report(node) {
			const messageId =
				node.parent.type === "BlockStatement" ||
				node.parent.type === "StaticBlock"
					? "redundantNestedBlock"
					: "redundantBlock";

			context.report({
				node,
				messageId,
			});
		}

		/**
		 * Checks for any occurrence of a BlockStatement in a place where lists of statements can appear
		 * @param {ASTNode} node The node to check
		 * @returns {boolean} True if the node is a lone block.
		 */
		function isLoneBlock(node) {
			return (
				node.parent.type === "BlockStatement" ||
				node.parent.type === "StaticBlock" ||
				node.parent.type === "Program" ||
				// Don't report blocks in switch cases if the block is the only statement of the case.
				(node.parent.type === "SwitchCase" &&
					!(
						node.parent.consequent[0] === node &&
						node.parent.consequent.length === 1
					))
			);
		}

		/**
		 * Checks the enclosing block of the current node for block-level bindings,
		 * and "marks it" as valid if any.
		 * @param {ASTNode} node The current node to check.
		 * @returns {void}
		 */
		function markLoneBlock(node) {
			if (loneBlocks.length === 0) {
				return;
			}

			const block = node.parent;

			if (loneBlocks.at(-1) === block) {
				loneBlocks.pop();
			}
		}

		// Default rule definition: report all lone blocks
		ruleDef = {
			/**
			 * Reports a block statement that has no reason to exist.
			 * @param {ASTNode} node The `BlockStatement` node being visited.
			 * @returns {void}
			 */
			BlockStatement(node) {
				if (isLoneBlock(node)) {
					report(node);
				}
			},
		};

		// ES6: report blocks without block-level bindings, or that's only child of another block
		if (context.languageOptions.ecmaVersion >= 2015) {
			ruleDef = {
				/**
				 * Pushes a candidate lone block onto the stack.
				 * @param {ASTNode} node The `BlockStatement` node being visited.
				 * @returns {void}
				 */
				BlockStatement(node) {
					if (isLoneBlock(node)) {
						loneBlocks.push(node);
					}
				},
				/**
				 * Reports a block that was never marked as holding a block-level binding.
				 * @param {ASTNode} node The `BlockStatement` node being left.
				 * @returns {void}
				 */
				"BlockStatement:exit"(node) {
					if (loneBlocks.length > 0 && loneBlocks.at(-1) === node) {
						loneBlocks.pop();
						report(node);
					} else if (
						(node.parent.type === "BlockStatement" ||
							node.parent.type === "StaticBlock") &&
						node.parent.body.length === 1
					) {
						report(node);
					}
				},
			};

			/**
			 * Marks the enclosing block as valid when it holds a lexical declaration.
			 * @param {ASTNode} node The `VariableDeclaration` node being visited.
			 * @returns {void}
			 */
			ruleDef.VariableDeclaration = function (node) {
				if (node.kind !== "var") {
					markLoneBlock(node);
				}
			};

			/**
			 * Marks the enclosing block as valid when it holds a block-scoped function.
			 * @param {ASTNode} node The `FunctionDeclaration` node being visited.
			 * @returns {void}
			 */
			ruleDef.FunctionDeclaration = function (node) {
				if (sourceCode.getScope(node).isStrict) {
					markLoneBlock(node);
				}
			};

			ruleDef.ClassDeclaration = markLoneBlock;
		}

		return ruleDef;
	},
};

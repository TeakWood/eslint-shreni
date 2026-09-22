/**
 * @fileoverview Rule to flag creation of function inside a loop
 * @author Ilya Volodin
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Reference} Reference */
/** @typedef {import("eslint-scope").Variable} Variable */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const CONSTANT_BINDINGS = new Set(["const", "using", "await using"]);

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — `Reference#identifier` here — as
 * bare ESTree nodes: no `parent`, and `range` and `loc` optional. The linter
 * populates all three before any rule runs, so each of these is the same object
 * a visitor would have received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

/**
 * Identifies is a node is a FunctionExpression which is part of an IIFE
 * @param {ASTNode} node Node to test
 * @returns {boolean} True if it's an IIFE
 */
function isIIFE(node) {
	return (
		(node.type === "FunctionExpression" ||
			node.type === "ArrowFunctionExpression") &&
		node.parent &&
		node.parent.type === "CallExpression" &&
		node.parent.callee === node
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Disallow function declarations that contain unsafe references inside loop statements",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-loop-func",
		},

		schema: [],

		messages: {
			unsafeRefs:
				"Function declared in a loop contains unsafe references to variable(s) {{ varNames }}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor the linter runs against the AST.
	 */
	create(context) {
		/**
		 * The IIFEs that have been cleared, so that the functions nested inside
		 * them are still walked for containing loops.
		 * @type {Set<ASTNode>}
		 */
		const SKIPPED_IIFE_NODES = new Set();
		const sourceCode = context.sourceCode;

		/**
		 * Gets the containing loop node of a specified node.
		 *
		 * We don't need to check nested functions, so this ignores those, with the exception of IIFE.
		 * `Scope.through` contains references of nested functions.
		 * @param {ASTNode} node An AST node to get.
		 * @returns {ASTNode | null} The containing loop node of the specified node, or
		 *      `null`.
		 */
		function getContainingLoopNode(node) {
			for (
				let currentNode = node;
				currentNode.parent;
				currentNode = currentNode.parent
			) {
				const parent = currentNode.parent;

				switch (parent.type) {
					case "WhileStatement":
					case "DoWhileStatement":
						return parent;

					case "ForStatement":
						// `init` is outside of the loop.
						if (parent.init !== currentNode) {
							return parent;
						}
						break;

					case "ForInStatement":
					case "ForOfStatement":
						// `right` is outside of the loop.
						if (parent.right !== currentNode) {
							return parent;
						}
						break;

					case "ArrowFunctionExpression":
					case "FunctionExpression":
					case "FunctionDeclaration":
						// We need to check nested functions only in case of IIFE.
						if (SKIPPED_IIFE_NODES.has(parent)) {
							break;
						}

						return null;
					default:
						break;
				}
			}

			return null;
		}

		/**
		 * Gets the containing loop node of a given node.
		 * If the loop was nested, this returns the most outer loop.
		 * @param {ASTNode} node A node to get. This is a loop node.
		 * @param {ASTNode | null} excludedNode A node that the result node should not
		 *      include.
		 * @returns {ASTNode} The most outer loop node.
		 */
		function getTopLoopNode(node, excludedNode) {
			const border = excludedNode ? excludedNode.range[1] : 0;
			let retv = node;

			/** @type {ASTNode | null} */
			let containingLoopNode = node;

			while (
				containingLoopNode &&
				containingLoopNode.range[0] >= border
			) {
				retv = containingLoopNode;
				containingLoopNode = getContainingLoopNode(containingLoopNode);
			}

			return retv;
		}

		/**
		 * Checks whether a given reference which refers to an upper scope's variable is
		 * safe or not.
		 * @param {ASTNode} loopNode A containing loop node.
		 * @param {Reference} reference A reference to check.
		 * @returns {boolean} `true` if the reference is safe or not.
		 */
		function isSafe(loopNode, reference) {
			// `checkForLoops()` only calls this for references it has already filtered on `r.resolved`, so the reference is resolved.
			const variable = /** @type {Variable} */ (reference.resolved);
			const definition = variable && variable.defs[0];

			/**
			 * The declaration the variable came from, if it has one.
			 *
			 * `eslint-scope` types `Definition#parent` as a bare ESTree node:
			 * no `parent`, and `range` and `loc` optional. The linter populates
			 * all three before any rule runs, so this is the same object a
			 * visitor would have received. It is reinterpreted as always
			 * present because both reads of it below are guarded — the
			 * truthiness test on the next line, and `kind === "let"`, which
			 * only holds when a `VariableDeclaration` produced `kind`.
			 */
			const declaration = /** @type {ASTNode} */ (
				/** @type {unknown} */ (definition && definition.parent)
			);

			/**
			 * The kind of binding that declared the variable, or `""` when it
			 * was not declared by a variable declaration at all.
			 * @type {string}
			 */
			const kind =
				declaration && declaration.type === "VariableDeclaration"
					? declaration.kind
					: "";

			// Constant variables are safe.
			if (CONSTANT_BINDINGS.has(kind)) {
				return true;
			}

			/*
			 * Variables which are declared by `let` in the loop is safe.
			 * It's a different instance from the next loop step's.
			 */
			if (
				kind === "let" &&
				declaration.range[0] > loopNode.range[0] &&
				declaration.range[1] < loopNode.range[1]
			) {
				return true;
			}

			/*
			 * WriteReferences which exist after this border are unsafe because those
			 * can modify the variable.
			 */
			const border = getTopLoopNode(
				loopNode,
				kind === "let" ? declaration : null,
			).range[0];

			/**
			 * Checks whether a given reference is safe or not.
			 * The reference is every reference of the upper scope's variable we are
			 * looking now.
			 *
			 * It's safe if the reference matches one of the following condition.
			 * - is readonly.
			 * - doesn't exist inside a local function and after the border.
			 * @param {Reference} upperRef A reference to check.
			 * @returns {boolean} `true` if the reference is safe.
			 */
			function isSafeReference(upperRef) {
				const id = asNode(upperRef.identifier);

				return (
					!upperRef.isWrite() ||
					(variable.scope.variableScope ===
						upperRef.from.variableScope &&
						id.range[0] < border)
				);
			}

			return (
				Boolean(variable) && variable.references.every(isSafeReference)
			);
		}

		/**
		 * Reports functions which match the following condition:
		 *
		 * - has a loop node in ancestors.
		 * - has any references which refers to an unsafe variable.
		 * @param {ASTNode} node The AST node to check.
		 * @returns {void}
		 */
		function checkForLoops(node) {
			const loopNode = getContainingLoopNode(node);

			if (!loopNode) {
				return;
			}

			const references = sourceCode.getScope(node).through;

			// Check if the function is not asynchronous or a generator function
			if (!(node.async || node.generator)) {
				if (isIIFE(node)) {
					const isFunctionExpression =
						node.type === "FunctionExpression";

					// Check if the function is referenced elsewhere in the code
					const isFunctionReferenced =
						isFunctionExpression && node.id
							? references.some(
									r => r.identifier.name === node.id.name,
								)
							: false;

					if (!isFunctionReferenced) {
						SKIPPED_IIFE_NODES.add(node);
						return;
					}
				}
			}

			const unsafeRefs = [
				...new Set(
					references
						.filter(r => r.resolved && !isSafe(loopNode, r))
						.map(r => r.identifier.name),
				),
			];

			if (unsafeRefs.length > 0) {
				context.report({
					node,
					messageId: "unsafeRefs",
					data: { varNames: `'${unsafeRefs.join("', '")}'` },
				});
			}
		}

		return {
			ArrowFunctionExpression: checkForLoops,
			FunctionExpression: checkForLoops,
			FunctionDeclaration: checkForLoops,
		};
	},
};

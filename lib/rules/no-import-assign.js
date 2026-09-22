/**
 * @fileoverview Rule to flag updates of imported bindings.
 * @author Toru Nagashima <https://github.com/mysticatea>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { findVariable } = require("@eslint-community/eslint-utils");
const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Scope} Scope */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const WellKnownMutationFunctions = {
	Object: /^(?:assign|definePropert(?:y|ies)|freeze|setPrototypeOf)$/u,
	Reflect: /^(?:(?:define|delete)Property|set(?:PrototypeOf)?)$/u,
};

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — here `Reference#identifier` — as a
 * bare ESTree node: no `parent`, and `range` and `loc` optional. The linter
 * populates all three before any rule runs, so this is the same object a
 * visitor would have received and is reinterpreted rather than re-checked.
 * @param {Object} node The `eslint-scope` node.
 * @returns {ASTNode} The same node, typed for the rules layer.
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

/**
 * Check if a given node is LHS of an assignment node.
 * @param {ASTNode} node The node to check.
 * @returns {boolean} `true` if the node is LHS.
 */
function isAssignmentLeft(node) {
	const { parent } = node;

	return (
		(parent.type === "AssignmentExpression" && parent.left === node) ||
		// Destructuring assignments
		parent.type === "ArrayPattern" ||
		(parent.type === "Property" &&
			parent.value === node &&
			parent.parent.type === "ObjectPattern") ||
		parent.type === "RestElement" ||
		(parent.type === "AssignmentPattern" && parent.left === node)
	);
}

/**
 * Check if a given node is the operand of mutation unary operator.
 * @param {ASTNode} node The node to check.
 * @returns {boolean} `true` if the node is the operand of mutation unary operator.
 */
function isOperandOfMutationUnaryOperator(node) {
	const argumentNode =
		node.parent.type === "ChainExpression" ? node.parent : node;
	const { parent } = argumentNode;

	return (
		(parent.type === "UpdateExpression" &&
			parent.argument === argumentNode) ||
		(parent.type === "UnaryExpression" &&
			parent.operator === "delete" &&
			parent.argument === argumentNode)
	);
}

/**
 * Check if a given node is the iteration variable of `for-in`/`for-of` syntax.
 * @param {ASTNode} node The node to check.
 * @returns {boolean} `true` if the node is the iteration variable.
 */
function isIterationVariable(node) {
	const { parent } = node;

	return (
		(parent.type === "ForInStatement" && parent.left === node) ||
		(parent.type === "ForOfStatement" && parent.left === node)
	);
}

/**
 * Check if a given node is at the first argument of a well-known mutation function.
 * - `Object.assign`
 * - `Object.defineProperty`
 * - `Object.defineProperties`
 * - `Object.freeze`
 * - `Object.setPrototypeOf`
 * - `Reflect.defineProperty`
 * - `Reflect.deleteProperty`
 * - `Reflect.set`
 * - `Reflect.setPrototypeOf`
 * @param {ASTNode} node The node to check.
 * @param {Scope} scope A `escope.Scope` object to find variable (whichever).
 * @returns {boolean} `true` if the node is at the first argument of a well-known mutation function.
 */
function isArgumentOfWellKnownMutationFunction(node, scope) {
	const { parent } = node;

	if (parent.type !== "CallExpression" || parent.arguments[0] !== node) {
		return false;
	}
	const callee = astUtils.skipChainExpression(parent.callee);

	if (
		!astUtils.isSpecificMemberAccess(
			callee,
			"Object",
			WellKnownMutationFunctions.Object,
		) &&
		!astUtils.isSpecificMemberAccess(
			callee,
			"Reflect",
			WellKnownMutationFunctions.Reflect,
		)
	) {
		return false;
	}
	const variable = findVariable(scope, callee.object);

	return variable !== null && variable.scope.type === "global";
}

/**
 * Check if the identifier node is placed at to update members.
 * @param {ASTNode} id The Identifier node to check.
 * @param {Scope} scope A `escope.Scope` object to find variable (whichever).
 * @returns {boolean} `true` if the member of `id` was updated.
 */
function isMemberWrite(id, scope) {
	const { parent } = id;

	return (
		(parent.type === "MemberExpression" &&
			parent.object === id &&
			(isAssignmentLeft(parent) ||
				isOperandOfMutationUnaryOperator(parent) ||
				isIterationVariable(parent))) ||
		isArgumentOfWellKnownMutationFunction(id, scope)
	);
}

/**
 * Get the mutation node.
 * @param {ASTNode} id The Identifier node to get.
 * @returns {ASTNode} The mutation node.
 */
function getWriteNode(id) {
	let node = id.parent;

	while (
		node &&
		node.type !== "AssignmentExpression" &&
		node.type !== "UpdateExpression" &&
		node.type !== "UnaryExpression" &&
		node.type !== "CallExpression" &&
		node.type !== "ForInStatement" &&
		node.type !== "ForOfStatement"
	) {
		node = node.parent;
	}

	return node || id;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow assigning to imported bindings",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-import-assign",
		},

		schema: [],

		messages: {
			readonly: "'{{name}}' is read-only.",
			readonlyMember: "The members of '{{name}}' are read-only.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Reports every write to a binding the declaration introduced.
			 * @param {ASTNode} node The `ImportDeclaration` node.
			 * @returns {void}
			 */
			ImportDeclaration(node) {
				const scope = sourceCode.getScope(node);

				for (const variable of sourceCode.getDeclaredVariables(node)) {
					const shouldCheckMembers = variable.defs.some(
						d => d.node.type === "ImportNamespaceSpecifier",
					);

					/** @type {ASTNode | null} */
					let prevIdNode = null;

					for (const reference of variable.references) {
						const idNode = asNode(reference.identifier);

						/*
						 * AssignmentPattern (e.g. `[a = 0] = b`) makes two write
						 * references for the same identifier. This should skip
						 * the one of the two in order to prevent redundant reports.
						 */
						if (idNode === prevIdNode) {
							continue;
						}
						prevIdNode = idNode;

						if (reference.isWrite()) {
							context.report({
								node: getWriteNode(idNode),
								messageId: "readonly",
								data: { name: idNode.name },
							});
						} else if (
							shouldCheckMembers &&
							isMemberWrite(idNode, scope)
						) {
							context.report({
								node: getWriteNode(idNode),
								messageId: "readonlyMember",
								data: { name: idNode.name },
							});
						}
					}
				}
			},
		};
	},
};

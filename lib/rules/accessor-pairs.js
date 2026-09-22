/**
 * @fileoverview Rule to enforce getter and setter pairs in objects and classes.
 * @author Gyandeep Singh
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

/**
 * A getter/setter group keyed by the accessor name. The key is the static
 * property name when there is one, and the token list of the computed key
 * otherwise, which is why `areEqualKeys()` has to compare both shapes.
 * @typedef {{ key: string | Array<Token>, getters: Array<ASTNode>, setters: Array<ASTNode> }} AccessorData
 */

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Checks whether or not the given lists represent the equal tokens in the same order.
 * Tokens are compared by their properties, not by instance.
 * @param {Array<Token>} left First list of tokens.
 * @param {Array<Token>} right Second list of tokens.
 * @returns {boolean} `true` if the lists have same tokens.
 */
function areEqualTokenLists(left, right) {
	if (left.length !== right.length) {
		return false;
	}

	for (let i = 0; i < left.length; i++) {
		const leftToken = left[i],
			rightToken = right[i];

		if (
			leftToken.type !== rightToken.type ||
			leftToken.value !== rightToken.value
		) {
			return false;
		}
	}

	return true;
}

/**
 * Checks whether or not the given keys are equal.
 * @param {string | Array<Token>} left First key.
 * @param {string | Array<Token>} right Second key.
 * @returns {boolean} `true` if the keys are equal.
 */
function areEqualKeys(left, right) {
	if (typeof left === "string" && typeof right === "string") {
		// Statically computed names.
		return left === right;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		// Token lists.
		return areEqualTokenLists(left, right);
	}

	return false;
}

/**
 * Checks whether or not a given node is of an accessor kind ('get' or 'set').
 * @param {ASTNode} node A node to check.
 * @returns {boolean} `true` if the node is of an accessor kind.
 */
function isAccessorKind(node) {
	return node.kind === "get" || node.kind === "set";
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				enforceForTSTypes: false,
				enforceForClassMembers: true,
				getWithoutSet: false,
				setWithoutGet: true,
			},
		],

		docs: {
			description:
				"Enforce getter and setter pairs in objects and classes",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/accessor-pairs",
		},

		schema: [
			{
				type: "object",
				properties: {
					getWithoutSet: {
						type: "boolean",
					},
					setWithoutGet: {
						type: "boolean",
					},
					enforceForClassMembers: {
						type: "boolean",
					},
					enforceForTSTypes: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			missingGetterInPropertyDescriptor:
				"Getter is not present in property descriptor.",
			missingSetterInPropertyDescriptor:
				"Setter is not present in property descriptor.",
			missingGetterInObjectLiteral:
				"Getter is not present for {{ name }}.",
			missingSetterInObjectLiteral:
				"Setter is not present for {{ name }}.",
			missingGetterInClass: "Getter is not present for class {{ name }}.",
			missingSetterInClass: "Setter is not present for class {{ name }}.",
			missingGetterInType: "Getter is not present for type {{ name }}.",
			missingSetterInType: "Setter is not present for type {{ name }}.",
		},
	},
	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [
			{
				getWithoutSet: checkGetWithoutSet,
				setWithoutGet: checkSetWithoutGet,
				enforceForClassMembers,
				enforceForTSTypes,
			},
		] = context.options;
		const sourceCode = context.sourceCode;

		/**
		 * Reports the given node.
		 * @param {ASTNode} node The node to report.
		 * @param {string} messageKind "missingGetter" or "missingSetter".
		 * @returns {void}
		 * @private
		 */
		function report(node, messageKind) {
			if (node.type === "Property") {
				context.report({
					node,
					messageId: `${messageKind}InObjectLiteral`,
					loc: astUtils.getFunctionHeadLoc(node.value, sourceCode),
					data: {
						name: astUtils.getFunctionNameWithKind(node.value),
					},
				});
			} else if (node.type === "MethodDefinition") {
				context.report({
					node,
					messageId: `${messageKind}InClass`,
					loc: astUtils.getFunctionHeadLoc(node.value, sourceCode),
					data: {
						name: astUtils.getFunctionNameWithKind(node.value),
					},
				});
			} else if (node.type === "TSMethodSignature") {
				context.report({
					node,
					messageId: `${messageKind}InType`,
					loc: astUtils.getFunctionHeadLoc(node, sourceCode),
					data: {
						name: astUtils.getFunctionNameWithKind(node),
					},
				});
			} else {
				context.report({
					node,
					messageId: `${messageKind}InPropertyDescriptor`,
				});
			}
		}

		/**
		 * Reports each of the nodes in the given list using the same messageId.
		 * @param {Array<ASTNode>} nodes Nodes to report.
		 * @param {string} messageKind "missingGetter" or "missingSetter".
		 * @returns {void}
		 * @private
		 */
		function reportList(nodes, messageKind) {
			for (const node of nodes) {
				report(node, messageKind);
			}
		}

		/**
		 * Checks accessor pairs in the given list of nodes.
		 * @param {Array<ASTNode>} nodes The list to check.
		 * @returns {void}
		 * @private
		 */
		function checkList(nodes) {
			/** @type {Array<AccessorData>} */
			const accessors = [];
			let found = false;

			for (let i = 0; i < nodes.length; i++) {
				const node = nodes[i];

				if (isAccessorKind(node)) {
					// Creates a new `AccessorData` object for the given getter or setter node.
					const name = astUtils.getStaticPropertyName(node);
					const key =
						name !== null ? name : sourceCode.getTokens(node.key);

					// Merges the given `AccessorData` object into the given accessors list.
					for (let j = 0; j < accessors.length; j++) {
						const accessor = accessors[j];

						if (areEqualKeys(accessor.key, key)) {
							accessor.getters.push(
								...(node.kind === "get" ? [node] : []),
							);
							accessor.setters.push(
								...(node.kind === "set" ? [node] : []),
							);
							found = true;
							break;
						}
					}
					if (!found) {
						accessors.push({
							key,
							getters: node.kind === "get" ? [node] : [],
							setters: node.kind === "set" ? [node] : [],
						});
					}
					found = false;
				}
			}

			for (const { getters, setters } of accessors) {
				if (checkSetWithoutGet && setters.length && !getters.length) {
					reportList(setters, "missingGetter");
				}
				if (checkGetWithoutSet && getters.length && !setters.length) {
					reportList(getters, "missingSetter");
				}
			}
		}

		/**
		 * Checks accessor pairs in an object literal.
		 * @param {ASTNode} node `ObjectExpression` node to check.
		 * @returns {void}
		 * @private
		 */
		function checkObjectLiteral(node) {
			checkList(
				node.properties.filter(
					(/** @type {ASTNode} */ p) => p.type === "Property",
				),
			);
		}

		/**
		 * Checks accessor pairs in a property descriptor.
		 * @param {ASTNode} node Property descriptor `ObjectExpression` node to check.
		 * @returns {void}
		 * @private
		 */
		function checkPropertyDescriptor(node) {
			const namesToCheck = new Set(
				node.properties
					.filter(
						(/** @type {ASTNode} */ p) =>
							p.type === "Property" &&
							p.kind === "init" &&
							!p.computed,
					)
					.map((/** @type {ASTNode} */ { key }) => key.name),
			);

			const hasGetter = namesToCheck.has("get");
			const hasSetter = namesToCheck.has("set");

			if (checkSetWithoutGet && hasSetter && !hasGetter) {
				report(node, "missingGetter");
			}
			if (checkGetWithoutSet && hasGetter && !hasSetter) {
				report(node, "missingSetter");
			}
		}

		/**
		 * Checks the given object expression as an object literal and as a possible property descriptor.
		 * @param {ASTNode} node `ObjectExpression` node to check.
		 * @returns {void}
		 * @private
		 */
		function checkObjectExpression(node) {
			checkObjectLiteral(node);
			if (astUtils.isPropertyDescriptor(node, sourceCode)) {
				checkPropertyDescriptor(node);
			}
		}

		/**
		 * Checks the given class body.
		 * @param {ASTNode} node `ClassBody` node to check.
		 * @returns {void}
		 * @private
		 */
		function checkClassBody(node) {
			const methodDefinitions = node.body.filter(
				(/** @type {ASTNode} */ m) => m.type === "MethodDefinition",
			);

			checkList(
				methodDefinitions.filter(
					(/** @type {ASTNode} */ m) => m.static,
				),
			);
			checkList(
				methodDefinitions.filter(
					(/** @type {ASTNode} */ m) => !m.static,
				),
			);
		}

		/**
		 * Checks the given type.
		 * @param {ASTNode} node `TSTypeLiteral` or `TSInterfaceBody` node to check.
		 * @returns {void}
		 * @private
		 */
		function checkType(node) {
			const members =
				node.type === "TSTypeLiteral" ? node.members : node.body;
			const methodDefinitions = members.filter(
				(/** @type {ASTNode} */ m) => m.type === "TSMethodSignature",
			);

			checkList(methodDefinitions);
		}

		/** @type {RuleVisitor} */
		const listeners = {};

		if (checkSetWithoutGet || checkGetWithoutSet) {
			listeners.ObjectExpression = checkObjectExpression;
			if (enforceForClassMembers) {
				listeners.ClassBody = checkClassBody;
			}
			if (enforceForTSTypes) {
				listeners["TSTypeLiteral, TSInterfaceBody"] = checkType;
			}
		}

		return listeners;
	},
};

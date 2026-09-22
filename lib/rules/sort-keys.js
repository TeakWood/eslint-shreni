/**
 * @fileoverview Rule to require object keys to be sorted
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils"),
	naturalCompare = require("natural-compare");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * The traversal state for one object literal. Object literals nest, so each
 * entry links back to the one for the enclosing object literal, and the
 * outermost entry links to `null`.
 * @typedef {Object} SortStack
 * @property {SortStack | null} upper The state for the enclosing object literal.
 * @property {ASTNode | null} prevNode The previous `Property` node, or `null` before the first one.
 * @property {boolean} prevBlankLine Whether the previous property was preceded by a blank line.
 * @property {string | null} prevName The previous property's name, or `null` when it has no static name.
 * @property {number} numKeys The number of properties in the object literal.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Gets the property name of the given `Property` node.
 *
 * - If the property's key is an `Identifier` node, this returns the key's name
 *   whether it's a computed property or not.
 * - If the property has a static name, this returns the static name.
 * - Otherwise, this returns null.
 * @param {ASTNode} node The `Property` node to get.
 * @returns {string | null} The property name or null.
 * @private
 */
function getPropertyName(node) {
	const staticName = astUtils.getStaticPropertyName(node);

	if (staticName !== null) {
		return staticName;
	}

	return node.key.name || null;
}

/**
 * Functions which check that the given 2 names are in specific order.
 *
 * Postfix `I` is meant insensitive.
 * Postfix `N` is meant natural.
 * @private
 */
const isValidOrders = {
	/**
	 * Checks ascending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	asc(a, b) {
		return a <= b;
	},

	/**
	 * Checks case-insensitive ascending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	ascI(a, b) {
		return a.toLowerCase() <= b.toLowerCase();
	},

	/**
	 * Checks natural ascending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	ascN(a, b) {
		return naturalCompare(a, b) <= 0;
	},

	/**
	 * Checks case-insensitive natural ascending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	ascIN(a, b) {
		return naturalCompare(a.toLowerCase(), b.toLowerCase()) <= 0;
	},

	/**
	 * Checks descending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	desc(a, b) {
		return isValidOrders.asc(b, a);
	},

	/**
	 * Checks case-insensitive descending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	descI(a, b) {
		return isValidOrders.ascI(b, a);
	},

	/**
	 * Checks natural descending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	descN(a, b) {
		return isValidOrders.ascN(b, a);
	},

	/**
	 * Checks case-insensitive natural descending order.
	 * @param {string} a The first name.
	 * @param {string} b The second name.
	 * @returns {boolean} `true` if the names are in order.
	 */
	descIN(a, b) {
		return isValidOrders.ascIN(b, a);
	},
};

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			"asc",
			{
				allowLineSeparatedGroups: false,
				caseSensitive: true,
				ignoreComputedKeys: false,
				minKeys: 2,
				natural: false,
			},
		],

		docs: {
			description: "Require object keys to be sorted",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/sort-keys",
		},

		schema: [
			{
				enum: ["asc", "desc"],
			},
			{
				type: "object",
				properties: {
					caseSensitive: {
						type: "boolean",
					},
					natural: {
						type: "boolean",
					},
					minKeys: {
						type: "integer",
						minimum: 2,
					},
					allowLineSeparatedGroups: {
						type: "boolean",
					},
					ignoreComputedKeys: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			sortKeys:
				"Expected object keys to be in {{natural}}{{insensitive}}{{order}}ending order. '{{thisName}}' should be before '{{prevName}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [
			order,
			{
				caseSensitive,
				natural,
				minKeys,
				allowLineSeparatedGroups,
				ignoreComputedKeys,
			},
		] = context.options;
		const insensitive = !caseSensitive;
		const isValidOrder =
			isValidOrders[
				// `meta.schema` pins `order` to `asc`/`desc`, so the key always exists.
				/** @type {keyof typeof isValidOrders} */ (
					order + (insensitive ? "I" : "") + (natural ? "N" : "")
				)
			];

		/**
		 * The stack to save the previous property's name for each object literals.
		 *
		 * This is `null` outside any object literal. The `SpreadElement` and
		 * `Property` handlers below only run while one is being traversed, so
		 * they read it through a cast rather than re-checking it.
		 * @type {SortStack | null}
		 */
		let stack = null;
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Pushes the state for the object literal being entered.
			 * @param {ASTNode} node The `ObjectExpression` node.
			 * @returns {void}
			 */
			ObjectExpression(node) {
				stack = {
					upper: stack,
					prevNode: null,
					prevBlankLine: false,
					prevName: null,
					numKeys: node.properties.length,
				};
			},

			/**
			 * Pops the state for the object literal being left.
			 * @returns {void}
			 */
			"ObjectExpression:exit"() {
				stack = /** @type {SortStack} */ (stack).upper;
			},

			/**
			 * Restarts the sort at a spread, whose keys are not known statically.
			 * @param {ASTNode} node The `SpreadElement` node.
			 * @returns {void}
			 */
			SpreadElement(node) {
				if (node.parent.type === "ObjectExpression") {
					/** @type {SortStack} */ (stack).prevName = null;
				}
			},

			/**
			 * Checks that the property follows its predecessor in sort order.
			 * @param {ASTNode} node The `Property` node.
			 * @returns {void}
			 */
			Property(node) {
				if (node.parent.type === "ObjectPattern") {
					return;
				}

				/*
				 * `Property` is only visited inside an `ObjectExpression`, so
				 * the stack is never `null` here. Aliasing it is equivalent to
				 * reading `stack` directly: nothing below reassigns `stack`,
				 * they only mutate the entry it points at.
				 */
				const currentStack = /** @type {SortStack} */ (stack);

				if (ignoreComputedKeys && node.computed) {
					currentStack.prevName = null; // reset sort
					return;
				}

				const prevName = currentStack.prevName;
				const numKeys = currentStack.numKeys;
				const thisName = getPropertyName(node);

				// Get tokens between current node and previous node
				const tokens =
					currentStack.prevNode &&
					sourceCode.getTokensBetween(currentStack.prevNode, node, {
						includeComments: true,
					});

				let isBlankLineBetweenNodes = currentStack.prevBlankLine;

				if (tokens) {
					// check blank line between tokens
					tokens.forEach((token, index) => {
						const previousToken = tokens[index - 1];

						if (
							previousToken &&
							token.loc.start.line - previousToken.loc.end.line >
								1
						) {
							isBlankLineBetweenNodes = true;
						}
					});

					// check blank line between the current node and the last token
					if (
						!isBlankLineBetweenNodes &&
						node.loc.start.line -
							/** @type {Token} */ (tokens.at(-1)).loc.end.line >
							1
					) {
						isBlankLineBetweenNodes = true;
					}

					// check blank line between the first token and the previous node
					if (
						!isBlankLineBetweenNodes &&
						tokens[0].loc.start.line -
							/** @type {ASTNode} */ (currentStack.prevNode).loc
								.end.line >
							1
					) {
						isBlankLineBetweenNodes = true;
					}
				}

				currentStack.prevNode = node;

				if (thisName !== null) {
					currentStack.prevName = thisName;
				}

				if (allowLineSeparatedGroups && isBlankLineBetweenNodes) {
					currentStack.prevBlankLine = thisName === null;
					return;
				}

				if (
					prevName === null ||
					thisName === null ||
					numKeys < minKeys
				) {
					return;
				}

				if (!isValidOrder(prevName, thisName)) {
					context.report({
						node,
						loc: node.key.loc,
						messageId: "sortKeys",
						data: {
							thisName,
							prevName,
							order,
							insensitive: insensitive ? "insensitive " : "",
							natural: natural ? "natural " : "",
						},
					});
				}
			},
		};
	},
};

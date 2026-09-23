/**
 * @fileoverview Rule to flag use of duplicate keys in an object.
 * @author Ian Christian Myers
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
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * Which accessor kinds have already been seen for one property name.
 * @typedef {Object} PropertyInfo
 * @property {boolean} get Whether a `get` accessor or a plain initializer has been defined.
 * @property {boolean} set Whether a `set` accessor or a plain initializer has been defined.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const GET_KIND = /^(?:init|get)$/u;
const SET_KIND = /^(?:init|set)$/u;

/**
 * The class which stores properties' information of an object.
 */
class ObjectInfo {
	/**
	 * @param {ObjectInfo | null} upper The information of the outer object.
	 * @param {ASTNode} node The ObjectExpression node of this information.
	 */
	constructor(upper, node) {
		this.upper = upper;
		this.node = node;

		/** @type {Map<string | null, PropertyInfo>} */
		this.properties = new Map();
	}

	/**
	 * Gets the information of the given Property node.
	 * @param {ASTNode} node The Property node to get.
	 * @returns {PropertyInfo} The information of the property.
	 */
	getPropertyInfo(node) {
		const name = astUtils.getStaticPropertyName(node);

		if (!this.properties.has(name)) {
			this.properties.set(name, { get: false, set: false });
		}

		// The entry was just created above if it was missing, so the lookup always hits.
		return /** @type {PropertyInfo} */ (this.properties.get(name));
	}

	/**
	 * Checks whether the given property has been defined already or not.
	 * @param {ASTNode} node The Property node to check.
	 * @returns {boolean} `true` if the property has been defined.
	 */
	isPropertyDefined(node) {
		const entry = this.getPropertyInfo(node);

		return (
			(GET_KIND.test(node.kind) && entry.get) ||
			(SET_KIND.test(node.kind) && entry.set)
		);
	}

	/**
	 * Defines the given property.
	 * @param {ASTNode} node The Property node to define.
	 * @returns {void}
	 */
	defineProperty(node) {
		const entry = this.getPropertyInfo(node);

		if (GET_KIND.test(node.kind)) {
			entry.get = true;
		}
		if (SET_KIND.test(node.kind)) {
			entry.set = true;
		}
	}
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow duplicate keys in object literals",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-dupe-keys",
		},

		schema: [],

		messages: {
			unexpected: "Duplicate key '{{name}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/** @type {ObjectInfo | null} */
		let info = null;

		return {
			/**
			 * Pushes the information of the object being entered.
			 * @param {ASTNode} node The ObjectExpression node being entered.
			 * @returns {void}
			 */
			ObjectExpression(node) {
				info = new ObjectInfo(info, node);
			},

			/**
			 * Pops the information of the object being left.
			 * @returns {void}
			 */
			"ObjectExpression:exit"() {
				// `:exit` always pairs with the enter that pushed the entry, so the stack is never empty here.
				info = /** @type {ObjectInfo} */ (info).upper;
			},

			/**
			 * Reports the given property if its key duplicates an earlier one.
			 * @param {ASTNode} node The Property node to check.
			 * @returns {void}
			 */
			Property(node) {
				const name = astUtils.getStaticPropertyName(node);

				// Skip destructuring.
				if (node.parent.type !== "ObjectExpression") {
					return;
				}

				// Skip if the name is not static.
				if (name === null) {
					return;
				}

				/*
				 * Skip if the property node is a proto setter.
				 * Proto setter is a special syntax that sets
				 * object's prototype instead of creating a property.
				 * It can be in one of the following forms:
				 *
				 *    __proto__: <expression>
				 *    '__proto__': <expression>
				 *    "__proto__": <expression>
				 *
				 * Duplicate proto setters produce parsing errors,
				 * so we can just skip them to not interfere with
				 * regular properties named "__proto__".
				 */
				if (
					name === "__proto__" &&
					node.kind === "init" &&
					!node.computed &&
					!node.shorthand &&
					!node.method
				) {
					return;
				}

				/*
				 * The early return above proves the parent is an `ObjectExpression`,
				 * and that handler pushed an entry before its properties are visited,
				 * so `info` below is the entry for this property's own object.
				 */

				// Reports if the name is defined already.
				if (/** @type {ObjectInfo} */ (info).isPropertyDefined(node)) {
					context.report({
						node: /** @type {ObjectInfo} */ (info).node,
						loc: node.key.loc,
						messageId: "unexpected",
						data: { name },
					});
				}

				// Update info.
				/** @type {ObjectInfo} */ (info).defineProperty(node);
			},
		};
	},
};

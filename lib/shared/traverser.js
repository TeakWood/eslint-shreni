/**
 * @fileoverview Traverser to traverse AST trees.
 * @author Nicholas C. Zakas
 * @author Toru Nagashima
 */
// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const vk = require("eslint-visitor-keys");
const debug = require("debug")("eslint:traverser");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("./types.js").ASTNode} ASTNode */
/** @typedef {import("eslint-visitor-keys").VisitorKeys} VisitorKeys */

/**
 * A callback invoked when entering or leaving a node. It is called as a method
 * of the `Traverser`, so callers can invoke `this.skip()` and `this.break()`
 * from inside it.
 * @callback TraverseCallback
 * @this {Traverser}
 * @param {ASTNode} node The node being entered or left.
 * @param {ASTNode | null} parent The parent of `node`, or `null` for the root.
 * @returns {void}
 */

/**
 * The options accepted by `traverse()`.
 * @typedef {Object} TraverseOptions
 * @property {VisitorKeys} [visitorKeys] The keys of each node type to traverse child nodes. Default is `./default-visitor-keys.json`.
 * @property {TraverseCallback} [enter] The callback function which is called on entering each node.
 * @property {TraverseCallback} [leave] The callback function which is called on leaving each node.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Do nothing.
 * @returns {void}
 */
function noop() {
	// do nothing.
}

/**
 * Check whether the given value is an ASTNode or not.
 * @param {unknown} x The value to check.
 * @returns {x is ASTNode} `true` if the value is an ASTNode.
 */
function isNode(x) {
	return (
		x !== null &&
		typeof x === "object" &&
		typeof (/** @type {{ type?: unknown }} */ (x).type) === "string"
	);
}

/**
 * Get the visitor keys of a given node.
 * @param {VisitorKeys} visitorKeys The map of visitor keys.
 * @param {ASTNode} node The node to get their visitor keys.
 * @returns {readonly string[]} The visitor keys of the node.
 */
function getVisitorKeys(visitorKeys, node) {
	let keys = visitorKeys[node.type];

	if (!keys) {
		keys = vk.getKeys(node);
		debug(
			'Unknown node type "%s": Estimated visitor keys %j',
			node.type,
			keys,
		);
	}

	return keys;
}

/**
 * The traverser class to traverse AST trees.
 */
class Traverser {
	constructor() {
		/** @type {ASTNode | null} */
		this._current = null;

		/** @type {Array<ASTNode>} */
		this._parents = [];

		this._skipped = false;
		this._broken = false;

		/*
		 * These start out at the same defaults `traverse()` falls back to, so
		 * that they are never null once a traversal is under way. `traverse()`
		 * overwrites all three before walking anything.
		 */

		/** @type {VisitorKeys} */
		this._visitorKeys = vk.KEYS;

		/** @type {TraverseCallback} */
		this._enter = noop;

		/** @type {TraverseCallback} */
		this._leave = noop;
	}

	/**
	 * Gives current node.
	 * @returns {ASTNode | null} The current node.
	 */
	current() {
		return this._current;
	}

	/**
	 * Gives a copy of the ancestor nodes.
	 * @returns {Array<ASTNode>} The ancestor nodes.
	 */
	parents() {
		return this._parents.slice(0);
	}

	/**
	 * Break the current traversal.
	 * @returns {void}
	 */
	break() {
		this._broken = true;
	}

	/**
	 * Skip child nodes for the current traversal.
	 * @returns {void}
	 */
	skip() {
		this._skipped = true;
	}

	/**
	 * Traverse the given AST tree.
	 * @param {ASTNode} node The root node to traverse.
	 * @param {TraverseOptions} options The option object. See {@link TraverseOptions} for the supported properties.
	 * @returns {void}
	 */
	traverse(node, options) {
		this._current = null;
		this._parents = [];
		this._skipped = false;
		this._broken = false;
		this._visitorKeys = options.visitorKeys || vk.KEYS;
		this._enter = options.enter || noop;
		this._leave = options.leave || noop;
		this._traverse(node, null);
	}

	/**
	 * Traverse the given AST tree recursively.
	 * @param {unknown} node The current node.
	 * @param {ASTNode | null} parent The parent node.
	 * @returns {void}
	 * @private
	 */
	_traverse(node, parent) {
		if (!isNode(node)) {
			return;
		}

		this._current = node;
		this._skipped = false;

		// Called as a method so the callback can use `this.skip()`/`this.break()`.
		this._enter(node, parent);

		if (!this._skipped && !this._broken) {
			const keys = getVisitorKeys(this._visitorKeys, node);

			if (keys.length >= 1) {
				this._parents.push(node);
				for (let i = 0; i < keys.length && !this._broken; ++i) {
					const child = /** @type {Record<string, unknown>} */ (
						/** @type {unknown} */ (node)
					)[keys[i]];

					if (Array.isArray(child)) {
						for (
							let j = 0;
							j < child.length && !this._broken;
							++j
						) {
							this._traverse(child[j], node);
						}
					} else {
						this._traverse(child, node);
					}
				}
				this._parents.pop();
			}
		}

		if (!this._broken) {
			this._leave(node, parent);
		}

		this._current = parent;
	}

	/**
	 * Calculates the keys to use for traversal.
	 * @param {ASTNode} node The node to read keys from.
	 * @returns {readonly string[]} An array of keys to visit on the node.
	 * @private
	 */
	static getKeys(node) {
		return vk.getKeys(node);
	}

	/**
	 * Traverse the given AST tree.
	 * @param {ASTNode} node The root node to traverse.
	 * @param {TraverseOptions} options The option object. See {@link TraverseOptions} for the supported properties.
	 * @returns {void}
	 */
	static traverse(node, options) {
		new Traverser().traverse(node, options);
	}

	/**
	 * The default visitor keys.
	 * @returns {VisitorKeys} The default visitor keys.
	 */
	static get DEFAULT_VISITOR_KEYS() {
		return vk.KEYS;
	}
}

module.exports = Traverser;

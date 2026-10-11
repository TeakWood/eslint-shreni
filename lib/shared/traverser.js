// @ts-check
/**
 * @fileoverview Traverser to traverse AST trees.
 * @author Nicholas C. Zakas
 * @author Toru Nagashima
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const vk = require("eslint-visitor-keys");
const debug = require("debug")("eslint:traverser");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/**
 * A node this traverser can visit: any object with a string `type` property.
 * The traverser is deliberately agnostic about AST shape — it discovers child
 * keys through visitor keys rather than through a fixed node union — so it is
 * not tied to the ESTree node types.
 * @typedef {{ type: string, [key: string]: any }} TraversableNode
 */

/**
 * A callback invoked on entering or leaving a node during traversal.
 *
 * `_traverse()` calls it as a method of the traverser, so a visitor written
 * with method or `function` syntax can call `this.skip()` and `this.break()`
 * to steer the traversal — `lib/languages/js/source-code/source-code.js` does.
 * Declaring the `this` parameter does not stop an arrow function, which has no
 * `this` of its own, from being passed.
 * @typedef {(this: Traverser, node: TraversableNode, parent: TraversableNode | null) => void} NodeVisitor
 */

/**
 * The child-bearing keys of each node type, keyed by node type.
 * @typedef {import("eslint-visitor-keys").VisitorKeys} VisitorKeys
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Do nothing.
 */
function noop() {
	// do nothing.
}

/**
 * Check whether the given value is an ASTNode or not.
 * @param {unknown} x The value to check.
 * @returns {x is TraversableNode} `true` if the value is an ASTNode.
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
 * @param {TraversableNode} node The node to get their visitor keys.
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
		/**
		 * The node currently being visited.
		 * @type {TraversableNode | null}
		 */
		this._current = null;

		/**
		 * The ancestors of the current node, outermost first.
		 * @type {TraversableNode[]}
		 */
		this._parents = [];

		this._skipped = false;
		this._broken = false;

		/*
		 * The three fields below are `null` until `traverse()` runs, which
		 * always assigns all of them before reaching `_traverse()`. They are
		 * typed as nullable to describe that initial state honestly; the
		 * handful of reads in `_traverse()` assert the invariant locally.
		 */

		/**
		 * The visitor keys in use for the current traversal.
		 * @type {VisitorKeys | null}
		 */
		this._visitorKeys = null;

		/**
		 * The callback invoked on entering each node.
		 * @type {NodeVisitor | null}
		 */
		this._enter = null;

		/**
		 * The callback invoked on leaving each node.
		 * @type {NodeVisitor | null}
		 */
		this._leave = null;
	}

	/**
	 * Gives current node.
	 * @returns {TraversableNode | null} The current node.
	 */
	current() {
		return this._current;
	}

	/**
	 * Gives a copy of the ancestor nodes.
	 * @returns {TraversableNode[]} The ancestor nodes.
	 */
	parents() {
		return this._parents.slice(0);
	}

	/**
	 * Break the current traversal.
	 */
	break() {
		this._broken = true;
	}

	/**
	 * Skip child nodes for the current traversal.
	 */
	skip() {
		this._skipped = true;
	}

	/**
	 * Traverse the given AST tree.
	 * @param {TraversableNode} node The root node to traverse.
	 * @param {Object} options The option object.
	 * @param {VisitorKeys} [options.visitorKeys=DEFAULT_VISITOR_KEYS] The keys of each node types to traverse child nodes. Default is `./default-visitor-keys.json`.
	 * @param {NodeVisitor} [options.enter=noop] The callback function which is called on entering each node.
	 * @param {NodeVisitor} [options.leave=noop] The callback function which is called on leaving each node.
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
	 * @param {TraversableNode} node The current node.
	 * @param {TraversableNode | null} parent The parent node.
	 * @returns {void}
	 * @private
	 */
	_traverse(node, parent) {
		if (!isNode(node)) {
			return;
		}

		this._current = node;
		this._skipped = false;
		/** @type {NodeVisitor} */ (this._enter)(node, parent);

		if (!this._skipped && !this._broken) {
			const keys = getVisitorKeys(
				/** @type {VisitorKeys} */ (this._visitorKeys),
				node,
			);

			if (keys.length >= 1) {
				this._parents.push(node);
				for (let i = 0; i < keys.length && !this._broken; ++i) {
					const child = node[keys[i]];

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
			/** @type {NodeVisitor} */ (this._leave)(node, parent);
		}

		this._current = parent;
	}

	/**
	 * Calculates the keys to use for traversal.
	 * Internal to ESLint, but used across modules (see `lib/linter/linter.js`),
	 * so it must stay public in the emitted declarations: a `@private` tag here
	 * becomes a real `private` modifier in `traverser.d.ts` and breaks callers.
	 * @param {TraversableNode} node The node to read keys from.
	 * @returns {readonly string[]} An array of keys to visit on the node.
	 */
	static getKeys(node) {
		return vk.getKeys(node);
	}

	/**
	 * Traverse the given AST tree.
	 * @param {TraversableNode} node The root node to traverse.
	 * @param {Object} options The option object.
	 * @param {VisitorKeys} [options.visitorKeys=DEFAULT_VISITOR_KEYS] The keys of each node types to traverse child nodes. Default is `./default-visitor-keys.json`.
	 * @param {NodeVisitor} [options.enter=noop] The callback function which is called on entering each node.
	 * @param {NodeVisitor} [options.leave=noop] The callback function which is called on leaving each node.
	 * @returns {void}
	 */
	static traverse(node, options) {
		new Traverser().traverse(node, options);
	}

	/**
	 * The default visitor keys.
	 */
	static get DEFAULT_VISITOR_KEYS() {
		return vk.KEYS;
	}
}

module.exports = Traverser;

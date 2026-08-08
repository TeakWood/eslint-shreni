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
// Types
//------------------------------------------------------------------------------

/** @import { ASTNode, VisitorKeys } from "../types/core.js" */

/**
 * A callback invoked on entering or leaving a node.
 *
 * The `this` parameter is load-bearing rather than cosmetic: `_traverse` calls
 * these as methods on the traverser, and real visitors rely on it — see
 * `hasDynamicExpressions` in `lib/rules/no-unmodified-loop-condition.js:243`,
 * which calls `this.break()` and `this.skip()` from inside `enter`.
 * @typedef {(this: Traverser, node: ASTNode, parent: ASTNode | null) => void} TraverserVisitor
 */

/**
 * The option object accepted by `traverse`.
 * @typedef {Object} TraverserOptions
 * @property {VisitorKeys} [visitorKeys] The keys of each node type to traverse child nodes.
 * @property {TraverserVisitor} [enter] Called on entering each node.
 * @property {TraverserVisitor} [leave] Called on leaving each node.
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
		/*
		 * `typeof x === "object"` narrows only to `object`, which has no
		 * members, so the discriminant has to be reached through a shape that
		 * admits it being absent.
		 */
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
		/**
		 * The node being visited, or the node the last traversal ended on.
		 * @type {ASTNode | null}
		 */
		this._current = null;

		/**
		 * The ancestors of `_current`, outermost first.
		 * @type {ASTNode[]}
		 */
		this._parents = [];

		this._skipped = false;
		this._broken = false;

		/*
		 * These three are `null` until `traverse` runs, and are declared that
		 * way rather than pre-filled with defaults so the type matches what a
		 * freshly constructed instance actually holds. `_traverse` — the only
		 * reader, and reachable only through `traverse` — asserts them.
		 */

		/** @type {VisitorKeys | null} */
		this._visitorKeys = null;

		/** @type {TraverserVisitor | null} */
		this._enter = null;

		/** @type {TraverserVisitor | null} */
		this._leave = null;
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
	 * @returns {ASTNode[]} The ancestor nodes.
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
	 * @param {TraverserOptions} options The option object. `visitorKeys`
	 * defaults to `Traverser.DEFAULT_VISITOR_KEYS`; `enter` and `leave` default
	 * to doing nothing.
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
	 * @param {unknown} node The current node. Anything that is not a node is
	 * skipped, since children are read off arbitrary visitor keys.
	 * @param {ASTNode | null} parent The parent node.
	 * @returns {void}
	 * @private
	 */
	_traverse(node, parent) {
		if (!isNode(node)) {
			return;
		}

		/*
		 * The three slots below are `null` only before the first `traverse`,
		 * which assigns all of them and is the only way into this recursion.
		 *
		 * Each cast wraps the member expression and nothing more. That is
		 * deliberate: parentheses around a member expression preserve the
		 * reference, so `(this._enter)(node, parent)` still calls the visitor
		 * as a method. Hoisting it into a local would drop the `this` binding
		 * that visitors calling `this.break()` depend on.
		 */
		this._current = node;
		this._skipped = false;
		/** @type {TraverserVisitor} */ (this._enter)(node, parent);

		if (!this._skipped && !this._broken) {
			const keys = getVisitorKeys(
				/** @type {VisitorKeys} */ (this._visitorKeys),
				node,
			);

			if (keys.length >= 1) {
				this._parents.push(node);

				/*
				 * Children are looked up by visitor key, which no node
				 * interface can carry an index signature for. The traversal is
				 * value-driven from here on: `isNode` re-checks every child.
				 */
				const children = /** @type {Record<string, unknown>} */ (
					/** @type {unknown} */ (node)
				);

				for (let i = 0; i < keys.length && !this._broken; ++i) {
					const child = children[keys[i]];

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
			/** @type {TraverserVisitor} */ (this._leave)(node, parent);
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
	 * @param {TraverserOptions} options The option object. `visitorKeys`
	 * defaults to `Traverser.DEFAULT_VISITOR_KEYS`; `enter` and `leave` default
	 * to doing nothing.
	 * @returns {void}
	 */
	static traverse(node, options) {
		new Traverser().traverse(node, options);
	}

	/**
	 * The default visitor keys.
	 * @returns {VisitorKeys} The keys `eslint-visitor-keys` ships.
	 */
	static get DEFAULT_VISITOR_KEYS() {
		return vk.KEYS;
	}
}

module.exports = Traverser;

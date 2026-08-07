// @ts-check
/**
 * @fileoverview `Map` to load rules lazily.
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

const debug = require("debug")("eslint:rules");

/**
 * The `Map` object that loads each rule when it's accessed.
 *
 * ESCAPE HATCH: the base class is typed `Map<string, any>` rather than
 * `Map<string, () => Rule>`. Reason: this class deliberately breaks the `Map`
 * contract — it stores loader thunks but hands back loaded rules, so `get`,
 * `values`, `entries` and `forEach` all have a return type that differs from
 * the stored value type. `Map<K, V>` has one type parameter for both the read
 * and the write side, so there is no instantiation under which these overrides
 * are compatible. Widening the base to `any` confines the imprecision to the
 * inherited members; every member declared below is fully typed, so callers
 * see `Rule`, not `any`.
 * @example
 * const rules = new LazyLoadingRuleMap([
 *     ["eqeqeq", () => require("eqeqeq")],
 *     ["semi", () => require("semi")],
 *     ["no-unused-vars", () => require("no-unused-vars")]
 * ]);
 *
 * rules.get("semi"); // call `() => require("semi")` here.
 *
 * @template Rule The rule type this map yields.
 * @extends {Map<string, any>}
 */
class LazyLoadingRuleMap extends Map {
	/**
	 * Initialize this map.
	 * @param {[string, () => Rule][]} loaders The rule loaders.
	 */
	constructor(loaders) {
		let remaining = loaders.length;

		super(
			debug.enabled
				? loaders.map(([ruleId, load]) => {
						/** @type {Rule | null} */
						let cache = null;

						return [
							ruleId,
							() => {
								if (!cache) {
									debug(
										"Loading rule %o (remaining=%d)",
										ruleId,
										--remaining,
									);
									cache = load();
								}
								return cache;
							},
						];
					})
				: loaders,
		);

		// `super(...iterable)` uses `this.set()`, so disable it here.
		Object.defineProperty(LazyLoadingRuleMap.prototype, "set", {
			configurable: true,
			value: void 0,
		});
	}

	/**
	 * Get a rule.
	 * Each rule will be loaded on the first access.
	 * @param {string} ruleId The rule ID to get.
	 * @returns {Rule | undefined} The rule.
	 */
	get(ruleId) {
		const load = super.get(ruleId);

		return load && load();
	}

	/**
	 * Iterate rules.
	 * @returns {MapIterator<Rule>} Rules.
	 */
	*values() {
		for (const load of super.values()) {
			yield load();
		}
	}

	/**
	 * Iterate rules.
	 * @returns {MapIterator<[string, Rule]>} Rules.
	 */
	*entries() {
		for (const [ruleId, load] of super.entries()) {
			yield [ruleId, load()];
		}
	}

	/**
	 * Call a function with each rule.
	 * @param {(rule: Rule, ruleId: string, map: LazyLoadingRuleMap<Rule>) => void} callbackFn The callback function.
	 * @param {any} [thisArg] The object to pass to `this` of the callback function.
	 */
	forEach(callbackFn, thisArg) {
		for (const [ruleId, load] of super.entries()) {
			callbackFn.call(thisArg, load(), ruleId, this);
		}
	}
}

// Forbid mutation.
Object.defineProperties(LazyLoadingRuleMap.prototype, {
	clear: { configurable: true, value: void 0 },
	delete: { configurable: true, value: void 0 },
	[Symbol.iterator]: {
		configurable: true,
		writable: true,
		value: LazyLoadingRuleMap.prototype.entries,
	},
});

module.exports = { LazyLoadingRuleMap };

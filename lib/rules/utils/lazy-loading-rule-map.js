/**
 * @fileoverview `Map` to load rules lazily.
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

const debug = require("debug")("eslint:rules");

/**
 * The `Map` object that loads each rule when it's accessed.
 * @example
 * const rules = new LazyLoadingRuleMap([
 *     ["eqeqeq", () => require("eqeqeq")],
 *     ["semi", () => require("semi")],
 *     ["no-unused-vars", () => require("no-unused-vars")]
 * ]);
 *
 * rules.get("semi"); // call `() => require("semi")` here.
 *
 * @extends
 */
class LazyLoadingRuleMap extends Map {
	/**
	 * Initialize this map.
	 * @param loaders The rule loaders.
	 */
	constructor(loaders) {
		let remaining = loaders.length;

		super(
			debug.enabled
				? loaders.map(([ruleId, load]) => {
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
	 * @param ruleId The rule ID to get.
	 * @returns The rule.
	 */
	get(ruleId) {
		const load = super.get(ruleId);

		return load && load();
	}

	/**
	 * Iterate rules.
	 * @returns Rules.
	 */
	*values() {
		for (const load of super.values()) {
			yield load();
		}
	}

	/**
	 * Iterate rules.
	 * @returns Rules.
	 */
	*entries() {
		for (const [ruleId, load] of super.entries()) {
			yield [ruleId, load()];
		}
	}

	/**
	 * Call a function with each rule.
	 * @param callbackFn The callback function.
	 * @param [thisArg] The object to pass to `this` of the callback function.
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

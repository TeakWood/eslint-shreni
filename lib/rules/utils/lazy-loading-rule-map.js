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
 * The base is instantiated with the type callers READ (`Map<string, Rule>`)
 * even though the backing store holds `() => Rule` loader thunks, because
 * `Map<K, V>` has a single type parameter serving both the read and the write
 * side and no instantiation describes both. `Map<string, () => Rule>` would
 * hand `get`, `values`, `entries`, `forEach` AND the inherited
 * `[Symbol.iterator]` a wrong type at every call site; `Map<string, Rule>`
 * misdescribes only the backing store, which is private to this file. The five
 * places that touch that store — the constructor plus the four readers — each
 * carry a documented assertion to bridge the two, which is the trade worth
 * making: the imprecision stays inside this file and callers see `Rule`.
 *
 * Two things inherited from `Map` stay wrong no matter how this class is
 * annotated, because they are not declared here:
 *
 * - `set`, `clear` and `delete` are POISONED to `undefined` on the prototype
 *   by the `Object.defineProperty` calls below, so calling any of them throws
 *   `TypeError` while `Map` still declares them callable. Redeclaring them as
 *   `undefined` is rejected outright (TS2415: a subclass member must remain
 *   assignable to the base's), so the write half of the contract cannot be
 *   stated. Only the read half can, and this class exists to be read.
 * - `[Symbol.iterator]` is re-pointed at `entries`, so iterating yields
 *   RESOLVED rules. That is the one poisoned member the base type gets right,
 *   and only because the base is instantiated with `Rule`; under
 *   `Map<string, () => Rule>` — or under the `Map<string, any>` this file
 *   previously used — `for (const [id, rule] of rules)` would type `rule` as a
 *   thunk or as `any` respectively.
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
 * @extends {Map<string, Rule>}
 */
class LazyLoadingRuleMap extends Map {
	/**
	 * Initialize this map.
	 * @param {[string, () => Rule][]} loaders The rule loaders.
	 */
	constructor(loaders) {
		let remaining = loaders.length;

		super(
			/*
			 * ESCAPE HATCH: what goes into the backing store is a loader
			 * thunk, but the base is declared with the type callers read.
			 * `Rule` is an unconstrained type parameter, so `() => Rule` and
			 * `Rule` are unrelated and the bridge has to step through
			 * `unknown`.
			 */
			/** @type {[string, Rule][]} */ (
				/** @type {unknown} */ (
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
						: loaders
				)
			),
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
		/*
		 * ESCAPE HATCH: `super.get` is declared to return the READ type, so
		 * the assertion restores what the backing store actually holds. See
		 * the class comment for why the base is instantiated that way.
		 */
		const load = /** @type {(() => Rule) | undefined} */ (
			/** @type {unknown} */ (super.get(ruleId))
		);

		return load && load();
	}

	/**
	 * Iterate rules.
	 * @returns {MapIterator<Rule>} Rules.
	 */
	*values() {
		/*
		 * ESCAPE HATCH: as in `get` — the backing store yields loader thunks,
		 * so the assertion restores what is really in it.
		 */
		const loaders = /** @type {MapIterator<() => Rule>} */ (
			/** @type {unknown} */ (super.values())
		);

		for (const load of loaders) {
			yield load();
		}
	}

	/**
	 * Iterate rules.
	 * @returns {MapIterator<[string, Rule]>} Rules.
	 */
	*entries() {
		/*
		 * ESCAPE HATCH: as in `get` — the backing store yields loader thunks,
		 * so the assertion restores what is really in it.
		 */
		const loaders = /** @type {MapIterator<[string, () => Rule]>} */ (
			/** @type {unknown} */ (super.entries())
		);

		for (const [ruleId, load] of loaders) {
			yield [ruleId, load()];
		}
	}

	/**
	 * Call a function with each rule.
	 * @param {(rule: Rule, ruleId: string, map: LazyLoadingRuleMap<Rule>) => void} callbackFn The callback function.
	 * @param {any} [thisArg] The object to pass to `this` of the callback function.
	 */
	forEach(callbackFn, thisArg) {
		/*
		 * ESCAPE HATCH: as in `get` — the backing store yields loader thunks,
		 * so the assertion restores what is really in it.
		 */
		const loaders = /** @type {MapIterator<[string, () => Rule]>} */ (
			/** @type {unknown} */ (super.entries())
		);

		for (const [ruleId, load] of loaders) {
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

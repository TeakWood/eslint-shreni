/**
 * @fileoverview Ambient declarations for runtime dependencies that ship no
 * types of their own and have no `@types/*` package.
 *
 * ESCAPE HATCH. Each declaration here is a hand-written stand-in for a
 * dependency's real types, so it is exactly the kind of drift risk the rest of
 * this project exists to remove. Keep every declaration minimal — declare only
 * the surface ESLint actually calls, so an upstream change to anything else
 * cannot silently invalidate what we wrote. Delete a block the moment the
 * dependency ships its own types.
 */

/**
 * Reason: `imurmurhash` has no bundled types and no `@types/imurmurhash` on
 * npm. Used by `lib/cli-engine/hash.js` only, via the functional form.
 */
declare module "imurmurhash" {
	interface MurmurHash3 {
		/** Incrementally hashes more text into the current state. */
		hash(value: string): MurmurHash3;

		/** Returns the 32-bit hash of everything hashed so far. */
		result(): number;

		/** Resets the state, optionally to a new seed. */
		reset(seed?: number): MurmurHash3;
	}

	/** Creates a hasher, optionally seeding it with an initial string. */
	function murmurHash3(value?: string, seed?: number): MurmurHash3;

	export = murmurHash3;
}

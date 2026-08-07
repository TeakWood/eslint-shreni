// @ts-check
/**
 * @fileoverview A deliberately broken annotated source.
 *
 * This is the vacuity guard for `tests/lib/types/include-traversal.js`. That
 * suite proves un-annotated files produce no errors; on its own that proves
 * nothing, because a compiler that checks nothing at all would also produce no
 * errors. This file is checked under the same options and MUST report an
 * error, which is what makes the other result meaningful.
 *
 * Compiler input only — nothing requires this at runtime.
 * @author Silpi
 */

"use strict";

/**
 * @param {number} count A number.
 * @returns {number} The number, unchanged.
 */
function identity(count) {
	return count;
}

// Deliberate: `string` is not assignable to `number`.
module.exports = identity("not a number");

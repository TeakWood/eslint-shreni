// @ts-check
/**
 * @fileoverview Stands in for the next annotated source added to the
 * `tsconfig.json` allowlist.
 *
 * It carries the `// @ts-check` pragma and requires `lib/rules/utils/ast-utils.js`,
 * which is NOT annotated and NOT in the allowlist. TypeScript pulls a required
 * file into the program whether or not it is a root file, so this is the exact
 * shape of the trap: the allowlist selects roots, import traversal selects the
 * rest.
 *
 * Used by `tests/lib/types/include-traversal.js`. Nothing requires this at
 * runtime — it is compiler input only.
 * @author Silpi
 */

"use strict";

const astUtils = require("../../../../lib/rules/utils/ast-utils.js");

module.exports = { astUtils };

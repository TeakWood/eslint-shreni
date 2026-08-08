// @ts-check
/**
 * @fileoverview Main package entrypoint.
 * @author Nicholas C. Zakas
 */

"use strict";

const { name, version } = require("../package.json");

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/*
 * Cast rather than shorthand: with shorthand, declaration emit re-exports the
 * `../package.json` import binding, and that specifier does not resolve from
 * the emitted `.d.ts`. Casting forces the declaration to state `string`
 * instead.
 */
const meta = {
	name: /** @type {string} */ (name),
	version: /** @type {string} */ (version),
};

const configs = {
	all: require("./configs/eslint-all"),
	recommended: require("./configs/eslint-recommended"),
};

/*
 * Bound to locals and assigned with shorthand rather than built inline. Node
 * detects the named exports a CommonJS module offers to ESM importers with
 * `cjs-module-lexer`, which is a static scan: it recognises shorthand over a
 * binding but not an inline object literal whose values are expressions. Built
 * inline, `import { configs } from "@eslint/js"` type-checks and then throws
 * `SyntaxError: Named export 'configs' not found` at runtime — the
 * `NamedExports` problem `npm run test:types:packaged` reports.
 */
module.exports = { meta, configs };

/**
 * @fileoverview exports for config helpers
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {typeof import("@eslint/config-helpers")} ConfigHelpers */

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

/*
 * The re-exports below are annotated rather than left to inference, and the
 * reason is what tsc writes into the declaration rather than a matter of
 * taste. Inferred, each one emits an `import` of a path *relative to this
 * repository's* node_modules -- `../node_modules/@eslint/config-helpers/...`
 * -- which resolves to nothing once `dist/types` is published on its own.
 * Naming the package keeps the specifier bare, so a consumer resolves it
 * through their own installed copy.
 */
const helpers = /** @type {ConfigHelpers} */ (
	require("@eslint/config-helpers")
);

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/** @type {ConfigHelpers["defineConfig"]} */
const defineConfig = helpers.defineConfig;

/** @type {ConfigHelpers["globalIgnores"]} */
const globalIgnores = helpers.globalIgnores;

/** @type {ConfigHelpers["includeIgnoreFile"]} */
const includeIgnoreFile = helpers.includeIgnoreFile;

module.exports = {
	defineConfig,
	globalIgnores,
	includeIgnoreFile,
};

// @ts-check
/**
 * @fileoverview Default configuration
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const Rules = require("../rules");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").ConfigObject} ConfigObject */
/** @typedef {import("../shared/types.js").RuleModule} RuleModule */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/** @type {ConfigObject[]} */
const sharedDefaultConfig = [
	// intentionally empty config to ensure these files are globbed by default
	{
		files: ["**/*.js", "**/*.mjs"],
	},
	{
		files: ["**/*.cjs"],
		languageOptions: {
			sourceType: "commonjs",
			ecmaVersion: "latest",
		},
	},
];

/**
 * The config objects ESLint prepends to every config array: the `@` plugin
 * carrying the built-in rules and the `js` language, the default ignores, and
 * the file patterns that make `.js`, `.mjs` and `.cjs` lintable by default.
 * @type {readonly ConfigObject[]}
 */
exports.defaultConfig = Object.freeze([
	{
		plugins: {
			"@": {
				languages: {
					js: require("../languages/js"),
				},

				/*
				 * Because we try to delay loading rules until absolutely
				 * necessary, a proxy allows us to hook into the lazy-loading
				 * aspect of the rules map while still keeping all of the
				 * relevant configuration inside of the config array.
				 */
				rules: new Proxy(
					/*
					 * The target is empty because the traps below serve every
					 * lookup; `RuleModule` is what they return, so that is
					 * what the proxy presents.
					 */
					/** @type {Record<string, RuleModule>} */ ({}),
					{
						get(target, property) {
							return Rules.get(property);
						},

						has(target, property) {
							return Rules.has(property);
						},
					},
				),
			},
		},
		language: "@/js",
		linterOptions: {
			reportUnusedDisableDirectives: 1,
		},
	},

	// default ignores are listed here
	{
		ignores: ["**/node_modules/", ".git/"],
	},

	...sharedDefaultConfig,
]);

/**
 * The config objects `RuleTester` prepends instead of {@link defaultConfig}. It
 * supplies no plugin or language of its own, because the tester builds those
 * from the rule under test.
 * @type {readonly ConfigObject[]}
 */
exports.defaultRuleTesterConfig = Object.freeze([
	{ files: ["**"] }, // Make sure the default config matches for all files

	...sharedDefaultConfig,
]);

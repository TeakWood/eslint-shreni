/**
 * @fileoverview Type-level tests for the `lib/config/` annotations.
 *
 * The modules in `lib/config/` define the shapes an end-user config file is
 * written against, so these tests assert what those annotations actually accept
 * and reject rather than that the tags are present. Each one type-checks a
 * probe module through the real `tsconfig.json`, so it fails if a later change
 * loosens a shape.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert;

const {
	formatDiagnostics,
	typeCheckProbe,
} = require("../../_utils/type-probe");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/*
 * The probe sits inside `lib/config/`, so it reaches the modules under test
 * through the same relative paths they use on each other. It never touches the
 * source tree: `typeCheckProbe()` serves it from memory.
 */
const PROBE_PATH = "lib/config/__type-probe__.js";

/**
 * Type-checks a probe module as if it sat in `lib/config/`.
 * @param {string[]} lines The probe's lines, joined with newlines.
 * @returns {readonly import("typescript").Diagnostic[]} The probe's diagnostics.
 */
function checkProbe(lines) {
	return typeCheckProbe(['"use strict";', ...lines].join("\n"), PROBE_PATH);
}

/**
 * Asserts that a probe type-checks cleanly.
 * @param {string[]} lines The probe's lines.
 * @param {string} message The assertion message.
 * @returns {void}
 */
function assertAccepts(lines, message) {
	const diagnostics = checkProbe(lines);

	assert.strictEqual(
		diagnostics.length,
		0,
		`${message}:\n${formatDiagnostics(diagnostics)}`,
	);
}

/**
 * Asserts that a probe is rejected.
 * @param {string[]} lines The probe's lines.
 * @param {string} message The assertion message.
 * @returns {void}
 */
function assertRejects(lines, message) {
	assert.isNotEmpty(checkProbe(lines), message);
}

/**
 * Wraps an expression in the annotated-binding form that tsc checks.
 * @param {string} typeName The type from the shared hub to constrain it to.
 * @param {string} body The expression, without a trailing semicolon.
 * @returns {string[]} The probe's lines.
 */
function hubBinding(typeName, body) {
	return [
		`/** @type {import("../shared/types.js").${typeName}} */`,
		`const value = ${body};`,
		"",
		"module.exports = value;",
	];
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("config types", () => {
	describe("`ConfigObject`", () => {
		it("should accept a config object with every key set", () => {
			assertAccepts(
				hubBinding(
					"ConfigObject",
					`{
						name: "my-config",
						basePath: "src",
						files: ["**/*.js"],
						ignores: ["**/*.min.js"],
						language: "@/js",
						languageOptions: { ecmaVersion: 2022 },
						linterOptions: { noInlineConfig: true },
						processor: "md/markdown",
						plugins: {},
						rules: { semi: "error" },
						settings: { shared: true },
					}`,
				),
				"a fully-populated config object should satisfy `ConfigObject`",
			);
		});

		it("should accept a config object that sets no keys at all", () => {
			assertAccepts(
				hubBinding("ConfigObject", "{}"),
				"every key is optional, because a config object contributes only what it sets",
			);
		});

		it("should reject an eslintrc-style key", () => {
			/*
			 * `flat-config-schema.js` declares these keys only to throw a
			 * helpful error for them, so they are deliberately not part of the
			 * shape a config file is written against.
			 */
			assertRejects(
				hubBinding("ConfigObject", "{ env: { browser: true } }"),
				"`env` is eslintrc-only and should not be assignable",
			);
		});

		it("should type `language` as a plugin member name rather than a language object", () => {
			/*
			 * This is the distinction that makes the `Config` class's own
			 * `language` differ from the input config's: the constructor
			 * resolves the string to the object. `ConfigWithCopiedKeys` has to
			 * omit the key for that reason.
			 */
			assertRejects(
				hubBinding(
					"ConfigObject",
					"{ language: { validateLanguageOptions() {} } }",
				),
				'`language` should be the `"plugin/name"` string, not the resolved language',
			);
		});

		it("should reject a rule configured with an out-of-range severity", () => {
			assertRejects(
				hubBinding("ConfigObject", '{ rules: { semi: "fatal" } }'),
				'"fatal" is not a severity and should be rejected',
			);
		});
	});

	describe("`Plugin`", () => {
		it("should accept a plugin carrying rules, languages and processors", () => {
			assertAccepts(
				hubBinding(
					"Plugin",
					`{
						meta: { name: "eslint-plugin-example", version: "1.0.0" },
						rules: {
							"my-rule": {
								meta: { type: "problem" },
								create: () => ({}),
							},
						},
						languages: {
							custom: { validateLanguageOptions() {} },
						},
						processors: {
							custom: {
								preprocess: () => [],
								postprocess: () => [],
							},
						},
					}`,
				),
				"a plugin should accept each of the members a config may reference",
			);
		});

		it("should require a rule the plugin provides to be a real rule", () => {
			assertRejects(
				hubBinding("Plugin", '{ rules: { "my-rule": { meta: {} } } }'),
				"a rule without `create()` should not satisfy `Plugin.rules`",
			);
		});
	});

	describe("`RuleMetaData.languages`", () => {
		/*
		 * `lib/config/config.js` reads and validates `meta.languages`, so the
		 * hub has to declare it; it is documented in
		 * `docs/src/extend/custom-rules.md`.
		 */
		it("should accept an array of plugin member names", () => {
			assertAccepts(
				hubBinding(
					"RuleModule",
					'{ meta: { languages: ["js/js", "markdown/*", "*"] }, create: () => ({}) }',
				),
				"`meta.languages` should accept the documented entry forms",
			);
		});

		it("should reject a single language name written as a string", () => {
			assertRejects(
				hubBinding(
					"RuleModule",
					'{ meta: { languages: "js/js" }, create: () => ({}) }',
				),
				"`meta.languages` is an array, so a bare string should be rejected",
			);
		});
	});

	describe("`ESLintError`", () => {
		it("should allow a templated message to be attached to a constructed error", () => {
			assertAccepts(
				[
					'/** @type {import("../shared/types.js").ESLintError} */',
					'const error = new TypeError("boom");',
					"",
					'error.messageTemplate = "config-file-missing";',
					'error.messageData = { pluginName: "@" };',
					"",
					"module.exports = error;",
				],
				"`messageTemplate` and `messageData` should be assignable",
			);
		});

		it("should not add the fields to a plain error", () => {
			/*
			 * The pin that keeps the typedef worth having: without the
			 * assertion at the construction site, the assignment is an error.
			 */
			assertRejects(
				[
					'const error = new TypeError("boom");',
					"",
					'error.messageTemplate = "config-file-missing";',
					"",
					"module.exports = error;",
				],
				"a plain `Error` should not accept `messageTemplate`",
			);
		});
	});

	describe("`ConfigLoaderOptions`", () => {
		it("should accept `null` for the three options its caller defaults to `null`", () => {
			/*
			 * `processOptions()` in `lib/eslint/eslint-helpers.js` defaults
			 * `baseConfig`, `ignorePatterns` and `overrideConfig` to `null`
			 * rather than omitting them, and the loader reads `null` as
			 * "none". Narrowing these to present-or-absent would force the
			 * caller into three casts when `lib/eslint/` is annotated.
			 */
			assertAccepts(
				[
					'const { ConfigLoader } = require("./config-loader.js");',
					"",
					"module.exports = new ConfigLoader({",
					'	cwd: "/tmp",',
					"	baseConfig: null,",
					"	ignorePatterns: null,",
					"	overrideConfig: null,",
					"});",
				],
				"`null` should be accepted for all three",
			);
		});

		it("should require `cwd`, which every path the loader resolves is relative to", () => {
			assertRejects(
				[
					'const { ConfigLoader } = require("./config-loader.js");',
					"",
					"module.exports = new ConfigLoader({});",
				],
				"`cwd` should be required",
			);
		});

		it("should accept `false` for `configFile`, which means use no config file", () => {
			assertAccepts(
				[
					'const { ConfigLoader } = require("./config-loader.js");',
					"",
					'module.exports = new ConfigLoader({ cwd: "/tmp", configFile: false });',
				],
				"`configFile: false` should be accepted",
			);
		});
	});

	describe("the built-in rules map", () => {
		it("should expose the `Map` members `defaultConfig`'s rules proxy calls", () => {
			/*
			 * `lib/rules/utils/lazy-loading-rule-map.js` carried an `@extends`
			 * tag with no type, which tsc read as an unresolved heritage
			 * clause and which erased every inherited `Map` member -- so
			 * `Rules.has()` in the proxy below failed to type-check even
			 * though the class really does extend `Map`.
			 */
			assertAccepts(
				[
					'const Rules = require("../rules");',
					"",
					"module.exports = new Proxy(",
					"	{},",
					"	{",
					"		get: (target, property) => Rules.get(property),",
					"		has: (target, property) => Rules.has(property),",
					"	},",
					");",
				],
				"the rules map should expose `get()` and `has()`",
			);
		});
	});
});

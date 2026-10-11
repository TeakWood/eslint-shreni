// @ts-check
/**
 * @fileoverview Mocha/Jest test wrapper
 * @author Ilya Volodin
 */
"use strict";

/* globals describe, it -- Mocha globals */

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("node:assert"),
	{ existsSync, readFileSync } = require("node:fs"),
	util = require("node:util"),
	path = require("node:path"),
	equal = require("fast-deep-equal"),
	Traverser = require("../shared/traverser"),
	{ Config } = require("../config/config"),
	{ Linter, SourceCodeFixer } = require("../linter"),
	{ interpolate, getPlaceholderMatcher } = require("../linter/interpolate"),
	stringify = require("json-stable-stringify-without-jsonify"),
	{ isSerializable } = require("../shared/serialization");

const { FlatConfigArray } = require("../config/flat-config-array");
const {
	defaultConfig,
	defaultRuleTesterConfig,
} = require("../config/default-config");

const ajv = require("../shared/ajv")({ strictDefaults: true });

const parserSymbol = Symbol.for("eslint.RuleTester.parser");
const { ConfigArraySymbol } = require("@eslint/config-array");

const jslang = require("../languages/js");
const { SourceCode } = require("../languages/js/source-code");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").ConfigObject} ConfigObject */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../shared/types.js").Plugin} Plugin */
/** @typedef {import("../shared/types.js").RuleModule} RuleModule */
/** @typedef {import("../shared/types.js").SuggestionResult} SuggestionResult */
/** @typedef {import("../shared/traverser.js").TraversableNode} TraversableNode */
/** @typedef {import("../shared/traverser.js").VisitorKeys} VisitorKeys */

/**
 * An AST as a parser returns it, carrying the token and comment lists that
 * `defineStartEndAsErrorInTree()` walks alongside the nodes themselves.
 * @typedef {TraversableNode & { tokens: object[], comments: object[] }} ParsedAST
 */

/**
 * What a parser's `parseForESLint()` returns. Only the two keys the tester
 * reads are declared; a parser may return more.
 * @typedef {Object} ParseForESLintResult
 * @property {ParsedAST} ast The AST for the parsed code.
 * @property {VisitorKeys} [visitorKeys] The visitor keys for the AST, for a parser that produces non-standard node types.
 */

/**
 * A parser, as `languageOptions.parser` resolves to.
 *
 * ESLint requires a parser to provide exactly one of the two methods, but both
 * are optional here because `wrapParser()` is the code that picks between them
 * by probing for `parseForESLint`.
 * @typedef {Object} TestParser
 * @property {(...args: any[]) => ParsedAST} [parse] Parses code into an AST.
 * @property {(...args: any[]) => ParseForESLintResult} [parseForESLint] Parses code into an AST plus the extra information ESLint can use.
 */

/**
 * A parser as `wrapParser()` returns it: the methods of the parser it wraps,
 * plus that parser itself recorded under `parserSymbol` so `lib/languages/js/`
 * can still recognize espree through the wrapper.
 *
 * JSDoc has no syntax for declaring a single symbol-keyed property, so the slot
 * is declared as a symbol index signature.
 * @typedef {TestParser & Record<symbol, TestParser>} WrappedParser
 */

/**
 * The source location of the `RuleTester` method that was called, recovered
 * from the stack at the moment of the call.
 * @typedef {Object} InvocationLocation
 * @property {string} sourceFile The path to the file the call was made from, or a description of the eval origin when there is no file.
 * @property {number} sourceLine The 1-based line number of the call.
 * @property {number} sourceColumn The 1-based column number of the call.
 */

/**
 * One of the functions a test framework provides, as `RuleTester` calls it.
 *
 * `only` is the exclusive variant Mocha and Vitest hang off `it`; a framework
 * need not provide it, and `RuleTester.itOnly` throws when it is missing.
 * @typedef {{ (text: string, method: () => void): unknown, only?: (text: string, method: () => void) => unknown }} TestFrameworkMethod
 */

/**
 * The `assertionOptions` of a test scenario: the extra requirements a test
 * scenario can place on its own test cases.
 * @typedef {Object} AssertionOptions
 * @property {false | "message" | "messageId"} [requireMessage] Which of the two message properties every expected error must specify. `false` to require neither.
 * @property {boolean} [requireLocation] `true` to require every expected error to specify every location property the reported message has.
 * @property {boolean | "error" | "suggestion"} [requireData] Which kinds of expected message must specify `data` when the referenced message has placeholders. `true` for both.
 */

/**
 * A suggestion an expected error says the rule should offer.
 * @typedef {Object} SuggestionTestCase
 * @property {string} [desc] The expected description of the suggestion. Use this or `messageId`.
 * @property {string} [messageId] The expected ID of the message in the rule's meta that produced the description.
 * @property {Record<string, unknown>} [data] The placeholder values the description is expected to have been interpolated from. Requires `messageId`.
 * @property {string} output The source text the suggestion is expected to produce.
 */

/**
 * An expected error, written as an object so that it can assert more than the
 * message.
 * @typedef {Object} TestCaseErrorObject
 * @property {string | RegExp} [message] The expected message, or a pattern it must match. Use this or `messageId`.
 * @property {string} [messageId] The expected ID of the message in the rule's meta.
 * @property {Record<string, unknown>} [data] The placeholder values the message is expected to have been interpolated from. Requires `messageId`.
 * @property {number} [line] The expected 1-based line number of the start of the message.
 * @property {number} [column] The expected 1-based column number of the start of the message.
 * @property {number} [endLine] The expected 1-based line number of the end of the message.
 * @property {number} [endColumn] The expected 1-based column number of the end of the message.
 * @property {number | SuggestionTestCase[]} [suggestions] The expected suggestions, or how many of them there should be. An empty array asserts that there are none.
 */

/**
 * An error an invalid test case expects the rule to report: just the message,
 * a pattern the message must match, or an object asserting more than that.
 * @typedef {string | RegExp | TestCaseErrorObject} TestCaseError
 */

/**
 * The properties of a test case that configure the tester rather than the lint
 * run. Everything else on a test case is treated as a config object, which is
 * why these names are also listed in `RuleTesterParameters`.
 * @typedef {Object} TestCaseProperties
 * @property {string} [name] The name to give the test case in the test framework's output. Defaults to `code`.
 * @property {string} code The source text to lint.
 * @property {string} [filename] The filename to lint the source text as.
 * @property {any[]} [options] The options to pass to the rule under test.
 * @property {() => void} [before] A hook to run before the test case.
 * @property {() => void} [after] A hook to run after the test case, whether or not it passed.
 * @property {boolean} [only] `true` to run this test case in isolation.
 */

/**
 * A test case the rule should report nothing for. Any key that is not one of
 * {@link TestCaseProperties} is treated as a config object for this one case.
 * @typedef {ConfigObject & TestCaseProperties} ValidTestCase
 */

/**
 * A test case the rule should report `errors` for.
 * @typedef {ValidTestCase & { errors: number | TestCaseError[], output?: string | null }} InvalidTestCase
 */

/**
 * A test case as written, before the tester has checked its shape.
 *
 * The assertion helpers take this rather than `ValidTestCase` or
 * `InvalidTestCase`, because their whole job is to reject the cases that do not
 * conform to those: a valid case must carry neither `errors` nor `output`, and
 * an invalid one must carry `errors`.
 * @typedef {ValidTestCase & { errors?: number | TestCaseError[], output?: string | null }} UncheckedTestCase
 */

/**
 * The collection of test cases `RuleTester#run()` runs for one rule.
 * @typedef {Object} TestScenarios
 * @property {(string | ValidTestCase)[]} valid The cases the rule should report nothing for. A bare string is shorthand for `{ code }`.
 * @property {(string | InvalidTestCase)[]} invalid The cases the rule should report errors for.
 * @property {AssertionOptions} [assertionOptions] The extra requirements to place on every case in this scenario.
 */

/**
 * What `runRuleForItem()` hands back: the outcome of linting one test case.
 * @typedef {Object} RuleRunResult
 * @property {LintMessage[]} messages The messages the lint run reported.
 * @property {string} output The source text with the rule's fixes applied, or `code` when it reported none.
 * @property {any} beforeAST The AST as it was before the rule under test ran, deep-cloned.
 * @property {any} afterAST The AST as it was after the rule under test ran, deep-cloned.
 * @property {import("../config/flat-config-array.js").FlatConfigArray} configs The config array the case was linted with.
 * @property {string | undefined} filename The filename the case was linted as, if it set one.
 */

/**
 * An `Error` the tester has tagged with where in the scenario it came from, so
 * that the stack it rewrites can name the test case and the expected error.
 * @typedef {Error & { scenarioType?: "valid" | "invalid", scenarioIndex?: number, errorIndex?: number }} TaggedTestError
 */

/**
 * A view of the `RuleTester` constructor that admits its symbol-keyed static
 * slots.
 *
 * A static setter that writes one of them (`this[IT] = value`) is read as a
 * second declaration of a member whose emitted name is `__computed`, which
 * collides with the other two setters and with the assignment at the bottom of
 * this file (TS2323). Writing through this view leaves that assignment as the
 * single declaration of all three.
 * @typedef {typeof RuleTester & Record<symbol, TestFrameworkMethod | null>} RuleTesterSlots
 */

//------------------------------------------------------------------------------
// Private Members
//------------------------------------------------------------------------------

/*
 * testerDefaultConfig must not be modified as it allows to reset the tester to
 * the initial default configuration
 */
/** @type {ConfigObject} */
const testerDefaultConfig = { rules: {} };

/*
 * RuleTester uses this config as its default. This can be overwritten via
 * setDefaultConfig().
 */
/** @type {ConfigObject} */
let sharedDefaultConfig = { rules: {} };

/*
 * List every parameters possible on a test case that are not related to eslint
 * configuration
 */
const RuleTesterParameters = [
	"name",
	"code",
	"filename",
	"options",
	"before",
	"after",
	"errors",
	"output",
	"only",
];

/*
 * All allowed property names in error objects.
 */
const errorObjectParameters = new Set([
	"message",
	"messageId",
	"data",
	"line",
	"column",
	"endLine",
	"endColumn",
	"suggestions",
]);
const friendlyErrorObjectParameterList = `[${[...errorObjectParameters].map(key => `'${key}'`).join(", ")}]`;

/*
 * All allowed property names in suggestion objects.
 */
const suggestionObjectParameters = new Set([
	"desc",
	"messageId",
	"data",
	"output",
]);
const friendlySuggestionObjectParameterList = `[${[...suggestionObjectParameters].map(key => `'${key}'`).join(", ")}]`;

const forbiddenMethods = [
	"applyInlineConfig",
	"applyLanguageOptions",
	"finalize",
];

const forbiddenMethodCalls = new Map(
	forbiddenMethods.map(methodName => [methodName, new WeakSet()]),
);

/**
 * Checks whether a value has an own property, without going through a
 * `hasOwnProperty` the value itself may have shadowed.
 *
 * `Function.call.bind()` erases the bound function's signature, so the shape
 * is restated here rather than inferred.
 * @type {(object: unknown, property: string | number | symbol) => boolean}
 */
const hasOwnProperty = /** @type {any} */ (
	Function.call.bind(Object.hasOwnProperty)
);

/**
 * Clones a given value deeply.
 * Note: This ignores `parent` property.
 * @param {any} x A value to clone. The AST nodes this walks are an arbitrary
 * shape, so every property read would otherwise need its own cast.
 * @returns {any} A cloned value.
 */
function cloneDeeplyExcludesParent(x) {
	if (typeof x === "object" && x !== null) {
		if (Array.isArray(x)) {
			return x.map(cloneDeeplyExcludesParent);
		}

		/** @type {Record<string, any>} */
		const retv = {};

		for (const key in x) {
			if (key !== "parent" && hasOwnProperty(x, key)) {
				retv[key] = cloneDeeplyExcludesParent(x[key]);
			}
		}

		return retv;
	}

	return x;
}

/**
 * Freezes a given value deeply.
 * @param {any} x A value to freeze.
 * @param {Set<unknown>} [seenObjects] Objects already seen during the traversal.
 * @returns {void}
 */
function freezeDeeply(x, seenObjects = new Set()) {
	if (typeof x === "object" && x !== null) {
		if (seenObjects.has(x)) {
			return; // skip to avoid infinite recursion
		}
		seenObjects.add(x);

		if (Array.isArray(x)) {
			x.forEach(element => {
				freezeDeeply(element, seenObjects);
			});
		} else {
			for (const key in x) {
				if (key !== "parent" && hasOwnProperty(x, key)) {
					freezeDeeply(x[key], seenObjects);
				}
			}
		}
		Object.freeze(x);
	}
}

/**
 * Replace control characters by `\u00xx` form.
 * @param {unknown} text The text to sanitize.
 * @returns {string} The sanitized text.
 */
function sanitize(text) {
	if (typeof text !== "string") {
		return "";
	}
	return text.replace(
		/[\u0000-\u0009\u000b-\u001a]/gu, // eslint-disable-line no-control-regex -- Escaping controls
		c =>
			// `c` is a single matched character, so it always has a code point.
			`\\u${/** @type {number} */ (c.codePointAt(0)).toString(16).padStart(4, "0")}`,
	);
}

/**
 * Define `start`/`end` properties as throwing error.
 * @param {string} objName Object name used for error messages.
 * @param {object} node The node to define.
 * @returns {void}
 */
function defineStartEndAsError(objName, node) {
	Object.defineProperties(node, {
		start: {
			get() {
				throw new Error(
					`Use ${objName}.range[0] instead of ${objName}.start`,
				);
			},
			configurable: true,
			enumerable: false,
		},
		end: {
			get() {
				throw new Error(
					`Use ${objName}.range[1] instead of ${objName}.end`,
				);
			},
			configurable: true,
			enumerable: false,
		},
	});
}

/**
 * Define `start`/`end` properties of all nodes of the given AST as throwing error.
 * @param {ParsedAST} ast The root node to errorize `start`/`end` properties.
 * @param {VisitorKeys} [visitorKeys] Visitor keys to be used for traversing the given ast.
 * @returns {void}
 */
function defineStartEndAsErrorInTree(ast, visitorKeys) {
	Traverser.traverse(ast, {
		visitorKeys,
		enter: defineStartEndAsError.bind(null, "node"),
	});
	ast.tokens.forEach(defineStartEndAsError.bind(null, "token"));
	ast.comments.forEach(defineStartEndAsError.bind(null, "token"));
}

/**
 * Wraps the given parser in order to intercept and modify return values from the `parse` and `parseForESLint` methods, for test purposes.
 * In particular, to modify ast nodes, tokens and comments to throw on access to their `start` and `end` properties.
 * @param {TestParser} parser Parser object.
 * @returns {WrappedParser} Wrapped parser object.
 */
function wrapParser(parser) {
	if (typeof parser.parseForESLint === "function") {
		return {
			[parserSymbol]: parser,
			/**
			 * Parses the code, then makes every `start`/`end` property in the
			 * resulting tree throw on access.
			 * @param {...any} args The arguments the language passes through.
			 * @returns {ParseForESLintResult} What the wrapped parser returned.
			 */
			parseForESLint(...args) {
				/*
				 * The `typeof` guard above does not reach into this method, so
				 * the method it selected is stated again here. Keeping the
				 * member expression as the call target preserves the `this`
				 * binding the parser is called with.
				 */
				const ret =
					/** @type {NonNullable<TestParser["parseForESLint"]>} */ (
						parser.parseForESLint
					)(...args);

				defineStartEndAsErrorInTree(ret.ast, ret.visitorKeys);
				return ret;
			},
		};
	}

	return {
		[parserSymbol]: parser,
		/**
		 * Parses the code, then makes every `start`/`end` property in the
		 * resulting tree throw on access.
		 * @param {...any} args The arguments the language passes through.
		 * @returns {ParsedAST} The AST the wrapped parser produced.
		 */
		parse(...args) {
			/*
			 * Reaching here means `parseForESLint` is absent, so `parse` is the
			 * method this parser provides. ESLint requires exactly one of the
			 * two, which is why the typedef declares both optional.
			 */
			const ast = /** @type {NonNullable<TestParser["parse"]>} */ (
				parser.parse
			)(...args);

			defineStartEndAsErrorInTree(ast);
			return ast;
		},
	};
}

/**
 * Function to replace forbidden `SourceCode` methods. Allows just one call per method.
 * @param {string} methodName The name of the method to forbid.
 * @param {Record<string, any>} prototype The prototype with the original method to call.
 * @returns {(this: object, ...args: any[]) => any} The function that throws the error.
 */
function throwForbiddenMethodError(methodName, prototype) {
	const original = prototype[methodName];

	return function (...args) {
		/*
		 * `forbiddenMethodCalls` is keyed by `forbiddenMethods`, which is also
		 * the only source of the names this is called with, so the lookup
		 * always hits.
		 */
		const called = /** @type {WeakSet<object>} */ (
			forbiddenMethodCalls.get(methodName)
		);

		/* eslint-disable no-invalid-this -- needed to operate as a method. */
		if (!called.has(this)) {
			called.add(this);

			return original.apply(this, args);
		}
		/* eslint-enable no-invalid-this -- not needed past this point */

		throw new Error(
			`\`SourceCode#${methodName}()\` cannot be called inside a rule.`,
		);
	};
}

/**
 * Extracts names of {{ placeholders }} from the reported message.
 * @param {string} message Reported message
 * @returns {string[]} Array of placeholder names
 */
function getMessagePlaceholders(message) {
	const matcher = getPlaceholderMatcher();

	return Array.from(message.matchAll(matcher), ([, name]) => name.trim());
}

/**
 * Returns the placeholders in the reported messages but
 * only includes the placeholders available in the raw message and not in the provided data.
 * @param {string} message The reported message
 * @param {string} raw The raw message specified in the rule meta.messages
 * @param {Record<string, unknown>} [data] The passed
 * @returns {string[]} Missing placeholder names
 */
function getUnsubstitutedMessagePlaceholders(message, raw, data = {}) {
	const unsubstituted = getMessagePlaceholders(message);

	if (unsubstituted.length === 0) {
		return [];
	}

	// Remove false positives by only counting placeholders in the raw message, which were not provided in the data matcher or added with a data property
	const known = getMessagePlaceholders(raw);
	const provided = Object.keys(data);

	return unsubstituted.filter(
		name => known.includes(name) && !provided.includes(name),
	);
}

const metaSchemaDescription = `
\t- If the rule has options, set \`meta.schema\` to an array or non-empty object to enable options validation.
\t- If the rule doesn't have options, omit \`meta.schema\` to enforce that no options can be passed to the rule.
\t- You can also set \`meta.schema\` to \`false\` to opt-out of options validation (not recommended).

\thttps://eslint.org/docs/latest/extend/custom-rules#options-schemas
`;

/*
 * Ignored test case properties when checking for test case duplicates.
 */
const duplicationIgnoredParameters = new Set(["name", "errors", "output"]);

/**
 * Normalizes a test case item, ensuring it is an object with a 'code' property.
 * If the item is not an object, it returns an object with the 'code' property set to the item.
 * @param {string | UncheckedTestCase} item The test case item to normalize.
 * @returns {UncheckedTestCase} The normalized test case object.
 */
function normalizeTestCase(item) {
	return item && typeof item === "object" ? item : { code: item };
}

/**
 * Asserts that the `errors` property of an invalid test case is valid.
 * @param {number | TestCaseError[] | undefined} errors The `errors` property of the invalid test case.
 * @param {string} ruleName The name of the rule being tested.
 * @param {AssertionOptions} [assertionOptions] The assertion options for the test case.
 * @returns {void}
 */
function assertErrorsProperty(errors, ruleName, assertionOptions = {}) {
	const isNumber = typeof errors === "number";
	const isArray = Array.isArray(errors);

	if (!isNumber && !isArray) {
		if (errors === void 0) {
			assert.fail(
				`Did not specify errors for an invalid test of ${ruleName}`,
			);
		} else {
			assert.fail(
				`Invalid 'errors' property for invalid test of ${ruleName}: expected a number or an array but got ${
					errors === null ? "null" : typeof errors
				}`,
			);
		}
	}

	const { requireMessage = false, requireLocation = false } =
		assertionOptions;

	if (isArray) {
		assert.ok(
			errors.length !== 0,
			"Invalid cases must have at least one error",
		);

		for (const [number, error] of errors.entries()) {
			if (typeof error === "string" || error instanceof RegExp) {
				// Just an error message.
				assert.ok(
					requireMessage !== "messageId" && !requireLocation,
					`errors[${number}] should be an object when 'assertionOptions.requireMessage' is 'messageId' or 'assertionOptions.requireLocation' is true.`,
				);
			} else if (typeof error === "object" && error !== null) {
				/*
				 * Error object.
				 * This may have a message, messageId, data, line, and/or column.
				 */

				for (const propertyName of Object.keys(error)) {
					assert.ok(
						errorObjectParameters.has(propertyName),
						`Invalid error property name '${propertyName}'. Expected one of ${friendlyErrorObjectParameterList}.`,
					);
				}

				if (requireMessage === "message") {
					assert.ok(
						!hasOwnProperty(error, "messageId") &&
							hasOwnProperty(error, "message"),
						`errors[${number}] should specify 'message' (and not 'messageId') when 'assertionOptions.requireMessage' is 'message'.`,
					);
				} else if (requireMessage === "messageId") {
					assert.ok(
						!hasOwnProperty(error, "message") &&
							hasOwnProperty(error, "messageId"),
						`errors[${number}] should specify 'messageId' (and not 'message') when 'assertionOptions.requireMessage' is 'messageId'.`,
					);
				}

				if (hasOwnProperty(error, "message")) {
					assert.ok(
						!hasOwnProperty(error, "messageId"),
						`errors[${number}] should not specify both 'message' and 'messageId'.`,
					);
					assert.ok(
						!hasOwnProperty(error, "data"),
						`errors[${number}] should not specify both 'data' and 'message'.`,
					);
				} else {
					assert.ok(
						hasOwnProperty(error, "messageId"),
						`errors[${number}] must specify either 'messageId' or 'message'.`,
					);
				}
			} else {
				assert.fail(
					`errors[${number}] must be a string, RegExp, or an object.`,
				);
			}
		}
	} else {
		assert.ok(
			!requireMessage && !requireLocation,
			"Invalid cases must have 'errors' value as an array",
		);
		assert.ok(
			errors > 0,
			"Invalid cases must have 'error' value greater than 0",
		);
	}
}

/**
 * Check if this test case is a duplicate of one we have seen before.
 * @param {UncheckedTestCase} item test case object
 * @param {Set<string>} seenTestCases set of serialized test cases we have seen so far (managed by this function)
 * @returns {void}
 */
function checkDuplicateTestCase(item, seenTestCases) {
	if (!isSerializable(item)) {
		/*
		 * If we can't serialize a test case (because it contains a function, RegExp, etc), skip the check.
		 * This might happen with properties like: options, plugins, settings, languageOptions.parser, languageOptions.parserOptions.
		 */
		return;
	}

	const serializedTestCase = stringify(item, {
		replacer(key, value) {
			// "this" is the currently stringified object --> only ignore top-level properties
			return item !== this || !duplicationIgnoredParameters.has(key)
				? value
				: void 0;
		},
	});

	assert(
		!seenTestCases.has(serializedTestCase),
		"detected duplicate test case",
	);
	seenTestCases.add(serializedTestCase);
}

/**
 * Asserts that a rule is valid.
 * A valid rule must be an object with a `create` method.
 * @param {RuleModule} rule The rule to check.
 * @param {string} ruleName The name of the rule.
 * @throws {assert.AssertionError} If the rule is not valid.
 * @returns {void}
 */
function assertRule(rule, ruleName) {
	assert.ok(
		rule && typeof rule === "object" && typeof rule.create === "function",
		`Rule ${ruleName} must be an object with a \`create\` method`,
	);
}

/**
 * Asserts that a test scenario object is valid.
 * A valid test scenario object must have `valid` and `invalid` properties, both of
 * which must be arrays.
 * @param {TestScenarios} test The test scenario object to check.
 * @param {string} ruleName The name of the rule being tested.
 * @throws {assert.AssertionError} If the test scenario object is not valid.
 * @returns {void}
 */
function assertTest(test, ruleName) {
	assert.ok(
		test && typeof test === "object",
		`Test Scenarios for rule ${ruleName} : Could not find test scenario object`,
	);

	const hasValid = Array.isArray(test.valid);
	const hasInvalid = Array.isArray(test.invalid);

	assert.ok(
		hasValid,
		`Test Scenarios for rule ${ruleName} is invalid: Could not find any valid test scenarios`,
	);

	assert.ok(
		hasInvalid,
		`Test Scenarios for rule ${ruleName} is invalid: Could not find any invalid test scenarios`,
	);
}

/**
 * Asserts that the common properties of a valid/invalid test case have the correct types.
 * @param {UncheckedTestCase} item The test case object to check.
 * @returns {void}
 */
function assertTestCommonProperties(item) {
	assert.ok(
		typeof item.code === "string",
		"Test case must specify a string value for 'code'",
	);

	// optional properties
	if (item.name) {
		assert.ok(
			typeof item.name === "string",
			"Optional test case property 'name' must be a string",
		);
	}
	if (hasOwnProperty(item, "only")) {
		assert.ok(
			typeof item.only === "boolean",
			"Optional test case property 'only' must be a boolean",
		);
	}
	if (hasOwnProperty(item, "filename")) {
		assert.ok(
			typeof item.filename === "string",
			"Optional test case property 'filename' must be a string",
		);
	}
	if (hasOwnProperty(item, "options")) {
		assert.ok(
			Array.isArray(item.options),
			"Optional test case property 'options' must be an array",
		);
	}
}

/**
 * Asserts that a valid test case object is valid.
 * A valid test case must specify a string value for 'code'.
 * Optional properties are checked for correct types.
 * @param {UncheckedTestCase} item The valid test case object to check.
 * @param {Set<string>} seenTestCases Set of serialized test cases to check for duplicates.
 * @throws {assert.AssertionError} If the test case is not valid.
 * @returns {void}
 */
function assertValidTestCase(item, seenTestCases) {
	// must not have properties of invalid test cases
	assert.ok(
		item.errors === void 0,
		"Valid test case must not have 'errors' property",
	);
	assert.ok(
		item.output === void 0,
		"Valid test case must not have 'output' property",
	);

	assertTestCommonProperties(item);
	checkDuplicateTestCase(item, seenTestCases);
}

/**
 * Asserts that the invalid test case object is valid.
 * An invalid test case must specify a string value for 'code' and must have 'errors' property.
 * Optional properties are checked for correct types.
 * @param {UncheckedTestCase} item The invalid test case object to check.
 * @param {Set<string>} seenTestCases Set of serialized test cases to check for duplicates.
 * @param {string} ruleName The name of the rule being tested.
 * @param {AssertionOptions} [assertionOptions] The assertion options for the test case.
 * @throws {assert.AssertionError} If the test case is not valid.
 * @returns {void}
 */
function assertInvalidTestCase(
	item,
	seenTestCases,
	ruleName,
	assertionOptions = {},
) {
	assertTestCommonProperties(item);

	assertErrorsProperty(item.errors, ruleName, assertionOptions);

	// 'output' is optional, but if it exists it must be a string or null
	if (hasOwnProperty(item, "output")) {
		assert.ok(
			item.output === null || typeof item.output === "string",
			"Test property 'output', if specified, must be a string or null. If no autofix is expected, then omit the 'output' property or set it to null.",
		);
	}

	checkDuplicateTestCase(item, seenTestCases);
}

/**
 * Gets the invocation location from the stack trace for later use.
 * @param {Function} relative The function before the invocation point.
 * @returns {InvocationLocation} The invocation location.
 */
function getInvocationLocation(relative = getInvocationLocation) {
	/** @type {{ stack?: string }} */
	const dummyObject = {};
	/** @type {InvocationLocation | undefined} */
	let location;
	const { prepareStackTrace } = Error;
	Error.prepareStackTrace = (_, [callSite]) => {
		location = {
			sourceFile:
				callSite.getFileName() ??
				`${callSite.getEvalOrigin()}, <anonymous>`,
			sourceLine: callSite.getLineNumber() ?? 1,
			sourceColumn: callSite.getColumnNumber() ?? 1,
		};
	};
	Error.captureStackTrace(dummyObject, relative); // invoke Error.prepareStackTrace in Bun
	void dummyObject.stack; // invoke Error.prepareStackTrace in Node.js
	Error.prepareStackTrace = prepareStackTrace;

	/*
	 * One of the two lines above always triggers `prepareStackTrace`, so
	 * `location` is assigned by the time this returns. tsc cannot see an
	 * assignment made from inside a callback it does not call itself.
	 */
	return /** @type {InvocationLocation} */ (location);
}

/**
 * Estimates the location of the test case in the source file.
 * @param {Function} invoker The method that runs the tests.
 * @returns {(key: string) => string} The lazy resolver for the estimated location of the test case.
 */
function buildLazyTestLocationEstimator(invoker) {
	const invocationLocation = getInvocationLocation(invoker);
	/** @type {Record<string, string> | null} */
	let testLocations = null;
	return key => {
		if (testLocations === null) {
			const { sourceFile, sourceLine, sourceColumn } = invocationLocation;
			testLocations = {
				root: `${sourceFile}:${sourceLine}:${sourceColumn}`,
			};

			if (existsSync(sourceFile)) {
				let content = readFileSync(sourceFile, "utf8")
					.split("\n")
					.slice(sourceLine - 1);
				content[0] = content[0].slice(Math.max(0, sourceColumn - 1));
				content = content.map(
					l =>
						l
							.trim() // Remove whitespace
							.replace(/\s*\/\/.*$(?<!,)/u, ""), // and trailing in-line comments that aren't part of the test `code`
				);

				// Roots
				const validStartIndex = content.findIndex(line =>
					/\bvalid\s*:/u.test(line),
				);
				const invalidStartIndex = content.findIndex(line =>
					/\binvalid\s*:/u.test(line),
				);

				testLocations.valid = `${sourceFile}:${
					sourceLine + validStartIndex
				}`;
				testLocations.invalid = `${sourceFile}:${
					sourceLine + invalidStartIndex
				}`;

				// Scenario basics
				const validEndIndex =
					validStartIndex < invalidStartIndex
						? invalidStartIndex
						: content.length;
				const invalidEndIndex =
					validStartIndex < invalidStartIndex
						? content.length
						: validStartIndex;

				const validLines = content.slice(
					validStartIndex,
					validEndIndex,
				);
				const invalidLines = content.slice(
					invalidStartIndex,
					invalidEndIndex,
				);

				let objectDepth = 0;

				/*
				 * `filter(Boolean)` drops the `null`s, and incidentally a `0`
				 * too — which is why the `valid[0]` entry is written out
				 * separately below. Rewriting it as an explicit `!== null`
				 * check would start keeping index 0 and move the line each
				 * case is blamed on, so the resulting type is stated instead.
				 */
				const validLineIndexes = /** @type {number[]} */ (
					validLines
						.map((l, i) => {
							// matches `key: {` and `{`
							if (/^(?:\w+\s*:\s*)?\{/u.test(l)) {
								objectDepth++;
							}

							if (objectDepth > 0) {
								if (l.endsWith("}") || l.endsWith("},")) {
									objectDepth--;
								}

								return objectDepth <= 1 && l.includes("code:")
									? i
									: null;
							}

							return l.endsWith(",") ? i : null;
						})
						.filter(Boolean)
				);

				/* As above: `filter(Boolean)` also drops index 0. */
				const invalidLineIndexes = /** @type {number[]} */ (
					invalidLines
						.map((l, i) =>
							l.trimStart().startsWith("errors:") ? i : null,
						)
						.filter(Boolean)
				);

				Object.assign(
					testLocations,
					{
						[`valid[0]`]: `${sourceFile}:${
							sourceLine + validStartIndex
						}`,
					},
					Object.fromEntries(
						validLineIndexes.map((location, validIndex) => [
							`valid[${validIndex}]`,
							`${sourceFile}:${
								sourceLine + validStartIndex + location
							}`,
						]),
					),
					Object.fromEntries(
						invalidLineIndexes.map((location, invalidIndex) => [
							`invalid[${invalidIndex}]`,
							`${sourceFile}:${
								sourceLine + invalidStartIndex + location
							}`,
						]),
					),
				);

				// Indexes for errors inside each invalid test case
				invalidLineIndexes.push(invalidLines.length);

				for (let i = 0; i < invalidLineIndexes.length - 1; i++) {
					const start = invalidLineIndexes[i];
					const end = invalidLineIndexes[i + 1];
					const errorLines = invalidLines.slice(start, end);
					let errorObjectDepth = 0;
					/* As above: `filter(Boolean)` also drops index 0. */
					const errorLineIndexes = /** @type {number[]} */ (
						errorLines
							.map((l, j) => {
								if (l.startsWith("{") || l.endsWith("{")) {
									errorObjectDepth++;

									if (l.endsWith("}") || l.endsWith("},")) {
										errorObjectDepth--;
									}

									return errorObjectDepth <= 1 ? j : null;
								}

								if (errorObjectDepth > 0) {
									if (l.endsWith("}") || l.endsWith("},")) {
										errorObjectDepth--;
									}

									return null;
								}

								return l.endsWith(",") ? j : null;
							})
							.filter(Boolean)
					);

					Object.assign(
						/** @type {Record<string, string>} */ (testLocations),
						Object.fromEntries(
							errorLineIndexes.map((line, errorIndex) => [
								`invalid[${i}].errors[${errorIndex}]`,
								`${sourceFile}:${
									sourceLine +
									invalidStartIndex +
									start +
									line
								}`,
							]),
						),
					);
				}
			}
		}

		return testLocations[key] || "unknown source";
	};
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

// default separators for testing
const DESCRIBE = Symbol("describe");
const IT = Symbol("it");
const IT_ONLY = Symbol("itOnly");

/**
 * This is `it` default handler if `it` don't exist.
 *
 * A bare `@this` tag with no type after it is a syntax error to tsc (TS1110),
 * so the context a test framework would have bound is declared as `unknown`
 * and passed straight through to `method`.
 * @this {unknown} The context the caller invoked this handler with.
 * @param {string} text The description of the test case.
 * @param {() => void} method The logic of the test case.
 * @throws {Error} Any error upon execution of `method`.
 * @returns {unknown} Returned value of `method`.
 */
function itDefaultHandler(text, method) {
	try {
		return method.call(this);
	} catch (err) {
		if (err instanceof assert.AssertionError) {
			err.message += ` (${util.inspect(err.actual)} ${err.operator} ${util.inspect(err.expected)})`;
		}
		throw err;
	}
}

/**
 * This is `describe` default handler if `describe` don't exist.
 * @this {unknown} The context the caller invoked this handler with.
 * @param {string} text The description of the test case.
 * @param {() => void} method The logic of the test case.
 * @returns {unknown} Returned value of `method`.
 */
function describeDefaultHandler(text, method) {
	return method.call(this);
}

/**
 * Mocha test wrapper.
 */
class RuleTester {
	/**
	 * Creates a new instance of RuleTester.
	 * @param {ConfigObject} [testerConfig] Optional, extra configuration for the tester
	 */
	constructor(testerConfig = {}) {
		/**
		 * The configuration to use for this tester. Combination of the tester
		 * configuration and the default configuration.
		 * @type {ConfigObject[]}
		 */
		this.testerConfig = [
			sharedDefaultConfig,
			testerConfig,
			{ rules: { "rule-tester/validate-ast": "error" } },
		];

		this.linter = new Linter({ configType: "flat" });
	}

	/**
	 * Set the configuration to use for all future tests
	 * @param {ConfigObject} config the configuration to use.
	 * @throws {TypeError} If non-object config.
	 * @returns {void}
	 */
	static setDefaultConfig(config) {
		if (typeof config !== "object" || config === null) {
			throw new TypeError(
				"RuleTester.setDefaultConfig: config must be an object",
			);
		}
		sharedDefaultConfig = config;

		// Make sure the rules object exists since it is assumed to exist later
		sharedDefaultConfig.rules = sharedDefaultConfig.rules || {};
	}

	/**
	 * Get the current configuration used for all tests
	 * @returns {ConfigObject} the current configuration
	 */
	static getDefaultConfig() {
		return sharedDefaultConfig;
	}

	/**
	 * Reset the configuration to the initial configuration of the tester removing
	 * any changes made until now.
	 * @returns {void}
	 */
	static resetDefaultConfig() {
		sharedDefaultConfig = {
			rules: {
				...testerDefaultConfig.rules,
			},
		};
	}

	/*
	 * If people use `mocha test.js --watch` command, `describe` and `it` function
	 * instances are different for each execution. So `describe` and `it` should get fresh instance
	 * always.
	 */
	/**
	 * The function to group a rule's tests with: the one set on the tester, the
	 * test framework's global, or {@link describeDefaultHandler}.
	 * @returns {TestFrameworkMethod} The `describe` to use.
	 */
	static get describe() {
		return (
			this[DESCRIBE] ||
			(typeof describe === "function" ? describe : describeDefaultHandler)
		);
	}

	/**
	 * Sets the function to group a rule's tests with, for a test framework
	 * whose own is not global.
	 * @param {TestFrameworkMethod} value The `describe` to use.
	 */
	static set describe(value) {
		/** @type {RuleTesterSlots} */ (this)[DESCRIBE] = value;
	}

	/**
	 * The function to declare one test case with: the one set on the tester,
	 * the test framework's global, or {@link itDefaultHandler}.
	 * @returns {TestFrameworkMethod} The `it` to use.
	 */
	static get it() {
		return this[IT] || (typeof it === "function" ? it : itDefaultHandler);
	}

	/**
	 * Sets the function to declare one test case with, for a test framework
	 * whose own is not global.
	 * @param {TestFrameworkMethod} value The `it` to use.
	 */
	static set it(value) {
		/** @type {RuleTesterSlots} */ (this)[IT] = value;
	}

	/**
	 * Adds the `only` property to a test to run it in isolation.
	 * @param {string | ValidTestCase} item A single test to run by itself.
	 * @returns {ValidTestCase} The test with `only` set.
	 */
	static only(item) {
		if (typeof item === "string") {
			return { code: item, only: true };
		}

		return { ...item, only: true };
	}

	/**
	 * The function to declare an exclusive test case with, derived from
	 * whichever of `itOnly`, `it.only` and the `it` global is available.
	 * @returns {TestFrameworkMethod} The `it.only` to use.
	 * @throws {Error} When the test framework in use provides no way to run a
	 * single test case in isolation.
	 */
	static get itOnly() {
		if (typeof this[IT_ONLY] === "function") {
			return this[IT_ONLY];
		}
		if (
			typeof this[IT] === "function" &&
			typeof this[IT].only === "function"
		) {
			return Function.bind.call(this[IT].only, this[IT]);
		}
		if (typeof it === "function" && typeof it.only === "function") {
			return Function.bind.call(it.only, it);
		}

		if (
			typeof this[DESCRIBE] === "function" ||
			typeof this[IT] === "function"
		) {
			throw new Error(
				"Set `RuleTester.itOnly` to use `only` with a custom test framework.\n" +
					"See https://eslint.org/docs/latest/integrate/nodejs-api#customizing-ruletester for more.",
			);
		}
		if (typeof it === "function") {
			throw new Error(
				"The current test framework does not support exclusive tests with `only`.",
			);
		}
		throw new Error(
			"To use `only`, use RuleTester with a test framework that provides `it.only()` like Mocha.",
		);
	}

	/**
	 * Sets the function to declare an exclusive test case with, for a test
	 * framework that does not hang one off its `it`.
	 * @param {TestFrameworkMethod} value The `it.only` to use.
	 */
	static set itOnly(value) {
		/** @type {RuleTesterSlots} */ (this)[IT_ONLY] = value;
	}

	/**
	 * Adds a new rule test to execute.
	 * @param {string} ruleName The name of the rule to run.
	 * @param {RuleModule} rule The rule to test.
	 * @param {TestScenarios} test The collection of tests to run.
	 * @throws {assert.AssertionError} If `rule` is not an object with a `create` method,
	 * or if non-object `test`, or if a required scenario of the given type is missing.
	 * @returns {void}
	 */
	run(ruleName, rule, test) {
		const testerConfig = this.testerConfig,
			linter = this.linter,
			ruleId = `rule-to-test/${ruleName}`;

		assertRule(rule, ruleName);
		assertTest(test, ruleName);

		const estimateTestLocation = buildLazyTestLocationEstimator(this.run);

		/*
		 * The first of the default config objects is the one carrying the `@`
		 * plugin. Every `ConfigObject` key is optional, so reading through it
		 * needs one assertion; taking it here keeps the three copies below from
		 * each needing their own.
		 */
		const corePlugin = /** @type {Record<string, Plugin>} */ (
			defaultConfig[0].plugins
		)["@"];

		const baseConfig = [
			{
				plugins: {
					// copy root plugin over
					"@": {
						/*
						 * Parsers are wrapped to detect more errors, so this needs
						 * to be a new object for each call to run(), otherwise the
						 * parsers will be wrapped multiple times.
						 */
						parsers: {
							...corePlugin.parsers,
						},

						/*
						 * The rules key on the default plugin is a proxy to lazy-load
						 * just the rules that are needed. So, don't create a new object
						 * here, just use the default one to keep that performance
						 * enhancement.
						 */
						rules: corePlugin.rules,
						languages: corePlugin.languages,
					},
					"rule-to-test": {
						rules: {
							[ruleName]: Object.assign({}, rule, {
								/**
								 * Creates a wrapper rule that freezes the
								 * `context` properties.
								 * @param {import("../shared/types.js").RuleContext} context The context the linter built for the rule.
								 * @returns {import("../shared/types.js").RuleListener} The visitor the rule under test returned.
								 */
								create(context) {
									freezeDeeply(context.options);
									freezeDeeply(context.settings);
									freezeDeeply(context.parserOptions);

									// freezeDeeply(context.languageOptions);

									return rule.create(context);
								},
							}),
						},
					},
				},
				language: defaultConfig[0].language,
			},
			...defaultRuleTesterConfig,
		];

		/**
		 * Runs a hook on the given item when it's assigned to the given property
		 * @param {UncheckedTestCase} item Item to run the hook on
		 * @param {"before" | "after"} prop The property having the hook assigned to
		 * @throws {assert.AssertionError} If the property is not a function or that function throws an error
		 * @returns {void}
		 * @private
		 */
		function runHook(item, prop) {
			if (hasOwnProperty(item, prop)) {
				assert.strictEqual(
					typeof item[prop],
					"function",
					`Optional test case property '${prop}' must be a function`,
				);
				/*
				 * `assert.strictEqual()` above has established that the hook is
				 * there; the typedef declares it optional because a test case
				 * need not provide one.
				 */
				/** @type {NonNullable<UncheckedTestCase["before"]>} */ (
					item[prop]
				)();
			}
		}
		/**
		 * Run the rule for the given item
		 * @param {UncheckedTestCase} item Item to run the rule against
		 * @throws {Error} If an invalid schema.
		 * @returns {RuleRunResult} Eslint run result
		 * @private
		 */
		function runRuleForItem(item) {
			const code = item.code;
			const filename = hasOwnProperty(item, "filename")
				? item.filename
				: void 0;
			/*
			 * The `hasOwnProperty()` guard is what makes this an array; the
			 * typedef declares `options` optional because a test case need not
			 * set it.
			 */
			const options = /** @type {any[]} */ (
				hasOwnProperty(item, "options") ? item.options : []
			);
			/** @type {import("../config/flat-config-array.js").FlatConfigArrayOptions} */
			const flatConfigArrayOptions = {
				baseConfig,
			};

			if (filename) {
				flatConfigArrayOptions.basePath =
					path.parse(filename).root || void 0;
			}

			const configs = new FlatConfigArray(
				testerConfig,
				flatConfigArrayOptions,
			);

			/*
			 * Modify the returned config so that the parser is wrapped to catch
			 * access of the start/end properties. This method is called just
			 * once per code snippet being tested, so each test case gets a clean
			 * parser.
			 */
			/** @type {Record<symbol, any>} */ (configs)[
				ConfigArraySymbol.finalizeConfig
			] =
				/**
				 * Finalizes a calculated config, wrapping its parser first.
				 * @this {object} The config array the hook was installed on.
				 * @param {...any} args The arguments `ConfigArray` passes through.
				 * @returns {any} The finalized config.
				 */ function (...args) {
					// can't do super here :(
					const proto = Object.getPrototypeOf(this);
					const calculatedConfig = proto[
						ConfigArraySymbol.finalizeConfig
					].apply(this, args);

					// wrap the parser to catch start/end property access
					if (calculatedConfig.language === jslang) {
						calculatedConfig.languageOptions.parser = wrapParser(
							calculatedConfig.languageOptions.parser,
						);
					}

					return calculatedConfig;
				};

			/** @type {string} */
			let output;
			/** @type {any} */
			let beforeAST;
			/** @type {any} */
			let afterAST;

			/*
			 * Assumes everything on the item is a config except for the
			 * parameters used by this tester
			 */
			const itemConfig = /** @type {Record<string, unknown>} */ ({
				...item,
			});

			for (const parameter of RuleTesterParameters) {
				delete itemConfig[parameter];
			}

			/*
			 * Create the config object from the tester config and this item
			 * specific configurations.
			 */
			configs.push(itemConfig);

			configs.push({
				rules: {
					[ruleId]: [1, ...options],
				},
			});

			let schema;

			try {
				schema = Config.getRuleOptionsSchema(rule);
			} catch (err) {
				/*
				 * Re-thrown as the same object, so the `cause` chain and the
				 * original stack are both preserved.
				 */
				const schemaError = /** @type {Error} */ (err);

				schemaError.message += metaSchemaDescription;
				throw err;
			}

			/*
			 * Check and throw an error if the schema is an empty object (`schema:{}`), because such schema
			 * doesn't validate or enforce anything and is therefore considered a possible error. If the intent
			 * was to skip options validation, `schema:false` should be set instead (explicit opt-out).
			 *
			 * For this purpose, a schema object is considered empty if it doesn't have any own enumerable string-keyed
			 * properties. While `ajv.compile()` does use enumerable properties from the prototype chain as well,
			 * it caches compiled schemas by serializing only own enumerable properties, so it's generally not a good idea
			 * to use inherited properties in schemas because schemas that differ only in inherited properties would end up
			 * having the same cache entry that would be correct for only one of them.
			 *
			 * At this point, `schema` can only be an object or `null`.
			 */
			if (schema && Object.keys(schema).length === 0) {
				throw new Error(
					`\`schema: {}\` is a no-op${metaSchemaDescription}`,
				);
			}

			/*
			 * Setup AST getters.
			 * The goal is to check whether or not AST was modified when
			 * running the rule under test.
			 */
			configs.push({
				plugins: {
					"rule-tester": {
						rules: {
							"validate-ast": {
								/**
								 * Creates the visitor that snapshots the AST
								 * either side of the rule under test.
								 * @returns {import("../shared/types.js").RuleListener} The visitor.
								 */
								create() {
									return {
										/**
										 * Records the AST before the rule
										 * under test has seen it.
										 * @param {any} node The `Program` node.
										 * @returns {void}
										 */
										Program(node) {
											beforeAST =
												cloneDeeplyExcludesParent(node);
										},

										/**
										 * Records the AST after the rule under
										 * test has run.
										 * @param {any} node The `Program` node.
										 * @returns {void}
										 */
										"Program:exit"(node) {
											afterAST = node;
										},
									};
								},
							},
						},
					},
				},
			});

			if (schema) {
				ajv.validateSchema(schema);

				if (ajv.errors) {
					const errors = ajv.errors
						.map(error => {
							const field =
								error.dataPath[0] === "."
									? error.dataPath.slice(1)
									: error.dataPath;

							return `\t${field}: ${error.message}`;
						})
						.join("\n");

					/*
					 * The array is coerced to a string by `Error`, which joins
					 * it with a comma rather than a newline. That comma is part
					 * of the message the tests pin, so it stays; only the type
					 * of the argument is stated here.
					 */
					throw new Error(
						/** @type {any} */ ([
							`Schema for rule ${ruleName} is invalid:`,
							errors,
						]),
					);
				}

				/*
				 * `ajv.validateSchema` checks for errors in the structure of the schema (by comparing the schema against a "meta-schema"),
				 * and it reports those errors individually. However, there are other types of schema errors that only occur when compiling
				 * the schema (e.g. using invalid defaults in a schema), and only one of these errors can be reported at a time. As a result,
				 * the schema is compiled here separately from checking for `validateSchema` errors.
				 */
				try {
					ajv.compile(schema);
				} catch (err) {
					const compileError = /** @type {Error} */ (err);

					throw new Error(
						`Schema for rule ${ruleName} is invalid: ${compileError.message}`,
						{
							cause: err,
						},
					);
				}
			}

			// check for validation errors
			try {
				configs.normalizeSync();
				configs.getConfig("test.js");
			} catch (error) {
				/* Re-thrown as the same object, with its message prefixed. */
				const configError = /** @type {Error} */ (error);

				configError.message = `ESLint configuration in rule-tester is invalid: ${configError.message}`;
				throw error;
			}

			// Verify the code.
			const { applyLanguageOptions, applyInlineConfig, finalize } =
				SourceCode.prototype;
			let messages;

			try {
				forbiddenMethods.forEach(methodName => {
					/*
					 * These three are real `SourceCode` methods, but JSDoc
					 * cannot narrow a `string` from a plain array to the union
					 * of their names, so the prototype is indexed through a
					 * view.
					 */
					/** @type {Record<string, any>} */ (SourceCode.prototype)[
						methodName
					] = throwForbiddenMethodError(
						methodName,
						/** @type {Record<string, any>} */ (
							SourceCode.prototype
						),
					);
				});

				messages = linter.verify(code, configs, filename);
			} finally {
				SourceCode.prototype.applyInlineConfig = applyInlineConfig;
				SourceCode.prototype.applyLanguageOptions =
					applyLanguageOptions;
				SourceCode.prototype.finalize = finalize;
			}

			const fatalErrorMessage = messages.find(m => m.fatal);

			assert(
				!fatalErrorMessage,
				`A fatal parsing error occurred: ${fatalErrorMessage && fatalErrorMessage.message}`,
			);

			// Verify if autofix makes a syntax error or not.
			if (messages.some(m => m.fix)) {
				output = SourceCodeFixer.applyFixes(code, messages).output;
				const errorMessageInFix = linter
					.verify(output, configs, filename)
					.find(m => m.fatal);

				assert(
					!errorMessageInFix,
					[
						"A fatal parsing error occurred in autofix.",
						`Error: ${errorMessageInFix && errorMessageInFix.message}`,
						"Autofix output:",
						output,
					].join("\n"),
				);
			} else {
				output = code;
			}

			return {
				messages,
				output,
				beforeAST,
				afterAST: cloneDeeplyExcludesParent(afterAST),
				configs,
				filename,
			};
		}

		/**
		 * Check if the AST was changed
		 * @param {any} beforeAST AST node before running
		 * @param {any} afterAST AST node after running
		 * @throws {assert.AssertionError} If the rule modified the AST.
		 * @returns {void}
		 * @private
		 */
		function assertASTDidntChange(beforeAST, afterAST) {
			if (!equal(beforeAST, afterAST)) {
				assert.fail("Rule should not modify AST.");
			}
		}

		/**
		 * Check if the template is valid or not
		 * all valid cases go through this
		 * @param {UncheckedTestCase} item Item to run the rule against
		 * @throws {assert.AssertionError} If the rule reported anything.
		 * @returns {void}
		 * @private
		 */
		function testValidTemplate(item) {
			const result = runRuleForItem(item);
			const messages = result.messages;

			assert.strictEqual(
				messages.length,
				0,
				util.format(
					"Should have no errors but had %d: %s",
					messages.length,
					util.inspect(messages),
				),
			);

			assertASTDidntChange(result.beforeAST, result.afterAST);
		}

		/**
		 * Asserts that the message matches its expected value. If the expected
		 * value is a regular expression, it is checked against the actual
		 * value.
		 * @param {string} actual Actual value
		 * @param {string | RegExp} expected Expected value
		 * @throws {assert.AssertionError} If the values do not match.
		 * @returns {void}
		 * @private
		 */
		function assertMessageMatches(actual, expected) {
			if (expected instanceof RegExp) {
				// assert.js doesn't have a built-in RegExp match function
				assert.ok(
					expected.test(actual),
					`Expected '${actual}' to match ${expected}`,
				);
			} else {
				assert.strictEqual(actual, expected);
			}
		}

		/**
		 * Check if the template is invalid or not
		 * all invalid cases go through this.
		 * @param {InvalidTestCase} item Item to run the rule against
		 * @private
		 * @throws {assert.AssertionError} If the test case is invalid or has an invalid error.
		 * @returns {void}
		 */
		function testInvalidTemplate(item) {
			const {
				requireMessage = false,
				requireLocation = false,
				requireData = false,
			} = test.assertionOptions ?? {};

			const ruleHasMetaMessages =
				hasOwnProperty(rule, "meta") &&
				hasOwnProperty(rule.meta, "messages");

			/*
			 * `ruleHasMetaMessages` is a `boolean` rather than a type
			 * predicate, so every read of the message table below would need
			 * its own assertion. Taking the optional chain once states the
			 * shape in one place; where the table is absent, this is
			 * `undefined` and `ruleHasMetaMessages` keeps every read of it out
			 * of reach.
			 */
			const ruleMessages = /** @type {Record<string, string>} */ (
				rule.meta?.messages
			);

			const friendlyIDList = ruleHasMetaMessages
				? `[${Object.keys(ruleMessages)
						.map(key => `'${key}'`)
						.join(", ")}]`
				: null;

			assert.ok(
				ruleHasMetaMessages || requireMessage !== "messageId",
				`Assertion options can not use 'requireMessage: "messageId"' if rule under test doesn't define 'meta.messages'.`,
			);

			const result = runRuleForItem(item);
			const messages = result.messages;

			for (const message of messages) {
				if (hasOwnProperty(message, "suggestions")) {
					/*
					 * `hasOwnProperty()` above is the guard; it is a `boolean`
					 * rather than a type predicate, so the list is stated once
					 * here instead of at each of the two reads.
					 */
					const suggestions = /** @type {SuggestionResult[]} */ (
						message.suggestions
					);

					/** @type {Map<string, number>} */
					const seenMessageIndices = new Map();

					for (let i = 0; i < suggestions.length; i += 1) {
						const suggestionMessage = suggestions[i].desc;
						const previous =
							seenMessageIndices.get(suggestionMessage);

						assert.ok(
							!seenMessageIndices.has(suggestionMessage),
							`Suggestion message '${suggestionMessage}' reported from suggestion ${i} was previously reported by suggestion ${previous}. Suggestion messages should be unique within an error.`,
						);
						seenMessageIndices.set(suggestionMessage, i);
					}
				}
			}

			if (typeof item.errors === "number") {
				assert.strictEqual(
					messages.length,
					item.errors,
					util.format(
						"Should have %d error%s but had %d: %s",
						item.errors,
						item.errors === 1 ? "" : "s",
						messages.length,
						util.inspect(messages),
					),
				);
			} else {
				assert.strictEqual(
					messages.length,
					item.errors.length,
					util.format(
						"Should have %d error%s but had %d: %s",
						item.errors.length,
						item.errors.length === 1 ? "" : "s",
						messages.length,
						util.inspect(messages),
					),
				);

				const hasMessageOfThisRule = messages.some(
					m => m.ruleId === ruleId,
				);

				for (let i = 0, l = item.errors.length; i < l; i++) {
					try {
						/*
						 * Stated rather than inferred. `assert.ok()` is an
						 * assertion function, and some of the calls below
						 * assert on an expression that reads this binding,
						 * which makes an inferred type circular (TS7022) and
						 * silently degrades every later read of it to `any`.
						 * The same applies to `missingKeys` and
						 * `hasPlaceholders` below.
						 */
						/** @type {TestCaseError} */
						const error = item.errors[i];
						const message = messages[i];

						assert(
							hasMessageOfThisRule,
							"Error rule name should be the same as the name of the rule being tested",
						);

						if (
							typeof error === "string" ||
							error instanceof RegExp
						) {
							// Just an error message.
							assertMessageMatches(message.message, error);
							assert.ok(
								message.suggestions === void 0,
								`Error at index ${i} has suggestions. Please convert the test error into an object and specify 'suggestions' property on it to test suggestions.`,
							);
						} else if (
							typeof error === "object" &&
							error !== null
						) {
							/*
							 * Error object.
							 * This may have a message, messageId, data, line, and/or column.
							 */

							if (hasOwnProperty(error, "message")) {
								assertMessageMatches(
									message.message,
									/*
									 * The `hasOwnProperty()` guard is what makes
									 * this present; the typedef declares it
									 * optional because an expected error may
									 * use `messageId` instead.
									 */
									/** @type {string | RegExp} */ (
										error.message
									),
								);
							} else if (hasOwnProperty(error, "messageId")) {
								/* As above: the guard is what makes this present. */
								const expectedMessageId =
									/** @type {string} */ (error.messageId);

								assert.ok(
									ruleHasMetaMessages,
									"Error can not use 'messageId' if rule under test doesn't define 'meta.messages'.",
								);
								if (
									!hasOwnProperty(
										ruleMessages,
										expectedMessageId,
									)
								) {
									assert(
										false,
										`Invalid messageId '${expectedMessageId}'. Expected one of ${friendlyIDList}.`,
									);
								}
								assert.strictEqual(
									message.messageId,
									expectedMessageId,
									`messageId '${message.messageId}' does not match expected messageId '${expectedMessageId}'.`,
								);

								const unsubstitutedPlaceholders =
									getUnsubstitutedMessagePlaceholders(
										message.message,
										/*
										 * The `strictEqual()` above has just
										 * established that the reported message
										 * carries the expected ID.
										 */
										ruleMessages[
											/** @type {string} */ (
												message.messageId
											)
										],
										error.data,
									);

								assert.ok(
									unsubstitutedPlaceholders.length === 0,
									`The reported message has ${unsubstitutedPlaceholders.length > 1 ? `unsubstituted placeholders: ${unsubstitutedPlaceholders.map(name => `'${name}'`).join(", ")}` : `an unsubstituted placeholder '${unsubstitutedPlaceholders[0]}'`}. Please provide the missing ${unsubstitutedPlaceholders.length > 1 ? "values" : "value"} via the 'data' property in the context.report() call.`,
								);

								if (hasOwnProperty(error, "data")) {
									/*
									 *  if data was provided, then directly compare the returned message to a synthetic
									 *  interpolated message using the same message ID and data provided in the test.
									 *  See https://github.com/eslint/eslint/issues/9890 for context.
									 */
									const unformattedOriginalMessage =
										ruleMessages[expectedMessageId];
									const rehydratedMessage = interpolate(
										unformattedOriginalMessage,
										error.data,
									);

									assert.strictEqual(
										message.message,
										rehydratedMessage,
										`Hydrated message "${rehydratedMessage}" does not match "${message.message}"`,
									);
								} else {
									const requiresDataProperty =
										requireData === true ||
										requireData === "error";
									/** @type {boolean} */
									const hasPlaceholders =
										getMessagePlaceholders(
											ruleMessages[expectedMessageId],
										).length > 0;
									assert.ok(
										!requiresDataProperty ||
											!hasPlaceholders,
										`Error should specify the 'data' property as the referenced message has placeholders.`,
									);
								}
							}

							const locationProperties = [
								"line",
								"column",
								"endLine",
								"endColumn",
							];
							/** @type {Record<string, unknown>} */
							const actualLocation = {};

							/** @type {Record<string, unknown>} */
							const expectedLocation = {};

							/*
							 * The four names are read out of a `string[]`,
							 * which cannot be narrowed to the union of the
							 * members they name, so both sides are indexed
							 * through a view.
							 */
							const errorFields =
								/** @type {Record<string, unknown>} */ (error);
							const messageFields =
								/** @type {Record<string, unknown>} */ (
									message
								);

							for (const key of locationProperties) {
								if (hasOwnProperty(error, key)) {
									actualLocation[key] = messageFields[key];
									expectedLocation[key] = errorFields[key];
								}
							}

							if (requireLocation) {
								/** @type {string[]} */
								const missingKeys = locationProperties.filter(
									key =>
										!hasOwnProperty(error, key) &&
										hasOwnProperty(message, key),
								);
								assert.ok(
									missingKeys.length === 0,
									`Error is missing expected location properties: ${missingKeys.join(", ")}`,
								);
							}

							if (Object.keys(expectedLocation).length > 0) {
								assert.deepStrictEqual(
									actualLocation,
									expectedLocation,
									"Actual error location does not match expected error location.",
								);
							}

							assert.ok(
								!message.suggestions ||
									hasOwnProperty(error, "suggestions"),
								`Error at index ${i} has suggestions. Please specify 'suggestions' property on the test error object.`,
							);
							if (hasOwnProperty(error, "suggestions")) {
								// Support asserting there are no suggestions
								const expectsSuggestions = Array.isArray(
									error.suggestions,
								)
									? error.suggestions.length > 0
									: Boolean(error.suggestions);
								const hasSuggestions =
									message.suggestions !== void 0;

								if (!hasSuggestions && expectsSuggestions) {
									assert.ok(
										!error.suggestions,
										`Error should have suggestions on error with message: "${message.message}"`,
									);
								} else if (hasSuggestions) {
									/*
									 * `hasSuggestions` is the guard for every
									 * read below, including the ones inside the
									 * `forEach()` callback, where an aliased
									 * condition no longer narrows.
									 */
									const actualSuggestions =
										/** @type {SuggestionResult[]} */ (
											message.suggestions
										);

									assert.ok(
										expectsSuggestions,
										`Error should have no suggestions on error with message: "${message.message}"`,
									);
									if (typeof error.suggestions === "number") {
										assert.strictEqual(
											actualSuggestions.length,
											error.suggestions,
											`Error should have ${error.suggestions} suggestions. Instead found ${actualSuggestions.length} suggestions`,
										);
									} else if (
										Array.isArray(error.suggestions)
									) {
										assert.strictEqual(
											actualSuggestions.length,
											error.suggestions.length,
											`Error should have ${error.suggestions.length} suggestions. Instead found ${actualSuggestions.length} suggestions`,
										);

										error.suggestions.forEach(
											/**
											 * Checks one expected suggestion
											 * against the one the rule
											 * reported at the same index.
											 * @param {SuggestionTestCase} expectedSuggestion The suggestion this test case expects.
											 * @param {number} index Its position in the expected list.
											 * @returns {void}
											 */
											(expectedSuggestion, index) => {
												assert.ok(
													typeof expectedSuggestion ===
														"object" &&
														expectedSuggestion !==
															null,
													"Test suggestion in 'suggestions' array must be an object.",
												);
												Object.keys(
													expectedSuggestion,
												).forEach(propertyName => {
													assert.ok(
														suggestionObjectParameters.has(
															propertyName,
														),
														`Invalid suggestion property name '${propertyName}'. Expected one of ${friendlySuggestionObjectParameterList}.`,
													);
												});

												const actualSuggestion =
													actualSuggestions[index];
												const suggestionPrefix = `Error Suggestion at index ${index}:`;

												if (
													hasOwnProperty(
														expectedSuggestion,
														"desc",
													)
												) {
													assert.ok(
														!hasOwnProperty(
															expectedSuggestion,
															"data",
														),
														`${suggestionPrefix} Test should not specify both 'desc' and 'data'.`,
													);
													assert.ok(
														!hasOwnProperty(
															expectedSuggestion,
															"messageId",
														),
														`${suggestionPrefix} Test should not specify both 'desc' and 'messageId'.`,
													);
													assert.strictEqual(
														actualSuggestion.desc,
														expectedSuggestion.desc,
														`${suggestionPrefix} desc should be "${expectedSuggestion.desc}" but got "${actualSuggestion.desc}" instead.`,
													);
												} else if (
													hasOwnProperty(
														expectedSuggestion,
														"messageId",
													)
												) {
													/*
													 * The `hasOwnProperty()`
													 * guard is what makes this
													 * present; the typedef
													 * declares it optional
													 * because an expected
													 * suggestion may use `desc`
													 * instead.
													 */
													const suggestionMessageId =
														/** @type {string} */ (
															expectedSuggestion.messageId
														);

													assert.ok(
														ruleHasMetaMessages,
														`${suggestionPrefix} Test can not use 'messageId' if rule under test doesn't define 'meta.messages'.`,
													);
													assert.ok(
														hasOwnProperty(
															ruleMessages,
															suggestionMessageId,
														),
														`${suggestionPrefix} Test has invalid messageId '${expectedSuggestion.messageId}', the rule under test allows only one of ${friendlyIDList}.`,
													);
													assert.strictEqual(
														actualSuggestion.messageId,
														expectedSuggestion.messageId,
														`${suggestionPrefix} messageId should be '${expectedSuggestion.messageId}' but got '${actualSuggestion.messageId}' instead.`,
													);

													const rawSuggestionMessage =
														ruleMessages[
															suggestionMessageId
														];
													const unsubstitutedPlaceholders =
														getUnsubstitutedMessagePlaceholders(
															actualSuggestion.desc,
															rawSuggestionMessage,
															expectedSuggestion.data,
														);

													assert.ok(
														unsubstitutedPlaceholders.length ===
															0,
														`The message of the suggestion has ${unsubstitutedPlaceholders.length > 1 ? `unsubstituted placeholders: ${unsubstitutedPlaceholders.map(name => `'${name}'`).join(", ")}` : `an unsubstituted placeholder '${unsubstitutedPlaceholders[0]}'`}. Please provide the missing ${unsubstitutedPlaceholders.length > 1 ? "values" : "value"} via the 'data' property for the suggestion in the context.report() call.`,
													);

													if (
														hasOwnProperty(
															expectedSuggestion,
															"data",
														)
													) {
														const unformattedMetaMessage =
															ruleMessages[
																suggestionMessageId
															];
														const rehydratedDesc =
															interpolate(
																unformattedMetaMessage,
																expectedSuggestion.data,
															);

														assert.strictEqual(
															actualSuggestion.desc,
															rehydratedDesc,
															`${suggestionPrefix} Hydrated test desc "${rehydratedDesc}" does not match received desc "${actualSuggestion.desc}".`,
														);
													} else {
														const requiresDataProperty =
															requireData ===
																true ||
															requireData ===
																"suggestion";
														const hasPlaceholders =
															getMessagePlaceholders(
																rawSuggestionMessage,
															).length > 0;
														assert.ok(
															!requiresDataProperty ||
																!hasPlaceholders,
															`${suggestionPrefix} Suggestion should specify the 'data' property as the referenced message has placeholders.`,
														);
													}
												} else if (
													hasOwnProperty(
														expectedSuggestion,
														"data",
													)
												) {
													assert.fail(
														`${suggestionPrefix} Test must specify 'messageId' if 'data' is used.`,
													);
												} else {
													assert.fail(
														`${suggestionPrefix} Test must specify either 'messageId' or 'desc'.`,
													);
												}

												assert.ok(
													hasOwnProperty(
														expectedSuggestion,
														"output",
													),
													`${suggestionPrefix} The "output" property is required.`,
												);
												/*
												 * `applyFixes()` reads only
												 * `fix` off each entry, and a
												 * suggestion carries one; it is
												 * declared against
												 * `LintMessage` because that is
												 * what the linter hands it.
												 */
												const codeWithAppliedSuggestion =
													SourceCodeFixer.applyFixes(
														item.code,
														[
															/** @type {any} */ (
																actualSuggestion
															),
														],
													).output;

												// Verify if suggestion fix makes a syntax error or not.
												const errorMessageInSuggestion =
													linter
														.verify(
															codeWithAppliedSuggestion,
															result.configs,
															result.filename,
														)
														.find(m => m.fatal);

												assert(
													!errorMessageInSuggestion,
													[
														"A fatal parsing error occurred in suggestion fix.",
														`Error: ${errorMessageInSuggestion && errorMessageInSuggestion.message}`,
														"Suggestion output:",
														codeWithAppliedSuggestion,
													].join("\n"),
												);

												assert.strictEqual(
													codeWithAppliedSuggestion,
													expectedSuggestion.output,
													`Expected the applied suggestion fix to match the test suggestion output for suggestion at index: ${index} on error with message: "${message.message}"`,
												);
												assert.notStrictEqual(
													expectedSuggestion.output,
													item.code,
													`The output of a suggestion should differ from the original source code for suggestion at index: ${index} on error with message: "${message.message}"`,
												);
											},
										);
									} else {
										assert.fail(
											"Test error object property 'suggestions' should be an array or a number",
										);
									}
								}
							}
						}
					} catch (error) {
						if (error instanceof Error) {
							/** @type {TaggedTestError} */ (error).errorIndex =
								i;
						}
						throw error;
					}
				}
			}

			if (hasOwnProperty(item, "output")) {
				if (item.output === null) {
					assert.strictEqual(
						result.output,
						item.code,
						"Expected no autofixes to be suggested",
					);
				} else {
					assert.strictEqual(
						result.output,
						item.output,
						"Output is incorrect.",
					);
					assert.notStrictEqual(
						item.code,
						item.output,
						"Test property 'output' matches 'code'. If no autofix is expected, then omit the 'output' property or set it to null.",
					);
				}
			} else {
				assert.strictEqual(
					result.output,
					item.code,
					"The rule fixed the code. Please add 'output' property.",
				);
			}

			assertASTDidntChange(result.beforeAST, result.afterAST);
		}

		/*
		 * This creates a mocha test suite and pipes all supplied info through
		 * one of the templates above.
		 * The test suites for valid/invalid are created conditionally as
		 * test runners (eg. vitest) fail for empty test suites.
		 */
		/*
		 * `this.constructor` is typed as `Function`, which carries none of the
		 * test-framework accessors. Taking the view once keeps the four reads
		 * below from each needing their own.
		 */
		const tester = /** @type {typeof RuleTester} */ (this.constructor);

		tester.describe(ruleName, () => {
			if (test.valid.length > 0) {
				tester.describe("valid", () => {
					/** @type {Set<string>} */
					const seenTestCases = new Set();
					test.valid.forEach((valid, index) => {
						const item = normalizeTestCase(valid);

						/*
						 * `only` is read off the test case as written rather
						 * than the normalized one, which is equivalent: a bare
						 * string never carries it, and normalizing one does not
						 * add it.
						 */
						tester[
							/** @type {ValidTestCase} */ (valid).only
								? "itOnly"
								: "it"
						](sanitize(item.name || item.code), () => {
							try {
								runHook(item, "before");
								assertValidTestCase(item, seenTestCases);
								testValidTemplate(item);
							} catch (error) {
								if (error instanceof Error) {
									const tagged =
										/** @type {TaggedTestError} */ (error);

									tagged.scenarioType = "valid";
									tagged.scenarioIndex = index;

									/*
									 * `Error#stack` is optional in the type
									 * but set by every engine ESLint runs
									 * on, and the `instanceof` guard above
									 * is what makes this an `Error` at all.
									 */
									tagged.stack = /** @type {string} */ (
										tagged.stack
									).replace(
										/^ +at /mu,
										[
											`    roughly at RuleTester.run.valid[${index}] (${estimateTestLocation(`valid[${index}]`)})`,
											`    roughly at RuleTester.run.valid (${estimateTestLocation("valid")})`,
											`    at RuleTester.run (${estimateTestLocation("root")})`,
											"    at ",
										].join("\n"),
									);
								}
								throw error;
							} finally {
								runHook(item, "after");
							}
						});
					});
				});
			}

			if (test.invalid.length > 0) {
				tester.describe("invalid", () => {
					/** @type {Set<string>} */
					const seenTestCases = new Set();
					test.invalid.forEach((invalid, index) => {
						const item = normalizeTestCase(invalid);

						tester[item.only ? "itOnly" : "it"](
							sanitize(item.name || item.code),
							() => {
								try {
									runHook(item, "before");
									assertInvalidTestCase(
										item,
										seenTestCases,
										ruleName,
										test.assertionOptions,
									);
									/*
									 * `assertInvalidTestCase()` above has just
									 * established that `errors` is there.
									 */
									testInvalidTemplate(
										/** @type {InvalidTestCase} */ (item),
									);
								} catch (error) {
									if (error instanceof Error) {
										const tagged =
											/** @type {TaggedTestError} */ (
												error
											);

										tagged.scenarioType = "invalid";
										tagged.scenarioIndex = index;
										const errorIndex = tagged.errorIndex;

										/* As above: every engine sets `stack`. */
										tagged.stack = /** @type {string} */ (
											tagged.stack
										).replace(
											/^ +at /mu,
											[
												...(typeof errorIndex ===
												"number"
													? [
															`    roughly at RuleTester.run.invalid[${index}].error[${errorIndex}] (${estimateTestLocation(`invalid[${index}].errors[${errorIndex}]`)})`,
														]
													: []),
												`    roughly at RuleTester.run.invalid[${index}] (${estimateTestLocation(`invalid[${index}]`)})`,
												`    roughly at RuleTester.run.invalid (${estimateTestLocation("invalid")})`,
												`    at RuleTester.run (${estimateTestLocation("root")})`,
												"    at ",
											].join("\n"),
										);
									}
									throw error;
								} finally {
									runHook(item, "after");
								}
							},
						);
					});
				});
			}
		});
	}
}

/*
 * The three symbol-keyed slots the accessors above read are declared here, as
 * one `null` with a stated type: this is the only assignment to them tsc treats
 * as a declaration, because each setter writes through a `RuleTesterSlots`
 * view instead.
 */
RuleTester[DESCRIBE] =
	RuleTester[IT] =
	RuleTester[IT_ONLY] =
		/** @type {TestFrameworkMethod | null} */ (null);

module.exports = RuleTester;

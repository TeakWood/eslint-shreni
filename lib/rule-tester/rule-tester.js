/**
 * @fileoverview Mocha/Jest test wrapper
 * @author Ilya Volodin
 */

// @ts-check

"use strict";

/*
 * The test framework's `describe` and `it` are read off `globalThis` through
 * `testFrameworkGlobal()` below rather than as bare identifiers, so this file
 * declares no runner globals of its own.
 */

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

/** @typedef {import("../shared/types.js").ASTNode} ASTNode */
/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../shared/types.js").RuleModule} RuleModule */
/** @typedef {import("../shared/types.js").SuggestionResult} SuggestionResult */
/** @typedef {import("eslint-visitor-keys").VisitorKeys} VisitorKeys */

/**
 * `Boolean` used as an array filter, described as the type guard it acts as.
 *
 * The line scans below mark uninteresting lines with `null` and keep the rest
 * by index, so `Boolean` is what drops them. Naming it here is what lets the
 * surviving indexes stay `number` without changing the predicate — note that
 * it also drops index `0`, which the scans rely on.
 * @typedef {(index: number | null) => index is number} IndexGuard
 */

/**
 * An error thrown out of a test case, tagged on the way out with where in the
 * scenario it came from so its stack can be rewritten to point at the test.
 * @typedef {Error & { errorIndex?: number, scenarioType?: "valid" | "invalid", scenarioIndex?: number }} TaggedTestError
 */

/**
 * Where a test case was written, used to point failures back at the source.
 * @typedef {Object} InvocationLocation
 * @property {string} sourceFile The path of the file the tests were declared in.
 * @property {number} sourceLine The 1-based line the call appears on.
 * @property {number} sourceColumn The 1-based column the call appears on.
 */

/**
 * An expected suggestion on an expected error.
 * @typedef {Object} SuggestionTestCase
 * @property {string} [desc] The exact description the suggestion must have.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {Record<string, string>} [data] The values interpolated into the message.
 * @property {string} [output] The source text the suggestion must produce.
 */

/**
 * One expected error on an invalid test case. A bare string or regular
 * expression matches only the reported message; the object form can pin the
 * message ID, the location and the suggestions as well.
 * @typedef {Object} TestCaseErrorObject
 * @property {string | RegExp} [message] The expected message.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {Record<string, string>} [data] The values interpolated into the message.
 * @property {number} [line] The 1-based line the problem starts on.
 * @property {number} [column] The 1-based column the problem starts on.
 * @property {number} [endLine] The 1-based line the problem ends on.
 * @property {number} [endColumn] The 1-based column the problem ends on.
 * @property {number | boolean | Array<SuggestionTestCase>} [suggestions] The expected suggestions, or how many of them there are.
 */

/** @typedef {string | RegExp | TestCaseErrorObject} TestCaseError */

/**
 * A test case that the rule must not report on. Properties beyond the ones
 * named here are treated as configuration and merged into the config array.
 * @typedef {Object} ValidTestCase
 * @property {string} code The source text to lint.
 * @property {string} [name] The title to give the generated test.
 * @property {string} [filename] The name to lint the code under.
 * @property {Array<unknown>} [options] The options to configure the rule with.
 * @property {() => void} [before] A hook run before the test case.
 * @property {() => void} [after] A hook run after the test case.
 * @property {boolean} [only] Whether to run this case in isolation.
 * @property {Array<TestCaseError> | number} [errors] Never set on a valid case; present so the assertion that rejects it type-checks.
 * @property {string | null} [output] Never set on a valid case; present so the assertion that rejects it type-checks.
 */

/**
 * A test case that the rule must report on.
 * @typedef {ValidTestCase & { errors: Array<TestCaseError> | number }} InvalidTestCase
 */

/**
 * Extra requirements a test scenario can place on its own test cases, over and
 * above what the rule reports.
 * @typedef {Object} AssertionOptions
 * @property {false | "message" | "messageId"} [requireMessage] Which of the two an expected error must specify.
 * @property {boolean} [requireLocation] Whether an expected error must pin every location property the rule reported.
 * @property {boolean | "error" | "suggestion"} [requireData] Whether an expected error must supply `data` for a message with placeholders.
 */

/**
 * The scenarios one call to `run()` executes.
 * @typedef {Object} TestScenarios
 * @property {Array<ValidTestCase | string>} valid The cases the rule must not report on.
 * @property {Array<InvalidTestCase>} invalid The cases the rule must report on.
 * @property {AssertionOptions} [assertionOptions] The extra requirements to hold the cases to.
 */

/**
 * What linting one test case produced, carried from `runRuleForItem()` to the
 * assertions that examine it.
 * @typedef {Object} RunResult
 * @property {Array<LintMessage>} messages The problems the rule reported.
 * @property {string} output The source text after any fixes were applied.
 * @property {ASTNode} beforeAST A deep clone of the AST taken before the rule ran.
 * @property {ASTNode} afterAST A deep clone of the AST taken after the rule ran.
 * @property {FlatConfigArray} configs The config array the code was linted with.
 * @property {string | undefined} filename The name the code was linted under.
 */

//------------------------------------------------------------------------------
// Private Members
//------------------------------------------------------------------------------

/*
 * testerDefaultConfig must not be modified as it allows to reset the tester to
 * the initial default configuration
 */
const testerDefaultConfig = { rules: {} };

/*
 * RuleTester uses this config as its default. This can be overwritten via
 * setDefaultConfig().
 */
/** @type {Record<string, any>} */
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

/*
 * Reports whether a value has an own property, without going through the
 * value's own (possibly shadowed or missing) `hasOwnProperty`. `Function.call`
 * is bound generically, so the resulting signature is restated here.
 */
const hasOwnProperty =
	/** @type {(object: unknown, key: PropertyKey) => boolean} */ (
		Function.call.bind(Object.hasOwnProperty)
	);

/**
 * Clones a given value deeply.
 * Note: This ignores `parent` property.
 * @param {any} x A value to clone.
 * @returns {any} A cloned value.
 */
function cloneDeeplyExcludesParent(x) {
	if (typeof x === "object" && x !== null) {
		if (Array.isArray(x)) {
			return x.map(cloneDeeplyExcludesParent);
		}

		/** @type {Record<string, unknown>} */
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
 * @param {Set<object>} [seenObjects] Objects already seen during the traversal.
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
		/*
		 * The match is a single code unit drawn from the class above, so
		 * `codePointAt(0)` always finds one.
		 */
		c => `\\u${Number(c.codePointAt(0)).toString(16).padStart(4, "0")}`,
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
 * @param {ASTNode & { tokens: Array<object>, comments: Array<object> }} ast The root node to errorize `start`/`end` properties.
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
 * @param {{ parse?: Function, parseForESLint?: Function }} parser Parser object.
 * @returns {object} Wrapped parser object.
 */
function wrapParser(parser) {
	if (typeof parser.parseForESLint === "function") {
		return {
			[parserSymbol]: parser,

			/**
			 * Parses the source text, then errorizes the tree it produced.
			 * @param {...any} args The arguments the linter passes through.
			 * @returns {{ ast: any, visitorKeys?: VisitorKeys }} The parse result.
			 */
			parseForESLint(...args) {
				/*
				 * The guard above establishes the method exists, but it does
				 * not narrow across the closure boundary. The call stays a
				 * parenthesised member access rather than a hoisted local so
				 * the parser keeps its receiver.
				 */
				const ret = /** @type {Function} */ (parser.parseForESLint)(
					...args,
				);

				defineStartEndAsErrorInTree(ret.ast, ret.visitorKeys);
				return ret;
			},
		};
	}

	return {
		[parserSymbol]: parser,

		/**
		 * Parses the source text, then errorizes the tree it produced.
		 * @param {...any} args The arguments the linter passes through.
		 * @returns {any} The parsed AST.
		 */
		parse(...args) {
			// See the note above: parenthesised so the parser keeps its receiver.
			const ast = /** @type {Function} */ (parser.parse)(...args);

			defineStartEndAsErrorInTree(ast);
			return ast;
		},
	};
}

/**
 * Function to replace forbidden `SourceCode` methods. Allows just one call per method.
 * @param {string} methodName The name of the method to forbid.
 * @param {Record<string, Function>} prototype The prototype with the original method to call.
 * @returns {Function} The function that throws the error.
 */
function throwForbiddenMethodError(methodName, prototype) {
	const original = prototype[methodName];

	/**
	 * Calls the original method once, then refuses every later call.
	 * @this {object} The `SourceCode` the method was called on.
	 * @param {...any} args The arguments to forward to the original method.
	 * @throws {Error} On every call after the first.
	 * @returns {any} Whatever the original method returned.
	 */
	return function (...args) {
		/*
		 * The map is keyed by the same list the callers iterate, so every
		 * name reaching this point has an entry.
		 */
		const called = /** @type {WeakSet<object>} */ (
			forbiddenMethodCalls.get(methodName)
		);

		// The `@this` tag above is what declares this a method.
		if (!called.has(this)) {
			called.add(this);

			return original.apply(this, args);
		}

		throw new Error(
			`\`SourceCode#${methodName}()\` cannot be called inside a rule.`,
		);
	};
}

/**
 * Extracts names of {{ placeholders }} from the reported message.
 * @param {string} message Reported message
 * @returns {Array<string>} Array of placeholder names
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
 * @param {Record<string, string>} [data] The passed
 * @returns {Array<string>} Missing placeholder names
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
 * @param {ValidTestCase | InvalidTestCase | string} item The test case item to normalize.
 * @returns {ValidTestCase | InvalidTestCase} The normalized test case object.
 */
function normalizeTestCase(item) {
	return item && typeof item === "object" ? item : { code: item };
}

/**
 * Asserts that the `errors` property of an invalid test case is valid.
 * @param {Array<TestCaseError> | number | undefined} errors The `errors` property of the invalid test case.
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
 * @param {ValidTestCase | InvalidTestCase} item test case object
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
 * @param {ValidTestCase | InvalidTestCase} item The test case object to check.
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
 * @param {ValidTestCase} item The valid test case object to check.
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
 * @param {InvalidTestCase} item The invalid test case object to check.
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
 * @param {Function} [relative] The function before the invocation point.
 * @returns {InvocationLocation | undefined} The invocation location.
 */
function getInvocationLocation(relative = getInvocationLocation) {
	/*
	 * `stack` is read below to make V8 run `prepareStackTrace`, so the object
	 * is declared as carrying it rather than as an empty literal.
	 */
	const dummyObject = /** @type {{ stack?: string }} */ ({});
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
	return location;
}

/**
 * Estimates the location of the test case in the source file.
 * @param {Function} invoker The method that runs the tests.
 * @returns {(key: string) => string} The lazy resolver for the estimated location of the test case.
 */
function buildLazyTestLocationEstimator(invoker) {
	/*
	 * `getInvocationLocation()` captures a fresh stack and then reads it, which
	 * runs `Error.prepareStackTrace` on both Node.js and Bun, so the location
	 * is always assigned by the time it returns.
	 */
	const invocationLocation = /** @type {InvocationLocation} */ (
		getInvocationLocation(invoker)
	);
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
				const validLineIndexes = validLines
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
					.filter(
						/** @type {IndexGuard} */ (
							/** @type {unknown} */ (Boolean)
						),
					);
				const invalidLineIndexes = invalidLines
					.map((l, i) =>
						l.trimStart().startsWith("errors:") ? i : null,
					)
					.filter(
						/** @type {IndexGuard} */ (
							/** @type {unknown} */ (Boolean)
						),
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
					const errorLineIndexes = errorLines
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
						.filter(
							/** @type {IndexGuard} */ (
								/** @type {unknown} */ (Boolean)
							),
						);

					Object.assign(
						testLocations,
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
 * Reaches the symbol-keyed handler slots stored on the tester class.
 *
 * JSDoc has no way to declare a symbol-keyed static member, so the slots are
 * reached through this one cast rather than through a dozen scattered ones.
 * `tester` is passed rather than closed over so a subclass keeps its own
 * slots, which is what the accessors below rely on.
 * @param {Function} tester The class the slots live on.
 * @returns {Record<symbol, any>} The same class, typed as its slots.
 */
function handlerSlots(tester) {
	return /** @type {Record<symbol, any>} */ (/** @type {unknown} */ (tester));
}

/**
 * Reads a test framework's global by name.
 *
 * `describe` and `it` are installed on the global object by whichever runner
 * is in use, so they are not in this module's scope. Looking them up on
 * `globalThis` is what the bare identifier does at runtime, and keeping the
 * lookup lazy is what `mocha --watch` needs: it installs a fresh pair for
 * every run.
 * @param {"describe" | "it"} name The name of the global to read.
 * @returns {any} The current value of the global, or `undefined` if unset.
 */
function testFrameworkGlobal(name) {
	return /** @type {Record<string, any>} */ (globalThis)[name];
}

/**
 * This is `it` default handler if `it` don't exist.
 * @this {any} The context the test framework would have supplied.
 * @param {string} text The description of the test case.
 * @param {Function} method The logic of the test case.
 * @throws {Error} Any error upon execution of `method`.
 * @returns {any} Returned value of `method`.
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
 * @this {any} The context the test framework would have supplied.
 * @param {string} text The description of the test case.
 * @param {Function} method The logic of the test case.
 * @returns {any} Returned value of `method`.
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
	 * @param {Record<string, any>} [testerConfig] Optional, extra configuration for the tester
	 */
	constructor(testerConfig = {}) {
		/**
		 * The configuration to use for this tester. Combination of the tester
		 * configuration and the default configuration.
		 * @type {Array<Record<string, any>>}
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
	 * @param {Record<string, any>} config the configuration to use.
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
	 * @returns {Record<string, any>} the current configuration
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
	static get describe() {
		const describe = testFrameworkGlobal("describe");

		return (
			handlerSlots(this)[DESCRIBE] ||
			(typeof describe === "function" ? describe : describeDefaultHandler)
		);
	}

	static set describe(value) {
		handlerSlots(this)[DESCRIBE] = value;
	}

	static get it() {
		const it = testFrameworkGlobal("it");

		return (
			handlerSlots(this)[IT] ||
			(typeof it === "function" ? it : itDefaultHandler)
		);
	}

	static set it(value) {
		handlerSlots(this)[IT] = value;
	}

	/**
	 * Adds the `only` property to a test to run it in isolation.
	 * @param {ValidTestCase | InvalidTestCase | string} item A single test to run by itself.
	 * @returns {ValidTestCase | InvalidTestCase} The test with `only` set.
	 */
	static only(item) {
		if (typeof item === "string") {
			return { code: item, only: true };
		}

		return { ...item, only: true };
	}

	static get itOnly() {
		const slots = handlerSlots(this);

		if (typeof slots[IT_ONLY] === "function") {
			return slots[IT_ONLY];
		}
		if (
			typeof slots[IT] === "function" &&
			typeof slots[IT].only === "function"
		) {
			return Function.bind.call(slots[IT].only, slots[IT]);
		}
		const it = testFrameworkGlobal("it");

		if (typeof it === "function" && typeof it.only === "function") {
			return Function.bind.call(it.only, it);
		}

		if (
			typeof slots[DESCRIBE] === "function" ||
			typeof slots[IT] === "function"
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

	static set itOnly(value) {
		handlerSlots(this)[IT_ONLY] = value;
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
		 * `defaultConfig` is typed as an array of its differing entries, so the
		 * root entry has to be named before the plugin it contributes is
		 * reachable. The first entry is the one that defines `plugins["@"]`.
		 */
		const rootConfig =
			/** @type {{ plugins: Record<string, any>, language: any }} */ (
				defaultConfig[0]
			);

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
							...rootConfig.plugins["@"].parsers,
						},

						/*
						 * The rules key on the default plugin is a proxy to lazy-load
						 * just the rules that are needed. So, don't create a new object
						 * here, just use the default one to keep that performance
						 * enhancement.
						 */
						rules: rootConfig.plugins["@"].rules,
						languages: rootConfig.plugins["@"].languages,
					},
					"rule-to-test": {
						rules: {
							[ruleName]: Object.assign({}, rule, {
								/**
								 * Creates the visitor, freezing what the rule can see first.
								 * @param {any} context The context the linter built for this file.
								 * @returns {Record<string, Function>} The rule's visitor.
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
				language: rootConfig.language,
			},
			...defaultRuleTesterConfig,
		];

		/**
		 * Runs a hook on the given item when it's assigned to the given property
		 * @param {ValidTestCase | InvalidTestCase} item Item to run the hook on
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
				 * The assertion above is what establishes the hook is
				 * callable; `hasOwnProperty()` alone does not narrow it.
				 */
				/** @type {Function} */ (item[prop])();
			}
		}
		/**
		 * Run the rule for the given item
		 * @param {ValidTestCase | InvalidTestCase} item Item to run the rule against
		 * @throws {Error} If an invalid schema.
		 * @returns {RunResult} Eslint run result
		 * @private
		 */
		function runRuleForItem(item) {
			const code = item.code;
			const filename = hasOwnProperty(item, "filename")
				? item.filename
				: void 0;
			/*
			 * `assertTestCommonProperties()` has already rejected the case if
			 * `options` is present and not an array.
			 */
			const options = hasOwnProperty(item, "options")
				? /** @type {Array<unknown>} */ (item.options)
				: [];
			/** @type {{ baseConfig: Array<any>, basePath?: string }} */
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
			/*
			 * `finalizeConfig` is keyed by a symbol, which JSDoc cannot
			 * declare as a member, so the array is named through a cast for
			 * the one assignment that overrides it.
			 */
			/** @type {Record<symbol, Function>} */ (
				/** @type {unknown} */ (configs)
			)[ConfigArraySymbol.finalizeConfig] =
				/**
				 * Finalizes a config, wrapping its parser on the way out.
				 * @this {object} The config array being finalized.
				 * @param {...any} args The arguments the base implementation takes.
				 * @returns {any} The finalized config.
				 */
				function (...args) {
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

			/*
			 * Both are assigned by the `validate-ast` rule pushed below while
			 * the code is being linted, which tsc cannot see — hence the
			 * possibly-unset declarations and the casts where they are read.
			 */
			/** @type {ASTNode | undefined} */
			let beforeAST;
			/** @type {ASTNode | undefined} */
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
				// The thrown value is always an `Error` built by `Config`.
				/** @type {Error} */ (err).message += metaSchemaDescription;
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
								 * Captures the tree on the way in and on the way out.
								 * @returns {Record<string, Function>} The visitor.
								 */
								create() {
									return {
										/**
										 * Clones the tree before the rule under test sees it.
										 * @param {ASTNode} node The root node.
										 * @returns {void}
										 */
										Program(node) {
											beforeAST =
												cloneDeeplyExcludesParent(node);
										},

										/**
										 * Keeps the tree as the rule under test left it.
										 * @param {ASTNode} node The root node.
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
					 * The argument is an array, not a string: `Error`
					 * stringifies it, which puts a comma between the heading
					 * and the errors. That exact message is pinned by the
					 * tests, so it is cast rather than joined.
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
					// ajv only ever throws an `Error` out of `compile()`.
					const reason = /** @type {Error} */ (err);

					throw new Error(
						`Schema for rule ${ruleName} is invalid: ${reason.message}`,
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
				// Config validation only ever fails with an `Error`.
				const invalid = /** @type {Error} */ (error);

				invalid.message = `ESLint configuration in rule-tester is invalid: ${invalid.message}`;
				throw error;
			}

			// Verify the code.
			const { applyLanguageOptions, applyInlineConfig, finalize } =
				SourceCode.prototype;
			let messages;

			/*
			 * The three forbidden methods are replaced by name, which a class
			 * prototype has no index signature for. One cast here keeps the
			 * loop readable and is undone by the `finally` block below.
			 */
			const sourceCodeProto = /** @type {Record<string, Function>} */ (
				/** @type {unknown} */ (SourceCode.prototype)
			);

			try {
				forbiddenMethods.forEach(methodName => {
					sourceCodeProto[methodName] = throwForbiddenMethodError(
						methodName,
						sourceCodeProto,
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
				beforeAST: /** @type {ASTNode} */ (beforeAST),
				afterAST: cloneDeeplyExcludesParent(afterAST),
				configs,
				filename,
			};
		}

		/**
		 * Check if the AST was changed
		 * @param {ASTNode} beforeAST AST node before running
		 * @param {ASTNode} afterAST AST node after running
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
		 * @param {ValidTestCase} item Item to run the rule against
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
		 * @returns {void}
		 * @private
		 * @throws {assert.AssertionError} If the test case is invalid or has an invalid error.
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
			 * Every read of `meta.messages` below is guarded by
			 * `ruleHasMetaMessages`, which `hasOwnProperty()` establishes but
			 * tsc cannot follow. Naming the table once keeps those reads to
			 * the same object the guard checked; the empty fallback is only
			 * ever reached on paths an assertion has already failed on.
			 */
			const ruleMessages = /** @type {Record<string, string>} */ (
				rule.meta?.messages ?? {}
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
					 * `hasOwnProperty()` is what establishes the property is
					 * there; it does not narrow the optional declaration.
					 */
					const suggestions = /** @type {Array<SuggestionResult>} */ (
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
				/*
				 * Named once so the element type stays fixed for the whole
				 * branch; reading it back off `item` inside the loop leaves
				 * tsc trying to infer each element from its own uses.
				 */
				const expectedErrors = item.errors;

				assert.strictEqual(
					messages.length,
					expectedErrors.length,
					util.format(
						"Should have %d error%s but had %d: %s",
						expectedErrors.length,
						expectedErrors.length === 1 ? "" : "s",
						messages.length,
						util.inspect(messages),
					),
				);

				const hasMessageOfThisRule = messages.some(
					m => m.ruleId === ruleId,
				);

				for (let i = 0, l = expectedErrors.length; i < l; i++) {
					try {
						const error = expectedErrors[i];
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
								/*
								 * `hasOwnProperty()` is what establishes the
								 * property is there; it does not narrow the
								 * optional declaration. The same holds for
								 * `messageId` in the branch below.
								 */
								assertMessageMatches(
									message.message,
									/** @type {string | RegExp} */ (
										error.message
									),
								);
							} else if (hasOwnProperty(error, "messageId")) {
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
										`Invalid messageId '${error.messageId}'. Expected one of ${friendlyIDList}.`,
									);
								}
								assert.strictEqual(
									message.messageId,
									error.messageId,
									`messageId '${message.messageId}' does not match expected messageId '${error.messageId}'.`,
								);

								const unsubstitutedPlaceholders =
									getUnsubstitutedMessagePlaceholders(
										message.message,
										/*
										 * The assertion above has already
										 * failed unless the reported ID is
										 * the expected one.
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

							const locationProperties =
								/** @type {Array<"line" | "column" | "endLine" | "endColumn">} */ ([
									"line",
									"column",
									"endLine",
									"endColumn",
								]);
							/** @type {Record<string, unknown>} */
							const actualLocation = {};
							/** @type {Record<string, unknown>} */
							const expectedLocation = {};

							for (const key of locationProperties) {
								if (hasOwnProperty(error, key)) {
									actualLocation[key] = message[key];
									expectedLocation[key] = error[key];
								}
							}

							if (requireLocation) {
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

								/*
								 * Every read below sits under `hasSuggestions`,
								 * which is the check that establishes the
								 * property is there.
								 */
								const actualSuggestions =
									/** @type {Array<SuggestionResult>} */ (
										message.suggestions
									);

								if (!hasSuggestions && expectsSuggestions) {
									assert.ok(
										!error.suggestions,
										`Error should have suggestions on error with message: "${message.message}"`,
									);
								} else if (hasSuggestions) {
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
											 * Checks one expected suggestion against the one reported.
											 * @param {SuggestionTestCase} expectedSuggestion The suggestion the test expects.
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
													 * `hasOwnProperty()` is what
													 * establishes the ID is
													 * there; it does not narrow
													 * the optional declaration.
													 */
													const expectedMessageId =
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
															expectedMessageId,
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
															expectedMessageId
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
																expectedMessageId
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
												 * `applyFixes()` reads nothing
												 * from a message but its `fix`,
												 * which a suggestion carries,
												 * so the suggestion stands in
												 * for a message here.
												 */
												const codeWithAppliedSuggestion =
													SourceCodeFixer.applyFixes(
														item.code,
														[
															/** @type {LintMessage} */ (
																/** @type {unknown} */ (
																	actualSuggestion
																)
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
		 * `this.constructor` is typed as a bare `Function`, which hides the
		 * static accessors. Naming it keeps the receiver intact, which those
		 * accessors need: they read their handler slots off `this`, so a
		 * subclass has to stay the one they are called on.
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
						 * Deliberately the raw entry rather than the
						 * normalized one: a string case has no `only`.
						 */
						const isOnly = /** @type {ValidTestCase} */ (valid)
							.only;

						tester[isOnly ? "itOnly" : "it"](
							sanitize(item.name || item.code),
							() => {
								try {
									runHook(item, "before");
									assertValidTestCase(item, seenTestCases);
									testValidTemplate(item);
								} catch (error) {
									if (error instanceof Error) {
										const tagged =
											/** @type {TaggedTestError} */ (
												error
											);

										tagged.scenarioType = "valid";
										tagged.scenarioIndex = index;

										// V8 always populates `stack` here.
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
							},
						);
					});
				});
			}

			if (test.invalid.length > 0) {
				tester.describe("invalid", () => {
					/** @type {Set<string>} */
					const seenTestCases = new Set();
					test.invalid.forEach((invalid, index) => {
						const item = /** @type {InvalidTestCase} */ (
							normalizeTestCase(invalid)
						);

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
									testInvalidTemplate(item);
								} catch (error) {
									if (error instanceof Error) {
										const tagged =
											/** @type {TaggedTestError} */ (
												error
											);

										tagged.scenarioType = "invalid";
										tagged.scenarioIndex = index;
										const errorIndex = tagged.errorIndex;

										// V8 always populates `stack` here.
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

handlerSlots(RuleTester)[DESCRIBE] =
	handlerSlots(RuleTester)[IT] =
	handlerSlots(RuleTester)[IT_ONLY] =
		null;

module.exports = RuleTester;

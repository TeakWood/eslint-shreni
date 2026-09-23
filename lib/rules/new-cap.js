/**
 * @fileoverview Rule to flag use of constructors without capital letters
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * The rule's option object, as `meta.defaultOptions` leaves it. Every member
 * the user may omit has a default there except the two exception patterns,
 * which are the only optional ones.
 * @typedef {Object} NewCapOptions
 * @property {boolean} newIsCap Whether a `new` operation must call a capitalized function.
 * @property {boolean} capIsNew Whether a call of a capitalized function must use `new`.
 * @property {Array<string>} newIsCapExceptions The lowercase names that may still be called with `new`.
 * @property {string} [newIsCapExceptionPattern] A pattern matching the lowercase names that may still be called with `new`.
 * @property {Array<string>} capIsNewExceptions The capitalized names that may still be called without `new`.
 * @property {string} [capIsNewExceptionPattern] A pattern matching the capitalized names that may still be called without `new`.
 * @property {boolean} properties Whether to check the capitalization of member expression callees.
 */

/**
 * An object whose keys are the names an option exempts, used as a set.
 * @typedef {Record<string, boolean>} ExceptionMap
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const CAPS_ALLOWED = [
	"Array",
	"Boolean",
	"Date",
	"Error",
	"Function",
	"Number",
	"Object",
	"RegExp",
	"String",
	"Symbol",
	"BigInt",
];

/**
 * A reducer function to invert an array to an Object mapping the string form of the key, to `true`.
 * @param {ExceptionMap} map Accumulator object for the reduce.
 * @param {string} key Object key to set to `true`.
 * @returns {ExceptionMap} Returns the updated Object for further reduction.
 */
function invert(map, key) {
	map[key] = true;
	return map;
}

/**
 * Creates an object with the cap is new exceptions as its keys and true as their values.
 * @param {NewCapOptions} config Rule configuration
 * @returns {ExceptionMap} Object with cap is new exceptions.
 */
function calculateCapIsNewExceptions(config) {
	const capIsNewExceptions = Array.from(
		new Set([...config.capIsNewExceptions, ...CAPS_ALLOWED]),
	);

	return capIsNewExceptions.reduce(invert, {});
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Require constructor names to begin with a capital letter",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/new-cap",
		},

		schema: [
			{
				type: "object",
				properties: {
					newIsCap: {
						type: "boolean",
					},
					capIsNew: {
						type: "boolean",
					},
					newIsCapExceptions: {
						type: "array",
						items: {
							type: "string",
						},
					},
					newIsCapExceptionPattern: {
						type: "string",
					},
					capIsNewExceptions: {
						type: "array",
						items: {
							type: "string",
						},
					},
					capIsNewExceptionPattern: {
						type: "string",
					},
					properties: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		defaultOptions: [
			{
				capIsNew: true,
				capIsNewExceptions: CAPS_ALLOWED,
				newIsCap: true,
				newIsCapExceptions: [],
				properties: true,
			},
		],

		messages: {
			upper: "A function with a name starting with an uppercase letter should only be used as a constructor.",
			lower: "A constructor name should not start with a lowercase letter.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		// `meta.schema` validated the shape and `meta.defaultOptions` filled in the rest.
		const [config] = /** @type {[NewCapOptions]} */ (context.options);
		const skipProperties = !config.properties;

		const newIsCapExceptions = config.newIsCapExceptions.reduce(invert, {});
		const newIsCapExceptionPattern = config.newIsCapExceptionPattern
			? new RegExp(config.newIsCapExceptionPattern, "u")
			: null;

		const capIsNewExceptions = calculateCapIsNewExceptions(config);
		const capIsNewExceptionPattern = config.capIsNewExceptionPattern
			? new RegExp(config.capIsNewExceptionPattern, "u")
			: null;

		/** @type {RuleVisitor} */
		const listeners = {};

		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Get exact callee name from expression
		 * @param {ASTNode} node CallExpression or NewExpression node
		 * @returns {string} name
		 */
		function extractNameFromExpression(node) {
			return node.callee.type === "Identifier"
				? node.callee.name
				: astUtils.getStaticPropertyName(node.callee) || "";
		}

		/**
		 * Returns the capitalization state of the string -
		 * Whether the first character is uppercase, lowercase, or non-alphabetic
		 * @param {string} str String
		 * @returns {"non-alpha" | "lower" | "upper"} capitalization state: "non-alpha", "lower", or "upper"
		 */
		function getCap(str) {
			const firstChar = str.charAt(0);

			const firstCharLower = firstChar.toLowerCase();
			const firstCharUpper = firstChar.toUpperCase();

			if (firstCharLower === firstCharUpper) {
				// char has no uppercase variant, so it's non-alphabetic
				return "non-alpha";
			}
			if (firstChar === firstCharLower) {
				return "lower";
			}
			return "upper";
		}

		/**
		 * Check if capitalization is allowed for a CallExpression
		 * @param {ExceptionMap} allowedMap Object mapping calleeName to a Boolean
		 * @param {ASTNode} node CallExpression node
		 * @param {string} calleeName Capitalized callee name from a CallExpression
		 * @param {RegExp | null} pattern RegExp object from options pattern
		 * @returns {boolean} Returns true if the callee may be capitalized
		 */
		function isCapAllowed(allowedMap, node, calleeName, pattern) {
			const sourceText = sourceCode.getText(node.callee);

			if (allowedMap[calleeName] || allowedMap[sourceText]) {
				return true;
			}

			if (pattern && pattern.test(sourceText)) {
				return true;
			}

			const callee = astUtils.skipChainExpression(node.callee);

			if (calleeName === "UTC" && callee.type === "MemberExpression") {
				// allow if callee is Date.UTC
				return (
					callee.object.type === "Identifier" &&
					callee.object.name === "Date"
				);
			}

			return skipProperties && callee.type === "MemberExpression";
		}

		/**
		 * Reports the given messageId for the given node. The location will be the start of the property or the callee.
		 * @param {ASTNode} node CallExpression or NewExpression node.
		 * @param {string} messageId The messageId to report.
		 * @returns {void}
		 */
		function report(node, messageId) {
			let callee = astUtils.skipChainExpression(node.callee);

			if (callee.type === "MemberExpression") {
				callee = callee.property;
			}

			context.report({ node, loc: callee.loc, messageId });
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		if (config.newIsCap) {
			/**
			 * Reports a `new` operation whose constructor is not capitalized.
			 * @param {ASTNode} node The `NewExpression` node.
			 * @returns {void}
			 */
			listeners.NewExpression = function (node) {
				const constructorName = extractNameFromExpression(node);

				if (constructorName) {
					const capitalization = getCap(constructorName);
					const isAllowed =
						capitalization !== "lower" ||
						isCapAllowed(
							newIsCapExceptions,
							node,
							constructorName,
							newIsCapExceptionPattern,
						);

					if (!isAllowed) {
						report(node, "lower");
					}
				}
			};
		}

		if (config.capIsNew) {
			/**
			 * Reports a call of a capitalized function that does not use `new`.
			 * @param {ASTNode} node The `CallExpression` node.
			 * @returns {void}
			 */
			listeners.CallExpression = function (node) {
				const calleeName = extractNameFromExpression(node);

				if (calleeName) {
					const capitalization = getCap(calleeName);
					const isAllowed =
						capitalization !== "upper" ||
						isCapAllowed(
							capIsNewExceptions,
							node,
							calleeName,
							capIsNewExceptionPattern,
						);

					if (!isAllowed) {
						report(node, "upper");
					}
				}
			};
		}

		return listeners;
	},
};

/**
 * @fileoverview Restrict usage of specified node modules.
 * @author Christian Schulz
 * @deprecated in ESLint v7.0.0
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
 * A restricted module as the user configured it: either the bare module name,
 * or the name paired with the message to show in place of the default one.
 * Both forms are accepted by `meta.schema`, so both reach `create()`.
 * @typedef {string | { name: string, message?: string }} RestrictedPath
 */

/**
 * The restricted module names, indexed by name, mapping to the custom message
 * the user gave for that name. The value is nullish when there is no custom
 * message: `null` for the bare-string form, `undefined` for the object form
 * with `message` omitted. Presence is tested with `Object.hasOwn()`, so a
 * nullish value still marks the name as restricted.
 * @typedef {Record<string, string | null | undefined>} RestrictedPathMessages
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/*
 * `ignore` declares its factory as an ESM default export and this project
 * compiles without `esModuleInterop`, so `require()` is typed as the module
 * namespace rather than as the factory. The package assigns
 * `factory.default = factory` and then exports the factory itself, so the
 * value bound here is the callable factory the namespace's `default` names.
 */
const ignore = /** @type {typeof import("ignore").default} */ (
	/** @type {unknown} */ (require("ignore"))
);

const arrayOfStrings = {
	type: "array",
	items: { type: "string" },
	uniqueItems: true,
};

const arrayOfStringsOrObjects = {
	type: "array",
	items: {
		anyOf: [
			{ type: "string" },
			{
				type: "object",
				properties: {
					name: { type: "string" },
					message: {
						type: "string",
						minLength: 1,
					},
				},
				additionalProperties: false,
				required: ["name"],
			},
		],
	},
	uniqueItems: true,
};

module.exports = {
	meta: {
		deprecated: {
			message: "Node.js rules were moved out of ESLint core.",
			url: "https://eslint.org/docs/latest/use/migrating-to-7.0.0#deprecate-node-rules",
			deprecatedSince: "7.0.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"eslint-plugin-n now maintains deprecated Node.js-related rules.",
					plugin: {
						name: "eslint-plugin-n",
						url: "https://github.com/eslint-community/eslint-plugin-n",
					},
					rule: {
						name: "no-restricted-require",
						url: "https://github.com/eslint-community/eslint-plugin-n/tree/master/docs/rules/no-restricted-require.md",
					},
				},
			],
		},

		type: "suggestion",

		docs: {
			description: "Disallow specified modules when loaded by `require`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-restricted-modules",
		},

		schema: {
			anyOf: [
				arrayOfStringsOrObjects,
				{
					type: "array",
					items: {
						type: "object",
						properties: {
							paths: arrayOfStringsOrObjects,
							patterns: arrayOfStrings,
						},
						additionalProperties: false,
					},
					additionalItems: false,
				},
			],
		},

		messages: {
			defaultMessage: "'{{name}}' module is restricted from being used.",
			customMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{name}}' module is restricted from being used. {{customMessage}}",
			patternMessage:
				"'{{name}}' module is restricted from being used by a pattern.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const options = Array.isArray(context.options) ? context.options : [];
		const isPathAndPatternsObject =
			typeof options[0] === "object" &&
			(Object.hasOwn(options[0], "paths") ||
				Object.hasOwn(options[0], "patterns"));

		/** @type {Array<RestrictedPath>} */
		const restrictedPaths =
			(isPathAndPatternsObject ? options[0].paths : context.options) ||
			[];
		/** @type {Array<string>} */
		const restrictedPatterns =
			(isPathAndPatternsObject ? options[0].patterns : []) || [];

		const restrictedPathMessages = restrictedPaths.reduce(
			(memo, importName) => {
				if (typeof importName === "string") {
					memo[importName] = null;
				} else {
					memo[importName.name] = importName.message;
				}
				return memo;
			},
			/** @type {RestrictedPathMessages} */ ({}),
		);

		// if no imports are restricted we don't need to check
		if (
			Object.keys(restrictedPaths).length === 0 &&
			restrictedPatterns.length === 0
		) {
			return {};
		}

		// relative paths are supported for this rule
		const ig = ignore({ allowRelativePaths: true }).add(restrictedPatterns);

		/**
		 * Function to check if a node is a string literal.
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} If the node is a string literal.
		 */
		function isStringLiteral(node) {
			return (
				node &&
				node.type === "Literal" &&
				typeof node.value === "string"
			);
		}

		/**
		 * Function to check if a node is a require call.
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} If the node is a require call.
		 */
		function isRequireCall(node) {
			return (
				node.callee.type === "Identifier" &&
				node.callee.name === "require"
			);
		}

		/**
		 * Extract string from Literal or TemplateLiteral node
		 * @param {ASTNode} node The node to extract from
		 * @returns {string | null} Extracted string or null if node doesn't represent a string
		 */
		function getFirstArgumentString(node) {
			if (isStringLiteral(node)) {
				return node.value.trim();
			}

			if (astUtils.isStaticTemplateLiteral(node)) {
				return node.quasis[0].value.cooked.trim();
			}

			return null;
		}

		/**
		 * Report a restricted path.
		 * @param {ASTNode} node representing the restricted path reference
		 * @param {string} name restricted path
		 * @returns {void}
		 * @private
		 */
		function reportPath(node, name) {
			const customMessage = restrictedPathMessages[name];
			const messageId = customMessage
				? "customMessage"
				: "defaultMessage";

			context.report({
				node,
				messageId,
				data: {
					name,
					customMessage,
				},
			});
		}

		/**
		 * Check if the given name is a restricted path name
		 * @param {string} name name of a variable
		 * @returns {boolean} whether the variable is a restricted path or not
		 * @private
		 */
		function isRestrictedPath(name) {
			return Object.hasOwn(restrictedPathMessages, name);
		}

		return {
			/**
			 * Reports a `require()` call that loads a restricted module.
			 * @param {ASTNode} node The `CallExpression` node.
			 * @returns {void}
			 */
			CallExpression(node) {
				if (isRequireCall(node)) {
					// node has arguments
					if (node.arguments.length) {
						const name = getFirstArgumentString(node.arguments[0]);

						// if first argument is a string literal or a static string template literal
						if (name) {
							// check if argument value is in restricted modules array
							if (isRestrictedPath(name)) {
								reportPath(node, name);
							}

							if (
								restrictedPatterns.length > 0 &&
								ig.ignores(name)
							) {
								context.report({
									node,
									messageId: "patternMessage",
									data: { name },
								});
							}
						}
					}
				}
			},
		};
	},
};

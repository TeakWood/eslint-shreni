/**
 * @fileoverview Restrict usage of specified globals.
 * @author Benoît Zugmeyer
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
/** @typedef {import("eslint-scope").Reference} Reference */

/**
 * A restricted global as the user configured it: either the bare name, or the
 * name paired with the message to show in place of the default one. Both forms
 * are accepted by `meta.schema`, so both reach `create()`.
 * @typedef {string | { name: string, message?: string }} RestrictedGlobal
 */

/**
 * The restricted names, indexed by name, mapping to the custom message the
 * user gave for that name. The value is nullish when there is no custom
 * message: `null` for the bare-string form, `undefined` for the object form
 * with `message` omitted. Presence is tested with `Object.hasOwn()`, so a
 * nullish value still marks the name as restricted.
 * @typedef {Record<string, string | null | undefined>} RestrictedGlobalMessages
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — `Reference#identifier` here — as
 * bare ESTree nodes: no `parent`, and `range` and `loc` optional. The linter
 * populates all three before any rule runs, so this is the same object a
 * visitor would have received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

const TYPE_NODES = new Set([
	"TSTypeReference",
	"TSInterfaceHeritage",
	"TSClassImplements",
	"TSTypeQuery",
	"TSQualifiedName",
]);

const GLOBAL_OBJECTS = new Set(["globalThis", "self", "window"]);

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const arrayOfGlobals = {
	type: "array",
	items: {
		oneOf: [
			{
				type: "string",
			},
			{
				type: "object",
				properties: {
					name: { type: "string" },
					message: { type: "string" },
				},
				required: ["name"],
				additionalProperties: false,
			},
		],
	},
	uniqueItems: true,
	minItems: 0,
};

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow specified global variables",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-restricted-globals",
		},

		schema: {
			anyOf: [
				arrayOfGlobals,
				{
					type: "array",
					items: [
						{
							type: "object",
							properties: {
								globals: arrayOfGlobals,
								checkGlobalObject: {
									type: "boolean",
								},
								globalObjects: {
									type: "array",
									items: {
										type: "string",
									},
									uniqueItems: true,
								},
							},
							required: ["globals"],
							additionalProperties: false,
						},
					],
					additionalItems: false,
				},
			],
		},

		messages: {
			defaultMessage: "Unexpected use of '{{name}}'.",
			// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
			customMessage: "Unexpected use of '{{name}}'. {{customMessage}}",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const { sourceCode, options } = context;

		const isGlobalsObject =
			typeof options[0] === "object" &&
			Object.hasOwn(options[0], "globals");

		/** @type {Array<RestrictedGlobal>} */
		const restrictedGlobals = isGlobalsObject
			? options[0].globals
			: options;
		/** @type {boolean} */
		const checkGlobalObject = isGlobalsObject
			? options[0].checkGlobalObject
			: false;
		/** @type {Array<string>} */
		const userGlobalObjects = isGlobalsObject
			? options[0].globalObjects || []
			: [];

		const globalObjects = new Set([
			...GLOBAL_OBJECTS,
			...userGlobalObjects,
		]);

		// If no globals are restricted, we don't need to do anything
		if (restrictedGlobals.length === 0) {
			return {};
		}

		const restrictedGlobalMessages = restrictedGlobals.reduce(
			(memo, option) => {
				if (typeof option === "string") {
					memo[option] = null;
				} else {
					memo[option.name] = option.message;
				}

				return memo;
			},
			/** @type {RestrictedGlobalMessages} */ ({}),
		);

		/**
		 * Report a variable to be used as a restricted global.
		 * @param {Reference} reference the variable reference
		 * @returns {void}
		 * @private
		 */
		function reportReference(reference) {
			const name = reference.identifier.name,
				customMessage = restrictedGlobalMessages[name],
				messageId = customMessage ? "customMessage" : "defaultMessage";

			context.report({
				node: asNode(reference.identifier),
				messageId,
				data: {
					name,
					customMessage,
				},
			});
		}

		/**
		 * Check if the given name is a restricted global name.
		 * @param {string} name name of a variable
		 * @returns {boolean} whether the variable is a restricted global or not
		 * @private
		 */
		function isRestricted(name) {
			return Object.hasOwn(restrictedGlobalMessages, name);
		}

		/**
		 * Check if the given reference occurs within a TypeScript type context.
		 * @param {Reference} reference The variable reference to check.
		 * @returns {boolean} Whether the reference is in a type context.
		 * @private
		 */
		function isInTypeContext(reference) {
			const parent = asNode(reference.identifier).parent;

			return TYPE_NODES.has(parent.type);
		}

		return {
			/**
			 * Reports every reference to a restricted global in the file.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			Program(node) {
				const scope = sourceCode.getScope(node);

				// Report variables declared elsewhere (ex: variables defined as "global" by eslint)
				scope.variables.forEach(variable => {
					if (!variable.defs.length && isRestricted(variable.name)) {
						variable.references.forEach(reference => {
							if (!isInTypeContext(reference)) {
								reportReference(reference);
							}
						});
					}
				});

				// Report variables not declared at all
				scope.through.forEach(reference => {
					if (
						isRestricted(reference.identifier.name) &&
						!isInTypeContext(reference)
					) {
						reportReference(reference);
					}
				});
			},

			/**
			 * Reports restricted globals accessed as a property of a global
			 * object, such as `window.event`.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				if (!checkGlobalObject) {
					return;
				}

				const globalScope = sourceCode.getScope(node);
				globalObjects.forEach(globalObjectName => {
					const variable = astUtils.getVariableByName(
						globalScope,
						globalObjectName,
					);

					if (!variable) {
						return;
					}

					variable.references.forEach(reference => {
						const identifier = asNode(reference.identifier);
						let parent = identifier.parent;

						// To detect code like `window.window.Promise`.
						while (
							astUtils.isSpecificMemberAccess(
								parent,
								null,
								globalObjectName,
							)
						) {
							parent = parent.parent;
						}

						const propertyName =
							astUtils.getStaticPropertyName(parent);
						if (propertyName && isRestricted(propertyName)) {
							const customMessage =
								restrictedGlobalMessages[propertyName];
							const messageId = customMessage
								? "customMessage"
								: "defaultMessage";

							context.report({
								node: parent.property,
								messageId,
								data: {
									name: propertyName,
									customMessage,
								},
							});
						}
					});
				});
			},
		};
	},
};

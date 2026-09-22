/**
 * @fileoverview Rule to disallow certain object properties
 * @author Will Klein & Eli White
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * One entry of the rule's options. The schema requires `object` or `property`
 * (or both), and forbids pairing `allowObjects` with `object` or
 * `allowProperties` with `property`, so every member is individually optional.
 * @typedef {Object} RestrictedPropertyOption
 * @property {string} [object] The name of the object the restriction applies to.
 * @property {string} [property] The name of the property the restriction applies to.
 * @property {Array<string>} [allowObjects] The objects the restricted property is still allowed on.
 * @property {Array<string>} [allowProperties] The properties still allowed on the restricted object.
 * @property {string} [message] The custom message to append to the report.
 */

/**
 * A restriction as it is stored in one of the lookup tables below: the parts of
 * a `RestrictedPropertyOption` that survive once the name it was keyed by has
 * been split off.
 * @typedef {Object} Restriction
 * @property {Array<string>} [allowObjects] The objects the restricted property is still allowed on.
 * @property {Array<string>} [allowProperties] The properties still allowed on the restricted object.
 * @property {string} [message] The custom message to append to the report.
 */

/**
 * The name a lookup table is keyed by. It is wider than `string` at both ends.
 * An option that restricts a property everywhere carries no `object` and one
 * that restricts an object carries no `property`, so the name an entry is
 * filed under is the one the option did supply. A lookup then uses a name read
 * off the AST, which is absent when the object is not a plain identifier —
 * `undefined` for a member expression whose object is not an `Identifier`,
 * `null` for an object pattern that is not destructuring one — and a miss is
 * the intended answer for those.
 * @typedef {string | null | undefined} RestrictedName
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow certain properties on certain objects",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-restricted-properties",
		},

		schema: {
			type: "array",
			items: {
				type: "object",
				properties: {
					object: {
						type: "string",
					},
					property: {
						type: "string",
					},
					allowObjects: {
						type: "array",
						items: {
							type: "string",
						},
						uniqueItems: true,
					},
					allowProperties: {
						type: "array",
						items: {
							type: "string",
						},
						uniqueItems: true,
					},
					message: {
						type: "string",
					},
				},
				anyOf: [
					{
						required: ["object"],
					},
					{
						required: ["property"],
					},
				],
				not: {
					anyOf: [
						{ required: ["allowObjects", "object"] },
						{ required: ["allowProperties", "property"] },
					],
				},
				additionalProperties: false,
			},
			uniqueItems: true,
		},

		defaultOptions: [],

		messages: {
			restrictedObjectProperty:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{objectName}}.{{propertyName}}' is restricted from being used.{{allowedPropertiesMessage}}{{message}}",
			restrictedProperty:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{propertyName}}' is restricted from being used.{{allowedObjectsMessage}}{{message}}",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/** @type {Array<RestrictedPropertyOption>} */
		const restrictedCalls = context.options;

		if (restrictedCalls.length === 0) {
			return {};
		}

		/** @type {Map<RestrictedName, Map<string, Restriction>>} */
		const restrictedProperties = new Map();
		/** @type {Map<RestrictedName, Restriction>} */
		const globallyRestrictedObjects = new Map();
		/** @type {Map<RestrictedName, Restriction>} */
		const globallyRestrictedProperties = new Map();

		restrictedCalls.forEach(option => {
			const objectName = option.object;
			const propertyName = option.property;

			if (typeof objectName === "undefined") {
				globallyRestrictedProperties.set(propertyName, {
					allowObjects: option.allowObjects,
					message: option.message,
				});
			} else if (typeof propertyName === "undefined") {
				globallyRestrictedObjects.set(objectName, {
					allowProperties: option.allowProperties,
					message: option.message,
				});
			} else {
				if (!restrictedProperties.has(objectName)) {
					restrictedProperties.set(objectName, new Map());
				}

				// The `has()` check above guarantees the inner map exists.
				/** @type {Map<string, Restriction>} */ (
					restrictedProperties.get(objectName)
				).set(propertyName, {
					message: option.message,
				});
			}
		});

		/**
		 * Checks if a name is in the allowed list.
		 * @param {RestrictedName} name The name to check
		 * @param {Array<string>} [allowedList] The list of allowed names
		 * @returns {boolean} True if the name is allowed, false otherwise
		 */
		function isAllowed(name, allowedList) {
			if (!allowedList) {
				return false;
			}

			return allowedList.includes(/** @type {string} */ (name));
		}

		/**
		 * Checks to see whether a property access is restricted, and reports it if so.
		 * @param {ASTNode} node The node to report
		 * @param {RestrictedName} objectName The name of the object
		 * @param {string | null} propertyName The name of the property
		 * @returns {void}
		 */
		function checkPropertyAccess(node, objectName, propertyName) {
			if (propertyName === null) {
				return;
			}
			const matchedObject = restrictedProperties.get(objectName);
			const matchedObjectProperty = matchedObject
				? matchedObject.get(propertyName)
				: globallyRestrictedObjects.get(objectName);
			const globalMatchedProperty =
				globallyRestrictedProperties.get(propertyName);

			if (
				matchedObjectProperty &&
				!isAllowed(propertyName, matchedObjectProperty.allowProperties)
			) {
				const message = matchedObjectProperty.message
					? ` ${matchedObjectProperty.message}`
					: "";
				const allowedPropertiesMessage =
					matchedObjectProperty.allowProperties
						? ` Only these properties are allowed: ${matchedObjectProperty.allowProperties.join(", ")}.`
						: "";

				context.report({
					node,
					messageId: "restrictedObjectProperty",
					data: {
						objectName,
						propertyName,
						message,
						allowedPropertiesMessage,
					},
				});
			} else if (
				globalMatchedProperty &&
				!isAllowed(objectName, globalMatchedProperty.allowObjects)
			) {
				const message = globalMatchedProperty.message
					? ` ${globalMatchedProperty.message}`
					: "";
				const allowedObjectsMessage = globalMatchedProperty.allowObjects
					? ` Property '${propertyName}' is only allowed on these objects: ${globalMatchedProperty.allowObjects.join(", ")}.`
					: "";

				context.report({
					node,
					messageId: "restrictedProperty",
					data: {
						propertyName,
						message,
						allowedObjectsMessage,
					},
				});
			}
		}

		return {
			/**
			 * Checks a property access written as `object.property`.
			 * @param {ASTNode} node The `MemberExpression` node.
			 * @returns {void}
			 */
			MemberExpression(node) {
				checkPropertyAccess(
					node,
					node.object && node.object.name,
					astUtils.getStaticPropertyName(node),
				);
			},
			/**
			 * Checks the property accesses a destructuring pattern performs.
			 * @param {ASTNode} node The `ObjectPattern` node.
			 * @returns {void}
			 */
			ObjectPattern(node) {
				/** @type {RestrictedName} */
				let objectName = null;

				if (node.parent.type === "VariableDeclarator") {
					if (
						node.parent.init &&
						node.parent.init.type === "Identifier"
					) {
						objectName = node.parent.init.name;
					}
				} else if (
					node.parent.type === "AssignmentExpression" ||
					node.parent.type === "AssignmentPattern"
				) {
					if (node.parent.right.type === "Identifier") {
						objectName = node.parent.right.name;
					}
				}

				node.properties.forEach((/** @type {ASTNode} */ property) => {
					checkPropertyAccess(
						node,
						objectName,
						astUtils.getStaticPropertyName(property),
					);
				});
			},
		};
	},
};

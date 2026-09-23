/**
 * @fileoverview Rule that warns when identifier names are shorter or longer
 * than the values provided in configuration.
 * @author Burak Yigit Kaya aka BYK
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { getGraphemeCount } = require("../shared/string-utils");
const {
	getModuleExportName,
	isImportAttributeKey,
} = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * A test for whether an identifier in a given syntactic position is one this
 * rule checks. `true` means every identifier in that position is checked;
 * a function narrows it further by inspecting the parent and the node.
 * @typedef {true | ((parent: ASTNode, node: ASTNode) => boolean)} ExpressionCheck
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				exceptionPatterns: [],
				exceptions: [],
				min: 2,
				properties: "always",
			},
		],

		docs: {
			description: "Enforce minimum and maximum identifier lengths",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/id-length",
		},

		schema: [
			{
				type: "object",
				properties: {
					min: {
						type: "integer",
					},
					max: {
						type: "integer",
					},
					exceptions: {
						type: "array",
						uniqueItems: true,
						items: {
							type: "string",
						},
					},
					exceptionPatterns: {
						type: "array",
						uniqueItems: true,
						items: {
							type: "string",
						},
					},
					properties: {
						enum: ["always", "never"],
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			tooShort: "Identifier name '{{name}}' is too short (< {{min}}).",
			tooShortPrivate:
				"Identifier name '#{{name}}' is too short (< {{min}}).",
			tooLong: "Identifier name '{{name}}' is too long (> {{max}}).",
			tooLongPrivate:
				"Identifier name #'{{name}}' is too long (> {{max}}).",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [options] = context.options;
		const { max: maxLength = Infinity, min: minLength } = options;
		const properties = options.properties !== "never";
		const exceptions = new Set(options.exceptions);
		/**
		 * The compiled `exceptionPatterns` option. `meta.schema` validated it as
		 * an array of strings before `create()` ran.
		 * @type {Array<RegExp>}
		 */
		const exceptionPatterns = options.exceptionPatterns.map(
			(/** @type {string} */ pattern) => new RegExp(pattern, "u"),
		);
		const reportedNodes = new Set();

		/**
		 * Checks if a string matches the provided exception patterns
		 * @param {string} name The string to check.
		 * @returns {boolean} if the string is a match
		 * @private
		 */
		function matchesExceptionPattern(name) {
			return exceptionPatterns.some(pattern => pattern.test(name));
		}

		/**
		 * The syntactic positions this rule checks identifiers in, keyed by the
		 * parent node's `type`. A `false` value disables that position entirely.
		 * @type {Record<string, ExpressionCheck | false>}
		 */
		const SUPPORTED_EXPRESSIONS = {
			MemberExpression:
				properties &&
				/**
				 * Checks whether a member expression names a property the rule owns.
				 * @param {ASTNode} parent The `MemberExpression` node.
				 * @returns {boolean} `true` if the property name should be checked.
				 */
				function (parent) {
					return (
						!parent.computed &&
						// regular property assignment
						((parent.parent.left === parent &&
							parent.parent.type === "AssignmentExpression") ||
							// or the last identifier in an ObjectPattern destructuring
							(parent.parent.type === "Property" &&
								parent.parent.value === parent &&
								parent.parent.parent.type === "ObjectPattern" &&
								parent.parent.parent.parent.left ===
									parent.parent.parent))
					);
				},
			/**
			 * Checks whether the identifier is the target of a default value.
			 * @param {ASTNode} parent The `AssignmentPattern` node.
			 * @param {ASTNode} node The identifier node.
			 * @returns {boolean} `true` if the identifier should be checked.
			 */
			AssignmentPattern(parent, node) {
				return parent.left === node;
			},

			/**
			 * Checks whether the identifier is the name being declared.
			 * @param {ASTNode} parent The `VariableDeclarator` node.
			 * @param {ASTNode} node The identifier node.
			 * @returns {boolean} `true` if the identifier should be checked.
			 */
			VariableDeclarator(parent, node) {
				return parent.id === node;
			},

			/**
			 * Checks whether the identifier names a property the rule owns.
			 * @param {ASTNode} parent The `Property` node.
			 * @param {ASTNode} node The identifier node.
			 * @returns {boolean} `true` if the identifier should be checked.
			 */
			Property(parent, node) {
				if (parent.parent.type === "ObjectPattern") {
					const isKeyAndValueSame =
						parent.value.name === parent.key.name;

					return (
						(!isKeyAndValueSame && parent.value === node) ||
						(isKeyAndValueSame && parent.key === node && properties)
					);
				}
				return (
					properties &&
					!isImportAttributeKey(node) &&
					!parent.computed &&
					parent.key.name === node.name
				);
			},
			/**
			 * Checks whether the imported binding was renamed locally.
			 * @param {ASTNode} parent The `ImportSpecifier` node.
			 * @param {ASTNode} node The identifier node.
			 * @returns {boolean} `true` if the identifier should be checked.
			 */
			ImportSpecifier(parent, node) {
				return (
					parent.local === node &&
					getModuleExportName(parent.imported) !==
						getModuleExportName(parent.local)
				);
			},
			ImportDefaultSpecifier: true,
			ImportNamespaceSpecifier: true,
			RestElement: true,
			FunctionExpression: true,
			ArrowFunctionExpression: true,
			ClassDeclaration: true,
			FunctionDeclaration: true,
			MethodDefinition: true,
			PropertyDefinition: true,
			CatchClause: true,
			ArrayPattern: true,
		};

		return {
			/**
			 * Checks an identifier's length against the configured bounds.
			 * @param {ASTNode} node The `Identifier` or `PrivateIdentifier` node.
			 * @returns {void} No return value.
			 */
			// The linter stringifies an array key into a comma-separated selector.
			[/** @type {any} */ (["Identifier", "PrivateIdentifier"])](node) {
				const name = node.name;
				const parent = node.parent;

				const nameLength = getGraphemeCount(name);

				const isShort = nameLength < minLength;
				const isLong = nameLength > maxLength;

				if (
					!(isShort || isLong) ||
					exceptions.has(name) ||
					matchesExceptionPattern(name)
				) {
					return; // Nothing to report
				}

				const isValidExpression = SUPPORTED_EXPRESSIONS[parent.type];

				/*
				 * We used the range instead of the node because it's possible
				 * for the same identifier to be represented by two different
				 * nodes, with the most clear example being shorthand properties:
				 * { foo }
				 * In this case, "foo" is represented by one node for the name
				 * and one for the value. The only way to know they are the same
				 * is to look at the range.
				 */
				if (
					isValidExpression &&
					!reportedNodes.has(node.range.toString()) &&
					(isValidExpression === true ||
						isValidExpression(parent, node))
				) {
					reportedNodes.add(node.range.toString());

					let messageId = isShort ? "tooShort" : "tooLong";

					if (node.type === "PrivateIdentifier") {
						messageId += "Private";
					}

					context.report({
						node,
						messageId,
						data: { name, min: minLength, max: maxLength },
					});
				}
			},
		};
	},
};

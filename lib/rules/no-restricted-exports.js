/**
 * @fileoverview Rule to disallow specified names in exports
 * @author Milos Djermanovic
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
/** @typedef {import("eslint-scope").Definition} Definition */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types `Definition#name` as a bare ESTree `Identifier`: no
 * `parent`, and `range` and `loc` optional. The linter populates all three
 * before any rule runs, so this is the same object a visitor would have
 * received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow specified names in exports",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-restricted-exports",
		},

		schema: [
			{
				anyOf: [
					{
						type: "object",
						properties: {
							restrictedNamedExports: {
								type: "array",
								items: {
									type: "string",
								},
								uniqueItems: true,
							},
							restrictedNamedExportsPattern: { type: "string" },
						},
						additionalProperties: false,
					},
					{
						type: "object",
						properties: {
							restrictedNamedExports: {
								type: "array",
								items: {
									type: "string",
									pattern: "^(?!default$)",
								},
								uniqueItems: true,
							},
							restrictedNamedExportsPattern: { type: "string" },
							restrictDefaultExports: {
								type: "object",
								properties: {
									// Allow/Disallow `export default foo; export default 42; export default function foo() {}` format
									direct: {
										type: "boolean",
									},

									// Allow/Disallow `export { foo as default };` declarations
									named: {
										type: "boolean",
									},

									//  Allow/Disallow `export { default } from "mod"; export { default as default } from "mod";` declarations
									defaultFrom: {
										type: "boolean",
									},

									//  Allow/Disallow `export { foo as default } from "mod";` declarations
									namedFrom: {
										type: "boolean",
									},

									//  Allow/Disallow `export * as default from "mod"`; declarations
									namespaceFrom: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
						},
						additionalProperties: false,
					},
				],
			},
		],

		defaultOptions: [{}],

		messages: {
			restrictedNamed:
				"'{{name}}' is restricted from being used as an exported name.",
			restrictedDefault: "Exporting 'default' is restricted.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const {
			restrictedNamedExports,
			restrictedNamedExportsPattern: restrictedNamePattern,
			restrictDefaultExports,
		} = context.options[0];
		const restrictedNames = new Set(restrictedNamedExports);
		const sourceCode = context.sourceCode;

		/**
		 * Checks and reports given exported name.
		 * @param {ASTNode} node exported `Identifier` or string `Literal` node to check.
		 * @returns {void}
		 */
		function checkExportedName(node) {
			const name = astUtils.getModuleExportName(node);

			let matchesRestrictedNamePattern = false;

			if (restrictedNamePattern && name !== "default") {
				const patternRegex = new RegExp(restrictedNamePattern, "u");

				matchesRestrictedNamePattern = patternRegex.test(name);
			}

			if (matchesRestrictedNamePattern || restrictedNames.has(name)) {
				context.report({
					node,
					messageId: "restrictedNamed",
					data: { name },
				});
				return;
			}

			if (name === "default") {
				if (node.parent.type === "ExportAllDeclaration") {
					if (
						restrictDefaultExports &&
						restrictDefaultExports.namespaceFrom
					) {
						context.report({
							node,
							messageId: "restrictedDefault",
						});
					}
				} else {
					// ExportSpecifier
					const isSourceSpecified = !!node.parent.parent.source;
					const specifierLocalName = astUtils.getModuleExportName(
						node.parent.local,
					);

					if (
						!isSourceSpecified &&
						restrictDefaultExports &&
						restrictDefaultExports.named
					) {
						context.report({
							node,
							messageId: "restrictedDefault",
						});
						return;
					}

					if (isSourceSpecified && restrictDefaultExports) {
						if (
							(specifierLocalName === "default" &&
								restrictDefaultExports.defaultFrom) ||
							(specifierLocalName !== "default" &&
								restrictDefaultExports.namedFrom)
						) {
							context.report({
								node,
								messageId: "restrictedDefault",
							});
						}
					}
				}
			}
		}

		return {
			/**
			 * Checks the exported name of `export * as name from "mod";`.
			 * @param {ASTNode} node The `ExportAllDeclaration` node.
			 * @returns {void}
			 */
			ExportAllDeclaration(node) {
				if (node.exported) {
					checkExportedName(node.exported);
				}
			},

			/**
			 * Checks a direct default export.
			 * @param {ASTNode} node The `ExportDefaultDeclaration` node.
			 * @returns {void}
			 */
			ExportDefaultDeclaration(node) {
				if (restrictDefaultExports && restrictDefaultExports.direct) {
					context.report({
						node,
						messageId: "restrictedDefault",
					});
				}
			},

			/**
			 * Checks every name a named export declaration exports.
			 * @param {ASTNode} node The `ExportNamedDeclaration` node.
			 * @returns {void}
			 */
			ExportNamedDeclaration(node) {
				const declaration = node.declaration;

				if (declaration) {
					if (
						declaration.type === "FunctionDeclaration" ||
						declaration.type === "ClassDeclaration"
					) {
						checkExportedName(declaration.id);
					} else if (declaration.type === "VariableDeclaration") {
						sourceCode
							.getDeclaredVariables(declaration)
							.map(v =>
								v.defs.find(d => d.parent === declaration),
							)
							.map(d =>
								asNode(/** @type {Definition} */ (d).name),
							) // Identifier nodes
							.forEach(checkExportedName);
					}
				} else {
					node.specifiers
						.map((/** @type {ASTNode} */ s) => s.exported)
						.forEach(checkExportedName);
				}
			},
		};
	},
};

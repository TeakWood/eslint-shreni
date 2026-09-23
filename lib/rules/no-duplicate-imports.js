/**
 * @fileoverview Restrict usage of duplicate imports.
 * @author Simen Bekkhus
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * An (import|export) declaration recorded for a module, together with which of
 * the two kinds of declaration it was seen as.
 * @typedef {Object} DeclarationEntry
 * @property {ASTNode} node The (import|export) declaration node.
 * @property {string} declarationType A declaration type, either "import" or "export".
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const NAMED_TYPES = ["ImportSpecifier", "ExportSpecifier"];
const NAMESPACE_TYPES = [
	"ImportNamespaceSpecifier",
	"ExportNamespaceSpecifier",
];

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/**
 * Check if an import/export type belongs to (ImportSpecifier|ExportSpecifier) or (ImportNamespaceSpecifier|ExportNamespaceSpecifier).
 * @param {string} importExportType An import/export type to check.
 * @param {string} type Can be "named" or "namespace"
 * @returns {boolean} True if import/export type belongs to (ImportSpecifier|ExportSpecifier) or (ImportNamespaceSpecifier|ExportNamespaceSpecifier) and false if it doesn't.
 */
function isImportExportSpecifier(importExportType, type) {
	const arrayToCheck = type === "named" ? NAMED_TYPES : NAMESPACE_TYPES;

	return arrayToCheck.includes(importExportType);
}

/**
 * Return the type of (import|export).
 * @param {ASTNode} node A node to get.
 * @returns {string} The type of the (import|export).
 */
function getImportExportType(node) {
	if (node.specifiers && node.specifiers.length > 0) {
		// the guard above establishes that this declaration carries specifiers
		const nodeSpecifiers = /** @type {Array<ASTNode>} */ (node.specifiers);
		const index = nodeSpecifiers.findIndex(
			({ type }) =>
				isImportExportSpecifier(type, "named") ||
				isImportExportSpecifier(type, "namespace"),
		);
		const i = index > -1 ? index : 0;

		return nodeSpecifiers[i].type;
	}
	if (node.type === "ExportAllDeclaration") {
		if (node.exported) {
			return "ExportNamespaceSpecifier";
		}
		return "ExportAll";
	}
	return "SideEffectImport";
}

/**
 * Returns a boolean indicates if two (import|export) can be merged
 * @param {ASTNode} node1 A node to check.
 * @param {ASTNode} node2 A node to check.
 * @returns {boolean} True if two (import|export) can be merged, false if they can't.
 */
function isImportExportCanBeMerged(node1, node2) {
	const importExportType1 = getImportExportType(node1);
	const importExportType2 = getImportExportType(node2);

	if (
		(node1.importKind === "type" || node1.exportKind === "type") &&
		(node2.importKind === "type" || node2.exportKind === "type")
	) {
		const isDefault1 = importExportType1 === "ImportDefaultSpecifier";
		const isDefault2 = importExportType2 === "ImportDefaultSpecifier";
		const isNamed1 = isImportExportSpecifier(importExportType1, "named");
		const isNamed2 = isImportExportSpecifier(importExportType2, "named");

		if ((isDefault1 && isNamed2) || (isDefault2 && isNamed1)) {
			return false;
		}
	}

	if (
		(importExportType1 === "ExportAll" &&
			importExportType2 !== "ExportAll" &&
			importExportType2 !== "SideEffectImport") ||
		(importExportType1 !== "ExportAll" &&
			importExportType1 !== "SideEffectImport" &&
			importExportType2 === "ExportAll")
	) {
		return false;
	}
	if (
		(isImportExportSpecifier(importExportType1, "namespace") &&
			isImportExportSpecifier(importExportType2, "named")) ||
		(isImportExportSpecifier(importExportType2, "namespace") &&
			isImportExportSpecifier(importExportType1, "named"))
	) {
		return false;
	}
	return true;
}

/**
 * Returns a boolean if we should report (import|export).
 * @param {ASTNode} node A node to be reported or not.
 * @param {Array<ASTNode>} previousNodes An array contains previous nodes of the module imported or exported.
 * @param {boolean} allowSeparateTypeImports Whether to allow separate type and value imports.
 * @returns {boolean} True if the (import|export) should be reported.
 */
function shouldReportImportExport(
	node,
	previousNodes,
	allowSeparateTypeImports,
) {
	let i = 0;

	while (i < previousNodes.length) {
		const previousNode = previousNodes[i];

		if (allowSeparateTypeImports) {
			const isTypeNode =
				node.importKind === "type" || node.exportKind === "type";
			const isTypePrevious =
				previousNode.importKind === "type" ||
				previousNode.exportKind === "type";

			if (isTypeNode !== isTypePrevious) {
				i++;
				continue;
			}
		}

		if (isImportExportCanBeMerged(node, previousNode)) {
			return true;
		}
		i++;
	}
	return false;
}

/**
 * Returns array contains only nodes with declarations types equal to type.
 * @param {Array<DeclarationEntry>} nodes An array contains objects, each object contains a node and a declaration type.
 * @param {string} type Declaration type.
 * @returns {Array<ASTNode>} An array contains only nodes with declarations types equal to type.
 */
function getNodesByDeclarationType(nodes, type) {
	return nodes
		.filter(({ declarationType }) => declarationType === type)
		.map(({ node }) => node);
}

/**
 * Returns the name of the module imported or re-exported.
 * @param {ASTNode} node A node to get.
 * @returns {string} The name of the module, or empty string if no name.
 */
function getModule(node) {
	if (node && node.source && node.source.value) {
		return node.source.value.trim();
	}
	return "";
}

/**
 * Checks if the (import|export) can be merged with at least one import or one export, and reports if so.
 * @param {RuleContext} context The ESLint rule context object.
 * @param {ASTNode} node A node to get.
 * @param {Map<string, Array<DeclarationEntry>>} modules A Map object contains as a key a module name and as value an array contains objects, each object contains a node and a declaration type.
 * @param {string} declarationType A declaration type can be an import or export.
 * @param {boolean} includeExports Whether or not to check for exports in addition to imports.
 * @param {boolean} allowSeparateTypeImports Whether to allow separate type and value imports.
 * @returns {void} No return value.
 */
function checkAndReport(
	context,
	node,
	modules,
	declarationType,
	includeExports,
	allowSeparateTypeImports,
) {
	const module = getModule(node);

	if (modules.has(module)) {
		// the `has()` guard above establishes that this key is present
		const previousNodes = /** @type {Array<DeclarationEntry>} */ (
			modules.get(module)
		);
		const messagesIds = [];
		const importNodes = getNodesByDeclarationType(previousNodes, "import");
		let exportNodes;

		if (includeExports) {
			exportNodes = getNodesByDeclarationType(previousNodes, "export");
		}
		if (declarationType === "import") {
			if (
				shouldReportImportExport(
					node,
					importNodes,
					allowSeparateTypeImports,
				)
			) {
				messagesIds.push("import");
			}
			if (includeExports) {
				if (
					shouldReportImportExport(
						node,
						// `includeExports` is the same condition that assigned `exportNodes`
						/** @type {Array<ASTNode>} */ (exportNodes),
						allowSeparateTypeImports,
					)
				) {
					messagesIds.push("importAs");
				}
			}
		} else if (declarationType === "export") {
			if (
				shouldReportImportExport(
					node,
					// the "export" declaration type is only ever passed in when `includeExports` is on, which is what assigned `exportNodes`
					/** @type {Array<ASTNode>} */ (exportNodes),
					allowSeparateTypeImports,
				)
			) {
				messagesIds.push("export");
			}
			if (
				shouldReportImportExport(
					node,
					importNodes,
					allowSeparateTypeImports,
				)
			) {
				messagesIds.push("exportAs");
			}
		}
		messagesIds.forEach(messageId =>
			context.report({
				node,
				messageId,
				data: {
					module,
				},
			}),
		);
	}
}

/**
 * Returns a function handling the (imports|exports) of a given file
 * @param {RuleContext} context The ESLint rule context object.
 * @param {Map<string, Array<DeclarationEntry>>} modules A Map object contains as a key a module name and as value an array contains objects, each object contains a node and a declaration type.
 * @param {string} declarationType A declaration type can be an import or export.
 * @param {boolean} includeExports Whether or not to check for exports in addition to imports.
 * @param {boolean} allowSeparateTypeImports Whether to allow separate type and value imports.
 * @returns {(node: ASTNode) => void} A function passed to ESLint to handle the statement.
 */
function handleImportsExports(
	context,
	modules,
	declarationType,
	includeExports,
	allowSeparateTypeImports,
) {
	/**
	 * Checks one (import|export) declaration and records it against its module.
	 * @param {ASTNode} node The (import|export) declaration to handle.
	 * @returns {void} No return value.
	 */
	return function (node) {
		const module = getModule(node);

		if (module) {
			checkAndReport(
				context,
				node,
				modules,
				declarationType,
				includeExports,
				allowSeparateTypeImports,
			);
			const currentNode = { node, declarationType };
			let nodes = [currentNode];

			if (modules.has(module)) {
				// the `has()` guard above establishes that this key is present
				const previousNodes = /** @type {Array<DeclarationEntry>} */ (
					modules.get(module)
				);

				nodes = [...previousNodes, currentNode];
			}
			modules.set(module, nodes);
		}
	};
}

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				includeExports: false,
				allowSeparateTypeImports: false,
			},
		],

		docs: {
			description: "Disallow duplicate module imports",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-duplicate-imports",
		},

		schema: [
			{
				type: "object",
				properties: {
					includeExports: {
						type: "boolean",
					},
					allowSeparateTypeImports: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			import: "'{{module}}' import is duplicated.",
			importAs: "'{{module}}' import is duplicated as export.",
			export: "'{{module}}' export is duplicated.",
			exportAs: "'{{module}}' export is duplicated as import.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const [{ includeExports, allowSeparateTypeImports }] = context.options;
		/** @type {Map<string, Array<DeclarationEntry>>} */
		const modules = new Map();
		/** @type {RuleVisitor} */
		const handlers = {
			ImportDeclaration: handleImportsExports(
				context,
				modules,
				"import",
				includeExports,
				allowSeparateTypeImports,
			),
		};

		if (includeExports) {
			handlers.ExportNamedDeclaration = handleImportsExports(
				context,
				modules,
				"export",
				includeExports,
				allowSeparateTypeImports,
			);
			handlers.ExportAllDeclaration = handleImportsExports(
				context,
				modules,
				"export",
				includeExports,
				allowSeparateTypeImports,
			);
		}
		return handlers;
	},
};

/**
 * @fileoverview Restrict usage of specified node imports.
 * @author Guy Ellis
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
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/ast-utils.js").SourceLocation} SourceLocation */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("ignore").Ignore} Ignore */

/**
 * The object form of a `paths` entry. The string form is just the import
 * source, and is expanded into an entry with no further restrictions.
 * @typedef {Object} RestrictedPathOption
 * @property {string} name The restricted import source.
 * @property {string} [message] The custom message to append to the report.
 * @property {Array<string>} [importNames] The import names that are restricted from this source.
 * @property {Array<string>} [allowImportNames] The only import names allowed from this source.
 * @property {boolean} [allowTypeImports] Whether type-only imports of this source are allowed.
 */
/**
 * One restriction recorded against an import source. A string entry in `paths`
 * restricts the source outright and contributes an empty entry, so every
 * member is optional.
 * @typedef {Object} RestrictedPathEntry
 * @property {string} [message] The custom message to append to the report.
 * @property {Array<string>} [importNames] The import names that are restricted from this source.
 * @property {Array<string>} [allowImportNames] The only import names allowed from this source.
 * @property {boolean} [allowTypeImports] Whether type-only imports of this source are allowed.
 */
/**
 * A `patterns` entry as the user wrote it, once the array-of-strings shorthand
 * has been folded into a single entry with a `group`. `meta.schema` requires
 * exactly one of `group` and `regex`, and forbids most combinations of the
 * name restrictions, so everything is optional here.
 * @typedef {Object} RestrictedPatternOption
 * @property {Array<string>} [group] The gitignore-style patterns the import source is matched against.
 * @property {string} [regex] The regular expression source the import source is matched against.
 * @property {string} [message] The custom message to append to the report.
 * @property {boolean} [caseSensitive] Whether the match is case-sensitive.
 * @property {Array<string>} [importNames] The import names that are restricted from a matching source.
 * @property {string} [importNamePattern] The regular expression source that restricted import names match.
 * @property {Array<string>} [allowImportNames] The only import names allowed from a matching source.
 * @property {string} [allowImportNamePattern] The regular expression source that allowed import names match.
 * @property {boolean} [allowTypeImports] Whether type-only imports of a matching source are allowed.
 */
/**
 * A `patterns` entry with its matchers compiled. Exactly one of `matcher` and
 * `regexMatcher` is present, because `meta.schema` requires exactly one of
 * `group` and `regex`.
 * @typedef {Object} RestrictedPatternGroup
 * @property {Ignore} [matcher] Matches the import source against the entry's `group`.
 * @property {RegExp} [regexMatcher] Matches the import source against the entry's `regex`.
 * @property {string} [customMessage] The custom message to append to the report.
 * @property {Array<string>} [importNames] The import names that are restricted from a matching source.
 * @property {string} [importNamePattern] The regular expression source that restricted import names match.
 * @property {Array<string>} [allowImportNames] The only import names allowed from a matching source.
 * @property {string} [allowImportNamePattern] The regular expression source that allowed import names match.
 * @property {boolean} [allowTypeImports] Whether type-only imports of a matching source are allowed.
 */
/**
 * One occurrence of an import name in a declaration, as collected by
 * `checkNode()`.
 * @typedef {Object} SpecifierData
 * @property {SourceLocation} loc The location to report the problem at.
 * @property {ASTNode} [specifier] The specifier node the name came from. The `*` of an `export * from` has no specifier node of its own, and is located by its `*` token instead.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Format import names for error messages.
 * @param {Array<string>} importNames The import names to format.
 * @returns {string} The formatted import names.
 */
function formatImportNames(importNames) {
	return new Intl.ListFormat("en-US").format(
		importNames.map(name => `'${name}'`),
	);
}

/**
 * Returns "is" or "are" based on the number of import names.
 * @param {Array<string>} importNames The import names to check.
 * @returns {string} "is" if one import name, otherwise "are".
 */
function isOrAre(importNames) {
	return importNames.length === 1 ? "is" : "are";
}

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
					importNames: {
						type: "array",
						items: {
							type: "string",
						},
					},
					allowImportNames: {
						type: "array",
						items: {
							type: "string",
						},
					},
					allowTypeImports: {
						type: "boolean",
						description:
							"Whether to allow type-only imports for a path.",
					},
				},
				additionalProperties: false,
				required: ["name"],
				not: { required: ["importNames", "allowImportNames"] },
			},
		],
	},
	uniqueItems: true,
};

const arrayOfStringsOrObjectPatterns = {
	anyOf: [
		{
			type: "array",
			items: {
				type: "string",
			},
			uniqueItems: true,
		},
		{
			type: "array",
			items: {
				type: "object",
				properties: {
					importNames: {
						type: "array",
						items: {
							type: "string",
						},
						minItems: 1,
						uniqueItems: true,
					},
					allowImportNames: {
						type: "array",
						items: {
							type: "string",
						},
						minItems: 1,
						uniqueItems: true,
					},
					group: {
						type: "array",
						items: {
							type: "string",
						},
						minItems: 1,
						uniqueItems: true,
					},
					regex: {
						type: "string",
					},
					importNamePattern: {
						type: "string",
					},
					allowImportNamePattern: {
						type: "string",
					},
					message: {
						type: "string",
						minLength: 1,
					},
					caseSensitive: {
						type: "boolean",
					},
					allowTypeImports: {
						type: "boolean",
						description:
							"Whether to allow type-only imports for a pattern.",
					},
				},
				additionalProperties: false,
				not: {
					anyOf: [
						{ required: ["importNames", "allowImportNames"] },
						{
							required: [
								"importNamePattern",
								"allowImportNamePattern",
							],
						},
						{ required: ["importNames", "allowImportNamePattern"] },
						{ required: ["importNamePattern", "allowImportNames"] },
						{
							required: [
								"allowImportNames",
								"allowImportNamePattern",
							],
						},
					],
				},
				oneOf: [{ required: ["group"] }, { required: ["regex"] }],
			},
			uniqueItems: true,
		},
	],
};

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow specified modules when loaded by `import`",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-restricted-imports",
		},

		messages: {
			path: "'{{importSource}}' import is restricted from being used.",
			pathWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{importSource}}' import is restricted from being used. {{customMessage}}",

			patterns:
				"'{{importSource}}' import is restricted from being used by a pattern.",
			patternWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{importSource}}' import is restricted from being used by a pattern. {{customMessage}}",

			patternAndImportName:
				"'{{importName}}' import from '{{importSource}}' is restricted from being used by a pattern.",
			patternAndImportNameWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{importName}}' import from '{{importSource}}' is restricted from being used by a pattern. {{customMessage}}",

			patternAndEverything:
				"* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted from being used by a pattern.",

			patternAndEverythingWithRegexImportName:
				"* import is invalid because import name matching '{{importNames}}' pattern from '{{importSource}}' is restricted from being used.",
			patternAndEverythingWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted from being used by a pattern. {{customMessage}}",
			patternAndEverythingWithRegexImportNameAndCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"* import is invalid because import name matching '{{importNames}}' pattern from '{{importSource}}' is restricted from being used. {{customMessage}}",

			everything:
				"* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted.",
			everythingWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted. {{customMessage}}",

			importName:
				"'{{importName}}' import from '{{importSource}}' is restricted.",
			importNameWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{importName}}' import from '{{importSource}}' is restricted. {{customMessage}}",

			allowedImportName:
				"'{{importName}}' import from '{{importSource}}' is restricted because only {{allowedImportNames}} {{isOrAre}} allowed.",
			allowedImportNameWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{importName}}' import from '{{importSource}}' is restricted because only {{allowedImportNames}} {{isOrAre}} allowed. {{customMessage}}",

			everythingWithAllowImportNames:
				"* import is invalid because only {{allowedImportNames}} from '{{importSource}}' {{isOrAre}} allowed.",
			everythingWithAllowImportNamesAndCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"* import is invalid because only {{allowedImportNames}} from '{{importSource}}' {{isOrAre}} allowed. {{customMessage}}",

			allowedImportNamePattern:
				"'{{importName}}' import from '{{importSource}}' is restricted because only imports that match the pattern '{{allowedImportNamePattern}}' are allowed from '{{importSource}}'.",
			allowedImportNamePatternWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"'{{importName}}' import from '{{importSource}}' is restricted because only imports that match the pattern '{{allowedImportNamePattern}}' are allowed from '{{importSource}}'. {{customMessage}}",

			everythingWithAllowedImportNamePattern:
				"* import is invalid because only imports that match the pattern '{{allowedImportNamePattern}}' from '{{importSource}}' are allowed.",
			everythingWithAllowedImportNamePatternWithCustomMessage:
				// eslint-disable-next-line eslint-plugin/report-message-format -- Custom message might not end in a period
				"* import is invalid because only imports that match the pattern '{{allowedImportNamePattern}}' from '{{importSource}}' are allowed. {{customMessage}}",
		},

		schema: {
			anyOf: [
				arrayOfStringsOrObjects,
				{
					type: "array",
					items: [
						{
							type: "object",
							properties: {
								paths: arrayOfStringsOrObjects,
								patterns: arrayOfStringsOrObjectPatterns,
							},
							additionalProperties: false,
						},
					],
					additionalItems: false,
				},
			],
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const options = Array.isArray(context.options) ? context.options : [];
		const isPathAndPatternsObject =
			typeof options[0] === "object" &&
			(Object.hasOwn(options[0], "paths") ||
				Object.hasOwn(options[0], "patterns"));

		/** @type {Array<string | RestrictedPathOption>} */
		const restrictedPaths =
			(isPathAndPatternsObject ? options[0].paths : context.options) ||
			[];
		const groupedRestrictedPaths = restrictedPaths.reduce(
			(memo, importSource) => {
				const path =
					typeof importSource === "string"
						? importSource
						: importSource.name;

				if (!memo[path]) {
					memo[path] = [];
				}

				if (typeof importSource === "string") {
					memo[path].push({});
				} else {
					memo[path].push({
						message: importSource.message,
						importNames: importSource.importNames,
						allowImportNames: importSource.allowImportNames,
						allowTypeImports: importSource.allowTypeImports,
					});
				}
				return memo;
			},
			/** @type {Record<string, Array<RestrictedPathEntry>>} */ (
				Object.create(null)
			),
		);

		// Handle patterns too, either as strings or groups
		let restrictedPatterns =
			(isPathAndPatternsObject ? options[0].patterns : []) || [];

		// standardize to array of objects if we have an array of strings
		if (
			restrictedPatterns.length > 0 &&
			typeof restrictedPatterns[0] === "string"
		) {
			restrictedPatterns = [{ group: restrictedPatterns }];
		}

		/*
		 * Relative paths are supported for this rule. The array-of-strings
		 * shorthand has been folded into a single entry above, so every
		 * element is the object form by the time it is mapped.
		 */
		const restrictedPatternGroups =
			/** @type {Array<RestrictedPatternOption>} */ (
				restrictedPatterns
			).map(
				({
					group,
					regex,
					message,
					caseSensitive,
					importNames,
					importNamePattern,
					allowImportNames,
					allowImportNamePattern,
					allowTypeImports,
				}) => ({
					...(group
						? {
								matcher: ignore({
									allowRelativePaths: true,
									ignorecase: !caseSensitive,
								}).add(group),
							}
						: {}),
					...(typeof regex === "string"
						? {
								regexMatcher: new RegExp(
									regex,
									caseSensitive ? "u" : "iu",
								),
							}
						: {}),
					customMessage: message,
					importNames,
					importNamePattern,
					allowImportNames,
					allowImportNamePattern,
					allowTypeImports,
				}),
			);

		// if no imports are restricted we don't need to check
		if (
			Object.keys(restrictedPaths).length === 0 &&
			restrictedPatternGroups.length === 0
		) {
			return {};
		}

		/**
		 * Check if the node is a type-only import
		 * @param {ASTNode} node The node to check
		 * @returns {boolean} Whether the node is a type-only import
		 */
		function isTypeOnlyImport(node) {
			return (
				node.importKind === "type" ||
				(node.specifiers?.length > 0 &&
					node.specifiers.every(
						/**
						 * Check if a specifier is a type-only import specifier.
						 * @param {ASTNode} specifier The specifier to check.
						 * @returns {boolean} Whether the specifier is type-only.
						 */
						specifier => specifier.importKind === "type",
					))
			);
		}

		/**
		 * Check if a specifier is type-only
		 * @param {ASTNode | undefined} specifier The specifier to check. Only
		 * the `*` of an `export * from` is collected without a specifier node,
		 * and that name is reported before this is reached, so a specifier is
		 * always present here.
		 * @returns {boolean} Whether the specifier is type-only
		 */
		function isTypeOnlySpecifier(specifier) {
			const specifierNode = /** @type {ASTNode} */ (specifier);

			return (
				specifierNode.importKind === "type" ||
				specifierNode.exportKind === "type"
			);
		}

		/**
		 * Check if the node is a type-only export
		 * @param {ASTNode} node The node to check
		 * @returns {boolean} Whether the node is a type-only export
		 */
		function isTypeOnlyExport(node) {
			return (
				node.exportKind === "type" ||
				(node.specifiers?.length > 0 &&
					node.specifiers.every(
						/**
						 * Check if a specifier is a type-only export specifier.
						 * @param {ASTNode} specifier The specifier to check.
						 * @returns {boolean} Whether the specifier is type-only.
						 */
						specifier => specifier.exportKind === "type",
					))
			);
		}

		/**
		 * Report a restricted path.
		 * @param {string} importSource path of the import
		 * @param {Map<string, Array<SpecifierData>>} importNames Map of import names that are being imported
		 * @param {ASTNode} node representing the restricted path reference
		 * @returns {void}
		 * @private
		 */
		function checkRestrictedPathAndReport(importSource, importNames, node) {
			if (!Object.hasOwn(groupedRestrictedPaths, importSource)) {
				return;
			}

			groupedRestrictedPaths[importSource].forEach(
				restrictedPathEntry => {
					const customMessage = restrictedPathEntry.message;
					const restrictedImportNames =
						restrictedPathEntry.importNames;
					const allowedImportNames =
						restrictedPathEntry.allowImportNames;
					const allowTypeImports =
						restrictedPathEntry.allowTypeImports;

					// Skip if this is a type-only import and it's allowed for this specific entry
					if (
						allowTypeImports &&
						(node.type === "ImportDeclaration" ||
							node.type === "TSImportEqualsDeclaration") &&
						isTypeOnlyImport(node)
					) {
						return;
					}

					// Skip if this is a type-only export and it's allowed for this specific entry
					if (
						allowTypeImports &&
						(node.type === "ExportNamedDeclaration" ||
							node.type === "ExportAllDeclaration") &&
						isTypeOnlyExport(node)
					) {
						return;
					}

					if (!restrictedImportNames && !allowedImportNames) {
						context.report({
							node,
							messageId: customMessage
								? "pathWithCustomMessage"
								: "path",
							data: {
								importSource,
								customMessage,
							},
						});

						return;
					}

					importNames.forEach((specifiers, importName) => {
						if (importName === "*") {
							const [specifier] = specifiers;

							if (restrictedImportNames) {
								context.report({
									node,
									messageId: customMessage
										? "everythingWithCustomMessage"
										: "everything",
									loc: specifier.loc,
									data: {
										importSource,
										importNames: formatImportNames(
											restrictedImportNames,
										),
										isOrAre: isOrAre(restrictedImportNames),
										customMessage,
									},
								});
							} else if (allowedImportNames) {
								context.report({
									node,
									messageId: customMessage
										? "everythingWithAllowImportNamesAndCustomMessage"
										: "everythingWithAllowImportNames",
									loc: specifier.loc,
									data: {
										importSource,
										allowedImportNames:
											formatImportNames(
												allowedImportNames,
											),
										isOrAre: isOrAre(allowedImportNames),
										customMessage,
									},
								});
							}

							return;
						}

						if (
							restrictedImportNames &&
							restrictedImportNames.includes(importName)
						) {
							specifiers.forEach(specifier => {
								// Skip if this is a type-only import specifier and type imports are allowed
								if (
									allowTypeImports &&
									isTypeOnlySpecifier(specifier.specifier)
								) {
									return;
								}

								context.report({
									node,
									messageId: customMessage
										? "importNameWithCustomMessage"
										: "importName",
									loc: specifier.loc,
									data: {
										importSource,
										customMessage,
										importName,
									},
								});
							});
						}

						if (
							allowedImportNames &&
							!allowedImportNames.includes(importName)
						) {
							specifiers.forEach(specifier => {
								// Skip if this is a type-only import specifier and type imports are allowed
								if (
									allowTypeImports &&
									isTypeOnlySpecifier(specifier.specifier)
								) {
									return;
								}

								context.report({
									node,
									loc: specifier.loc,
									messageId: customMessage
										? "allowedImportNameWithCustomMessage"
										: "allowedImportName",
									data: {
										importSource,
										customMessage,
										importName,
										allowedImportNames:
											formatImportNames(
												allowedImportNames,
											),
										isOrAre: isOrAre(allowedImportNames),
									},
								});
							});
						}
					});
				},
			);
		}

		/**
		 * Report a restricted path specifically for patterns.
		 * @param {ASTNode} node representing the restricted path reference
		 * @param {RestrictedPatternGroup} group contains an Ignore instance for paths, the customMessage to show on failure,
		 * and any restricted import names that have been specified in the config
		 * @param {Map<string, Array<SpecifierData>>} importNames Map of import names that are being imported
		 * @param {string} importSource the import source string
		 * @returns {void}
		 * @private
		 */
		function reportPathForPatterns(node, group, importNames, importSource) {
			// Skip if this is a type-only import and it's allowed
			if (
				group.allowTypeImports &&
				(node.type === "ImportDeclaration" ||
					node.type === "TSImportEqualsDeclaration") &&
				isTypeOnlyImport(node)
			) {
				return;
			}

			// Skip if this is a type-only export and it's allowed
			if (
				group.allowTypeImports &&
				(node.type === "ExportNamedDeclaration" ||
					node.type === "ExportAllDeclaration") &&
				isTypeOnlyExport(node)
			) {
				return;
			}

			const customMessage = group.customMessage;
			const restrictedImportNames = group.importNames;
			const restrictedImportNamePattern = group.importNamePattern
				? new RegExp(group.importNamePattern, "u")
				: null;
			const allowedImportNames = group.allowImportNames;
			const allowedImportNamePattern = group.allowImportNamePattern
				? new RegExp(group.allowImportNamePattern, "u")
				: null;

			/**
			 * If we are not restricting to any specific import names and just the pattern itself,
			 * report the error and move on
			 */
			if (
				!restrictedImportNames &&
				!allowedImportNames &&
				!restrictedImportNamePattern &&
				!allowedImportNamePattern
			) {
				context.report({
					node,
					messageId: customMessage
						? "patternWithCustomMessage"
						: "patterns",
					data: {
						importSource,
						customMessage,
					},
				});
				return;
			}

			importNames.forEach((specifiers, importName) => {
				if (importName === "*") {
					const [specifier] = specifiers;

					if (restrictedImportNames) {
						context.report({
							node,
							messageId: customMessage
								? "patternAndEverythingWithCustomMessage"
								: "patternAndEverything",
							loc: specifier.loc,
							data: {
								importSource,
								importNames: formatImportNames(
									restrictedImportNames,
								),
								isOrAre: isOrAre(restrictedImportNames),
								customMessage,
							},
						});
					} else if (allowedImportNames) {
						context.report({
							node,
							messageId: customMessage
								? "everythingWithAllowImportNamesAndCustomMessage"
								: "everythingWithAllowImportNames",
							loc: specifier.loc,
							data: {
								importSource,
								allowedImportNames:
									formatImportNames(allowedImportNames),
								isOrAre: isOrAre(allowedImportNames),
								customMessage,
							},
						});
					} else if (allowedImportNamePattern) {
						context.report({
							node,
							messageId: customMessage
								? "everythingWithAllowedImportNamePatternWithCustomMessage"
								: "everythingWithAllowedImportNamePattern",
							loc: specifier.loc,
							data: {
								importSource,
								allowedImportNamePattern,
								customMessage,
							},
						});
					} else {
						context.report({
							node,
							messageId: customMessage
								? "patternAndEverythingWithRegexImportNameAndCustomMessage"
								: "patternAndEverythingWithRegexImportName",
							loc: specifier.loc,
							data: {
								importSource,
								importNames: restrictedImportNamePattern,
								customMessage,
							},
						});
					}

					return;
				}

				if (
					(restrictedImportNames &&
						restrictedImportNames.includes(importName)) ||
					(restrictedImportNamePattern &&
						restrictedImportNamePattern.test(importName))
				) {
					specifiers.forEach(specifier => {
						// Skip if this is a type-only import specifier and type imports are allowed
						if (
							group.allowTypeImports &&
							isTypeOnlySpecifier(specifier.specifier)
						) {
							return;
						}

						context.report({
							node,
							messageId: customMessage
								? "patternAndImportNameWithCustomMessage"
								: "patternAndImportName",
							loc: specifier.loc,
							data: {
								importSource,
								customMessage,
								importName,
							},
						});
					});
				}

				if (
					allowedImportNames &&
					!allowedImportNames.includes(importName)
				) {
					specifiers.forEach(specifier => {
						// Skip if this is a type-only import specifier and type imports are allowed
						if (
							group.allowTypeImports &&
							isTypeOnlySpecifier(specifier.specifier)
						) {
							return;
						}

						context.report({
							node,
							messageId: customMessage
								? "allowedImportNameWithCustomMessage"
								: "allowedImportName",
							loc: specifier.loc,
							data: {
								importSource,
								customMessage,
								importName,
								allowedImportNames:
									formatImportNames(allowedImportNames),
								isOrAre: isOrAre(allowedImportNames),
							},
						});
					});
				} else if (
					allowedImportNamePattern &&
					!allowedImportNamePattern.test(importName)
				) {
					specifiers.forEach(specifier => {
						// Skip if this is a type-only import specifier and type imports are allowed
						if (
							group.allowTypeImports &&
							isTypeOnlySpecifier(specifier.specifier)
						) {
							return;
						}

						context.report({
							node,
							messageId: customMessage
								? "allowedImportNamePatternWithCustomMessage"
								: "allowedImportNamePattern",
							loc: specifier.loc,
							data: {
								importSource,
								customMessage,
								importName,
								allowedImportNamePattern,
							},
						});
					});
				}
			});
		}

		/**
		 * Check if the given importSource is restricted by a pattern.
		 * @param {string} importSource path of the import
		 * @param {RestrictedPatternGroup} group contains a Ignore instance for paths, and the customMessage to show if it fails
		 * @returns {boolean} whether the variable is a restricted pattern or not
		 * @private
		 */
		function isRestrictedPattern(importSource, group) {
			// `meta.schema` requires one of `group` and `regex`, so a group without a `regexMatcher` has a `matcher`.
			return group.regexMatcher
				? group.regexMatcher.test(importSource)
				: /** @type {Ignore} */ (group.matcher).ignores(importSource);
		}

		/**
		 * Checks a node to see if any problems should be reported.
		 * @param {ASTNode} node The node to check.
		 * @returns {void}
		 * @private
		 */
		function checkNode(node) {
			const importSource = node.source.value.trim();
			/** @type {Map<string, Array<SpecifierData>>} */
			const importNames = new Map();

			if (node.type === "ExportAllDeclaration") {
				// An `ExportAllDeclaration` always has a `*` as its second token.
				const starToken = /** @type {Token} */ (
					sourceCode.getFirstToken(node, 1)
				);

				importNames.set("*", [{ loc: starToken.loc }]);
			} else if (node.specifiers) {
				for (const specifier of node.specifiers) {
					let name;
					const specifierData = { loc: specifier.loc, specifier };

					if (specifier.type === "ImportDefaultSpecifier") {
						name = "default";
					} else if (specifier.type === "ImportNamespaceSpecifier") {
						name = "*";
					} else if (specifier.imported) {
						name = astUtils.getModuleExportName(specifier.imported);
					} else if (specifier.local) {
						name = astUtils.getModuleExportName(specifier.local);
					}

					if (typeof name === "string") {
						if (importNames.has(name)) {
							// `has()` has just confirmed the entry is there.
							/** @type {Array<SpecifierData>} */ (
								importNames.get(name)
							).push(specifierData);
						} else {
							importNames.set(name, [specifierData]);
						}
					}
				}
			}

			checkRestrictedPathAndReport(importSource, importNames, node);
			restrictedPatternGroups.forEach(group => {
				if (isRestrictedPattern(importSource, group)) {
					reportPathForPatterns(
						node,
						group,
						importNames,
						importSource,
					);
				}
			});
		}

		return {
			ImportDeclaration: checkNode,

			/**
			 * Checks a re-export for restricted import sources.
			 * @param {ASTNode} node The `ExportNamedDeclaration` node.
			 * @returns {void}
			 */
			ExportNamedDeclaration(node) {
				if (node.source) {
					checkNode(node);
				}
			},
			ExportAllDeclaration: checkNode,

			// Add support for TypeScript import equals declarations
			/**
			 * Checks a TypeScript import equals declaration for restricted import sources.
			 * @param {ASTNode} node The `TSImportEqualsDeclaration` node.
			 * @returns {void}
			 */
			TSImportEqualsDeclaration(node) {
				if (node.moduleReference.type === "TSExternalModuleReference") {
					const importSource = node.moduleReference.expression.value;
					/** @type {Map<string, Array<SpecifierData>>} */
					const importNames = new Map();

					// Use existing logic with the actual node
					checkRestrictedPathAndReport(
						importSource,
						importNames,
						node,
					);
					restrictedPatternGroups.forEach(group => {
						if (isRestrictedPattern(importSource, group)) {
							reportPathForPatterns(
								node,
								group,
								importNames,
								importSource,
							);
						}
					});
				}
			},
		};
	},
};

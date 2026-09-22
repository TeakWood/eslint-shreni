/**
 * @fileoverview Rule to enforce sorted `import` declarations within modules
 * @author Christian Schuller
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

/**
 * The member syntax style an `import` declaration uses. These are the names the
 * `memberSyntaxSortOrder` option is written in, so naming the union keeps a typo
 * from slipping past on either side of the `indexOf()` lookup that pairs them.
 * @typedef {"none" | "all" | "multiple" | "single"} MemberSyntax
 */

/**
 * The rule's options, as validated against `meta.schema` and filled in from
 * `meta.defaultOptions` before `create()` runs — so every property is present.
 * @typedef {Object} SortImportsOptions
 * @property {boolean} ignoreCase Whether to compare names case-insensitively.
 * @property {boolean} ignoreDeclarationSort Whether to skip checking the order of the declarations themselves.
 * @property {boolean} ignoreMemberSort Whether to skip checking the order of the members within a declaration.
 * @property {Array<MemberSyntax>} memberSyntaxSortOrder The member syntax styles, in the order they must appear.
 * @property {boolean} allowSeparatedGroups Whether a blank line between two declarations starts a new sort group.
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				allowSeparatedGroups: false,
				ignoreCase: false,
				ignoreDeclarationSort: false,
				ignoreMemberSort: false,
				memberSyntaxSortOrder: ["none", "all", "multiple", "single"],
			},
		],

		docs: {
			description: "Enforce sorted `import` declarations within modules",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/sort-imports",
		},

		schema: [
			{
				type: "object",
				properties: {
					ignoreCase: {
						type: "boolean",
					},
					memberSyntaxSortOrder: {
						type: "array",
						items: {
							enum: ["none", "all", "multiple", "single"],
						},
						uniqueItems: true,
						minItems: 4,
						maxItems: 4,
					},
					ignoreDeclarationSort: {
						type: "boolean",
					},
					ignoreMemberSort: {
						type: "boolean",
					},
					allowSeparatedGroups: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		fixable: "code",

		messages: {
			sortImportsAlphabetically:
				"Imports should be sorted alphabetically.",
			sortMembersAlphabetically:
				"Member '{{memberName}}' of the import declaration should be sorted alphabetically.",
			unexpectedSyntaxOrder:
				"Expected '{{syntaxA}}' syntax before '{{syntaxB}}' syntax.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [
			{
				ignoreCase,
				ignoreDeclarationSort,
				ignoreMemberSort,
				memberSyntaxSortOrder,
				allowSeparatedGroups,
			},
			// `meta.schema` validated these and `meta.defaultOptions` filled in the rest.
		] = /** @type {[SortImportsOptions]} */ (context.options);
		const sourceCode = context.sourceCode;

		/** @type {ASTNode | null} */
		let previousDeclaration = null;

		/**
		 * Gets the used member syntax style.
		 *
		 * import "my-module.js" --> none
		 * import * as myModule from "my-module.js" --> all
		 * import {myMember} from "my-module.js" --> single
		 * import {foo, bar} from  "my-module.js" --> multiple
		 * @param {ASTNode} node the ImportDeclaration node.
		 * @returns {MemberSyntax} used member parameter style, ["all", "multiple", "single"]
		 */
		function usedMemberSyntax(node) {
			if (node.specifiers.length === 0) {
				return "none";
			}
			if (node.specifiers[0].type === "ImportNamespaceSpecifier") {
				return "all";
			}
			if (node.specifiers.length === 1) {
				return "single";
			}
			return "multiple";
		}

		/**
		 * Gets the group by member parameter index for given declaration.
		 * @param {ASTNode} node the ImportDeclaration node.
		 * @returns {number} the declaration group by member index.
		 */
		function getMemberParameterGroupIndex(node) {
			return memberSyntaxSortOrder.indexOf(usedMemberSyntax(node));
		}

		/**
		 * Gets the local name of the first imported module.
		 * @param {ASTNode} node the ImportDeclaration node.
		 * @returns {string | null} the local name of the first imported module.
		 */
		function getFirstLocalMemberName(node) {
			if (node.specifiers[0]) {
				return node.specifiers[0].local.name;
			}
			return null;
		}

		/**
		 * Calculates number of lines between two nodes. It is assumed that the given `left` node appears before
		 * the given `right` node in the source code. Lines are counted from the end of the `left` node till the
		 * start of the `right` node. If the given nodes are on the same line, it returns `0`, same as if they were
		 * on two consecutive lines.
		 * @param {ASTNode} left node that appears before the given `right` node.
		 * @param {ASTNode} right node that appears after the given `left` node.
		 * @returns {number} number of lines between nodes.
		 */
		function getNumberOfLinesBetween(left, right) {
			return Math.max(right.loc.start.line - left.loc.end.line - 1, 0);
		}

		return {
			/**
			 * Checks that the given declaration, and the members within it, are sorted.
			 * @param {ASTNode} node The `ImportDeclaration` node to check.
			 * @returns {void}
			 */
			ImportDeclaration(node) {
				if (!ignoreDeclarationSort) {
					if (
						previousDeclaration &&
						allowSeparatedGroups &&
						getNumberOfLinesBetween(previousDeclaration, node) > 0
					) {
						// reset declaration sort
						previousDeclaration = null;
					}

					if (previousDeclaration) {
						const currentMemberSyntaxGroupIndex =
								getMemberParameterGroupIndex(node),
							previousMemberSyntaxGroupIndex =
								getMemberParameterGroupIndex(
									previousDeclaration,
								);
						let currentLocalMemberName =
								getFirstLocalMemberName(node),
							previousLocalMemberName =
								getFirstLocalMemberName(previousDeclaration);

						if (ignoreCase) {
							previousLocalMemberName =
								previousLocalMemberName &&
								previousLocalMemberName.toLowerCase();
							currentLocalMemberName =
								currentLocalMemberName &&
								currentLocalMemberName.toLowerCase();
						}

						/*
						 * When the current declaration uses a different member syntax,
						 * then check if the ordering is correct.
						 * Otherwise, make a default string compare (like rule sort-vars to be consistent) of the first used local member name.
						 */
						if (
							currentMemberSyntaxGroupIndex !==
							previousMemberSyntaxGroupIndex
						) {
							if (
								currentMemberSyntaxGroupIndex <
								previousMemberSyntaxGroupIndex
							) {
								context.report({
									node,
									messageId: "unexpectedSyntaxOrder",
									data: {
										syntaxA:
											memberSyntaxSortOrder[
												currentMemberSyntaxGroupIndex
											],
										syntaxB:
											memberSyntaxSortOrder[
												previousMemberSyntaxGroupIndex
											],
									},
								});
							}
						} else {
							if (
								previousLocalMemberName &&
								currentLocalMemberName &&
								currentLocalMemberName < previousLocalMemberName
							) {
								context.report({
									node,
									messageId: "sortImportsAlphabetically",
								});
							}
						}
					}

					previousDeclaration = node;
				}

				if (!ignoreMemberSort) {
					// An `ImportDeclaration`'s `specifiers` are always nodes.
					const importSpecifiers = /** @type {Array<ASTNode>} */ (
						node.specifiers
					).filter(specifier => specifier.type === "ImportSpecifier");

					/**
					 * Gets the name to sort the given import specifier by.
					 * @type {(specifier: ASTNode) => string}
					 */
					const getSortableName = ignoreCase
						? specifier => specifier.local.name.toLowerCase()
						: specifier => specifier.local.name;
					const firstUnsortedIndex = importSpecifiers
						.map(getSortableName)
						.findIndex(
							(name, index, array) => array[index - 1] > name,
						);

					if (firstUnsortedIndex !== -1) {
						context.report({
							node: importSpecifiers[firstUnsortedIndex],
							messageId: "sortMembersAlphabetically",
							data: {
								memberName:
									importSpecifiers[firstUnsortedIndex].local
										.name,
							},
							/**
							 * Sorts the import specifiers in place.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo | null} The fix, or `null` when the specifiers cannot be reordered safely.
							 */
							fix(fixer) {
								if (
									importSpecifiers.some(
										specifier =>
											sourceCode.getCommentsBefore(
												specifier,
											).length ||
											sourceCode.getCommentsAfter(
												specifier,
											).length,
									)
								) {
									// If there are comments in the ImportSpecifier list, don't rearrange the specifiers.
									return null;
								}

								return fixer.replaceTextRange(
									[
										importSpecifiers[0].range[0],

										// `importSpecifiers` is non-empty here: this fix only runs for a reported specifier.
										/** @type {ASTNode} */ (
											importSpecifiers.at(-1)
										).range[1],
									],
									importSpecifiers

										// Clone the importSpecifiers array to avoid mutating it
										.slice()

										// Sort the array into the desired order
										.sort((specifierA, specifierB) => {
											const aName =
												getSortableName(specifierA);
											const bName =
												getSortableName(specifierB);

											return aName > bName ? 1 : -1;
										})

										// Build a string out of the sorted list of import specifiers and the text between the originals
										.reduce(
											(sourceText, specifier, index) => {
												const textAfterSpecifier =
													index ===
													importSpecifiers.length - 1
														? ""
														: sourceCode
																.getText()
																.slice(
																	importSpecifiers[
																		index
																	].range[1],
																	importSpecifiers[
																		index +
																			1
																	].range[0],
																);

												return (
													sourceText +
													sourceCode.getText(
														specifier,
													) +
													textAfterSpecifier
												);
											},
											"",
										),
								);
							},
						});
					}
				}
			},
		};
	},
};

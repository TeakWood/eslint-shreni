/**
 * @fileoverview Rule to require sorting of variables within a single Variable Declaration block
 * @author Ilya Volodin
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

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				ignoreCase: false,
			},
		],

		docs: {
			description:
				"Require variables within the same declaration block to be sorted",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/sort-vars",
		},

		schema: [
			{
				type: "object",
				properties: {
					ignoreCase: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		fixable: "code",

		messages: {
			sortVars:
				"Variables within the same declaration block should be sorted alphabetically.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ ignoreCase }] = context.options;
		const sourceCode = context.sourceCode;

		return {
			/**
			 * Checks that the declarators of the given declaration are sorted.
			 * @param {ASTNode} node The `VariableDeclaration` node to check.
			 * @returns {void}
			 */
			VariableDeclaration(node) {
				/** @type {Array<ASTNode>} */
				const idDeclarations = node.declarations.filter(
					(/** @type {ASTNode} */ decl) =>
						decl.id.type === "Identifier",
				);

				/**
				 * Gets the name to sort the given declarator by.
				 * @type {(decl: ASTNode) => string}
				 */
				const getSortableName = ignoreCase
					? decl => decl.id.name.toLowerCase()
					: decl => decl.id.name;
				const unfixable = idDeclarations.some(
					decl => decl.init !== null && decl.init.type !== "Literal",
				);
				let fixed = false;

				idDeclarations.slice(1).reduce((memo, decl) => {
					const lastVariableName = getSortableName(memo),
						currentVariableName = getSortableName(decl);

					if (currentVariableName < lastVariableName) {
						context.report({
							node: decl,
							messageId: "sortVars",
							/**
							 * Sorts the identifier declarations in place.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo | null} The fix, or `null` when the declarations cannot be reordered safely.
							 */
							fix(fixer) {
								if (unfixable || fixed) {
									return null;
								}
								return fixer.replaceTextRange(
									[
										idDeclarations[0].range[0],

										// `idDeclarations` is non-empty here: this fix only runs for a reported declarator.
										/** @type {ASTNode} */ (
											idDeclarations.at(-1)
										).range[1],
									],
									idDeclarations

										// Clone the idDeclarations array to avoid mutating it
										.slice()

										// Sort the array into the desired order
										.sort((declA, declB) => {
											const aName =
												getSortableName(declA);
											const bName =
												getSortableName(declB);

											return aName > bName ? 1 : -1;
										})

										// Build a string out of the sorted list of identifier declarations and the text between the originals
										.reduce(
											(sourceText, identifier, index) => {
												const textAfterIdentifier =
													index ===
													idDeclarations.length - 1
														? ""
														: sourceCode
																.getText()
																.slice(
																	idDeclarations[
																		index
																	].range[1],
																	idDeclarations[
																		index +
																			1
																	].range[0],
																);

												return (
													sourceText +
													sourceCode.getText(
														identifier,
													) +
													textAfterIdentifier
												);
											},
											"",
										),
								);
							},
						});
						fixed = true;
						return memo;
					}
					return decl;
				}, idDeclarations[0]);
			},
		};
	},
};

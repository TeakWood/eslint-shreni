/**
 * @fileoverview Disallows or enforces spaces inside of object literals.
 * @author Jamund Ferguson
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		deprecated: {
			message: "Formatting rules are being moved out of ESLint core.",
			url: "https://eslint.org/blog/2023/10/deprecating-formatting-rules/",
			deprecatedSince: "8.53.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"ESLint Stylistic now maintains deprecated stylistic core rules.",
					url: "https://eslint.style/guide/migration",
					plugin: {
						name: "@stylistic/eslint-plugin",
						url: "https://eslint.style",
					},
					rule: {
						name: "object-curly-spacing",
						url: "https://eslint.style/rules/object-curly-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Enforce consistent spacing inside braces",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/object-curly-spacing",
		},

		fixable: "whitespace",

		schema: [
			{
				enum: ["always", "never"],
			},
			{
				type: "object",
				properties: {
					arraysInObjects: {
						type: "boolean",
					},
					objectsInObjects: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			requireSpaceBefore: "A space is required before '{{token}}'.",
			requireSpaceAfter: "A space is required after '{{token}}'.",
			unexpectedSpaceBefore:
				"There should be no space before '{{token}}'.",
			unexpectedSpaceAfter: "There should be no space after '{{token}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const spaced = context.options[0] === "always",
			sourceCode = context.sourceCode;

		/**
		 * Determines whether an option is set, relative to the spacing option.
		 * If spaced is "always", then check whether option is set to false.
		 * If spaced is "never", then check whether option is set to true.
		 * @param {string} option The option to exclude.
		 * @returns {boolean} Whether or not the property is excluded.
		 */
		function isOptionSet(option) {
			return context.options[1]
				? context.options[1][option] === !spaced
				: false;
		}

		const options = {
			spaced,
			arraysInObjectsException: isOptionSet("arraysInObjects"),
			objectsInObjectsException: isOptionSet("objectsInObjects"),
		};

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Reports that there shouldn't be a space after the first token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportNoBeginningSpace(node, token) {
			// `token` is an opening brace, so a token always follows it.
			const nextToken = /** @type {Token} */ (
				context.sourceCode.getTokenAfter(token, {
					includeComments: true,
				})
			);

			context.report({
				node,
				loc: { start: token.loc.end, end: nextToken.loc.start },
				messageId: "unexpectedSpaceAfter",
				data: {
					token: token.value,
				},
				/**
				 * Removes the space after the opening brace.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					return fixer.removeRange([
						token.range[1],
						nextToken.range[0],
					]);
				},
			});
		}

		/**
		 * Reports that there shouldn't be a space before the last token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportNoEndingSpace(node, token) {
			// `token` is a closing brace, so a token always precedes it.
			const previousToken = /** @type {Token} */ (
				context.sourceCode.getTokenBefore(token, {
					includeComments: true,
				})
			);

			context.report({
				node,
				loc: { start: previousToken.loc.end, end: token.loc.start },
				messageId: "unexpectedSpaceBefore",
				data: {
					token: token.value,
				},
				/**
				 * Removes the space before the closing brace.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					return fixer.removeRange([
						previousToken.range[1],
						token.range[0],
					]);
				},
			});
		}

		/**
		 * Reports that there should be a space after the first token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportRequiredBeginningSpace(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "requireSpaceAfter",
				data: {
					token: token.value,
				},
				/**
				 * Inserts the required space after the opening brace.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					return fixer.insertTextAfter(token, " ");
				},
			});
		}

		/**
		 * Reports that there should be a space before the last token
		 * @param {ASTNode} node The node to report in the event of an error.
		 * @param {Token} token The token to use for the report.
		 * @returns {void}
		 */
		function reportRequiredEndingSpace(node, token) {
			context.report({
				node,
				loc: token.loc,
				messageId: "requireSpaceBefore",
				data: {
					token: token.value,
				},
				/**
				 * Inserts the required space before the closing brace.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix(fixer) {
					return fixer.insertTextBefore(token, " ");
				},
			});
		}

		/**
		 * Determines if spacing in curly braces is valid.
		 * @param {ASTNode} node The AST node to check.
		 * @param {Token} first The first token to check (should be the opening brace)
		 * @param {Token} second The second token to check (should be first after the opening brace)
		 * @param {Token} penultimate The penultimate token to check (should be last before closing brace)
		 * @param {Token} last The last token to check (should be closing brace)
		 * @returns {void}
		 */
		function validateBraceSpacing(node, first, second, penultimate, last) {
			if (astUtils.isTokenOnSameLine(first, second)) {
				const firstSpaced = sourceCode.isSpaceBetween(first, second);

				if (options.spaced && !firstSpaced) {
					reportRequiredBeginningSpace(node, first);
				}
				if (!options.spaced && firstSpaced && second.type !== "Line") {
					reportNoBeginningSpace(node, first);
				}
			}

			if (astUtils.isTokenOnSameLine(penultimate, last)) {
				const shouldCheckPenultimate =
					(options.arraysInObjectsException &&
						astUtils.isClosingBracketToken(penultimate)) ||
					(options.objectsInObjectsException &&
						astUtils.isClosingBraceToken(penultimate));
				// `penultimate` is a token of this node, so some node covers it.
				const penultimateType =
					shouldCheckPenultimate &&
					/** @type {ASTNode} */ (
						sourceCode.getNodeByRangeIndex(penultimate.range[0])
					).type;

				const closingCurlyBraceMustBeSpaced =
					(options.arraysInObjectsException &&
						penultimateType === "ArrayExpression") ||
					(options.objectsInObjectsException &&
						(penultimateType === "ObjectExpression" ||
							penultimateType === "ObjectPattern"))
						? !options.spaced
						: options.spaced;

				const lastSpaced = sourceCode.isSpaceBetween(penultimate, last);

				if (closingCurlyBraceMustBeSpaced && !lastSpaced) {
					reportRequiredEndingSpace(node, last);
				}
				if (!closingCurlyBraceMustBeSpaced && lastSpaced) {
					reportNoEndingSpace(node, last);
				}
			}
		}

		/**
		 * Gets '}' token of an object node.
		 *
		 * Because the last token of object patterns might be a type annotation,
		 * this traverses tokens preceded by the last property, then returns the
		 * first '}' token.
		 * @param {ASTNode} node The node to get. This node is an
		 *      ObjectExpression or an ObjectPattern. And this node has one or
		 *      more properties.
		 * @returns {Token} '}' token.
		 */
		function getClosingBraceOfObject(node) {
			const lastProperty = node.properties.at(-1);

			// The caller guarantees a property, so the object's '}' follows it.
			return /** @type {Token} */ (
				sourceCode.getTokenAfter(
					lastProperty,
					astUtils.isClosingBraceToken,
				)
			);
		}

		/**
		 * Reports a given object node if spacing in curly braces is invalid.
		 * @param {ASTNode} node An ObjectExpression or ObjectPattern node to check.
		 * @returns {void}
		 */
		function checkForObject(node) {
			if (node.properties.length === 0) {
				return;
			}

			/*
			 * The object has at least one property, so it spans a '{', that
			 * property and the '}' that `getClosingBraceOfObject()` found:
			 * none of these four lookups can come back empty.
			 */
			const first = /** @type {Token} */ (sourceCode.getFirstToken(node)),
				last = getClosingBraceOfObject(node),
				second = /** @type {Token} */ (
					sourceCode.getTokenAfter(first, {
						includeComments: true,
					})
				),
				penultimate = /** @type {Token} */ (
					sourceCode.getTokenBefore(last, {
						includeComments: true,
					})
				);

			validateBraceSpacing(node, first, second, penultimate, last);
		}

		/**
		 * Reports a given import node if spacing in curly braces is invalid.
		 * @param {ASTNode} node An ImportDeclaration node to check.
		 * @returns {void}
		 */
		function checkForImport(node) {
			if (node.specifiers.length === 0) {
				return;
			}

			let firstSpecifier = node.specifiers[0];
			const lastSpecifier = node.specifiers.at(-1);

			if (lastSpecifier.type !== "ImportSpecifier") {
				return;
			}
			if (firstSpecifier.type !== "ImportSpecifier") {
				firstSpecifier = node.specifiers[1];
			}

			/*
			 * An `ImportSpecifier` only appears inside the braces of an import
			 * clause, so the braces surrounding it — and the tokens just inside
			 * them — are all present.
			 */
			const first = /** @type {Token} */ (
					sourceCode.getTokenBefore(firstSpecifier)
				),
				last = /** @type {Token} */ (
					sourceCode.getTokenAfter(
						lastSpecifier,
						astUtils.isNotCommaToken,
					)
				),
				second = /** @type {Token} */ (
					sourceCode.getTokenAfter(first, {
						includeComments: true,
					})
				),
				penultimate = /** @type {Token} */ (
					sourceCode.getTokenBefore(last, {
						includeComments: true,
					})
				);

			validateBraceSpacing(node, first, second, penultimate, last);
		}

		/**
		 * Reports a given export node if spacing in curly braces is invalid.
		 * @param {ASTNode} node An ExportNamedDeclaration node to check.
		 * @returns {void}
		 */
		function checkForExport(node) {
			if (node.specifiers.length === 0) {
				return;
			}

			/*
			 * As in `checkForImport()`: an export specifier only appears inside
			 * the braces of an export clause.
			 */
			const firstSpecifier = node.specifiers[0],
				lastSpecifier = node.specifiers.at(-1),
				first = /** @type {Token} */ (
					sourceCode.getTokenBefore(firstSpecifier)
				),
				last = /** @type {Token} */ (
					sourceCode.getTokenAfter(
						lastSpecifier,
						astUtils.isNotCommaToken,
					)
				),
				second = /** @type {Token} */ (
					sourceCode.getTokenAfter(first, {
						includeComments: true,
					})
				),
				penultimate = /** @type {Token} */ (
					sourceCode.getTokenBefore(last, {
						includeComments: true,
					})
				);

			validateBraceSpacing(node, first, second, penultimate, last);
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			// var {x} = y;
			ObjectPattern: checkForObject,

			// var y = {x: 'y'}
			ObjectExpression: checkForObject,

			// import {y} from 'x';
			ImportDeclaration: checkForImport,

			// export {name} from 'yo';
			ExportNamedDeclaration: checkForExport,
		};
	},
};

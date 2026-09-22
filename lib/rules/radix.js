/**
 * @fileoverview Rule to flag use of parseInt without a radix argument
 * @author James Allardice
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").SourceCode} SourceCode */
/** @typedef {import("eslint-scope").Variable} Variable */
/** @typedef {import("eslint-scope").Reference} Reference */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const validRadixValues = new Set(
	Array.from({ length: 37 - 2 }, (_, index) => index + 2),
);

/**
 * Reinterprets an `eslint-scope` identifier as a rules-layer node.
 *
 * `Reference#identifier` is typed as a bare ESTree identifier: no `parent`,
 * and `range` and `loc` optional. The linter populates all three before any
 * rule runs, so the identifier is the same object a visitor would have
 * received and is reinterpreted rather than re-checked.
 * @param {Reference["identifier"]} identifier The identifier to reinterpret.
 * @returns {ASTNode} The same identifier, as the rules layer sees it.
 * @private
 */
function asNode(identifier) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (identifier));
}

/**
 * Checks whether a given variable is shadowed or not.
 * @param {Variable} variable A variable to check.
 * @returns {boolean} `true` if the variable is shadowed.
 */
function isShadowed(variable) {
	return variable.defs.length >= 1;
}

/**
 * Checks whether a given node is a valid value of radix or not.
 *
 * The following values are invalid.
 *
 * - A literal except integers between 2 and 36.
 * - undefined.
 * @param {ASTNode} radix A node of radix to check.
 * @param {SourceCode} sourceCode The source code object.
 * @returns {boolean} `true` if the node is valid.
 */
function isValidRadix(radix, sourceCode) {
	if (
		radix.type === "UnaryExpression" &&
		(radix.operator === "-" || radix.operator === "+") &&
		radix.argument.type === "Literal" &&
		typeof radix.argument.value === "number"
	) {
		const value =
			radix.operator === "-"
				? -radix.argument.value
				: radix.argument.value;

		return validRadixValues.has(value);
	}

	return !(
		(radix.type === "Literal" && !validRadixValues.has(radix.value)) ||
		(radix.type === "Identifier" &&
			radix.name === "undefined" &&
			sourceCode.isGlobalReference(radix))
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Enforce the use of the radix argument when using `parseInt()`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/radix",
		},

		hasSuggestions: true,

		schema: [
			// deprecated
			{
				enum: ["always", "as-needed"],
			},
		],

		messages: {
			missingParameters: "Missing parameters.",
			missingRadix: "Missing radix parameter.",
			invalidRadix:
				"Invalid radix parameter, must be an integer between 2 and 36.",
			addRadixParameter10:
				"Add radix parameter `10` for parsing decimal numbers.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Checks the arguments of a given CallExpression node and reports it if it
		 * offends this rule.
		 * @param {ASTNode} node A CallExpression node to check.
		 * @returns {void}
		 */
		function checkArguments(node) {
			// A `CallExpression`'s `arguments` is always a node list.
			const args = /** @type {Array<ASTNode>} */ (node.arguments);
			const spreadIndex = args.findIndex(
				arg => arg.type === "SpreadElement",
			);

			if (spreadIndex !== -1 && spreadIndex < 2) {
				return;
			}

			if (args.length === 0) {
				context.report({
					node,
					messageId: "missingParameters",
				});
			} else if (args.length === 1) {
				context.report({
					node,
					messageId: "missingRadix",
					suggest: [
						{
							messageId: "addRadixParameter10",
							/**
							 * Inserts a `10` radix argument into the call.
							 * @param {RuleFixer} fixer The fixer to use.
							 * @returns {EditInfo} The fix.
							 */
							fix(fixer) {
								/*
								 * `node` is a `CallExpression` with exactly one
								 * argument, so its last token is the closing
								 * `)` and the token before that always exists.
								 */
								const lastToken = /** @type {Token} */ (
									sourceCode.getLastToken(node)
								);
								const prevToken = /** @type {Token} */ (
									sourceCode.getTokenBefore(lastToken)
								);

								const hasTrailingComma =
									astUtils.isCommaToken(prevToken);

								return fixer.insertTextBefore(
									lastToken,
									hasTrailingComma ? " 10," : ", 10",
								);
							},
						},
					],
				});
			} else if (!isValidRadix(args[1], sourceCode)) {
				context.report({
					node,
					messageId: "invalidRadix",
				});
			}
		}

		return {
			/**
			 * Checks every reference to the global `parseInt` and `Number`.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const scope = sourceCode.getScope(node);
				let variable;

				// Check `parseInt()`
				variable = astUtils.getVariableByName(scope, "parseInt");
				if (variable && !isShadowed(variable)) {
					variable.references.forEach(reference => {
						const idNode = asNode(reference.identifier);

						if (astUtils.isCallee(idNode)) {
							checkArguments(idNode.parent);
						}
					});
				}

				// Check `Number.parseInt()`
				variable = astUtils.getVariableByName(scope, "Number");
				if (variable && !isShadowed(variable)) {
					variable.references.forEach(reference => {
						const parentNode = asNode(reference.identifier).parent;
						const maybeCallee =
							parentNode.parent.type === "ChainExpression"
								? parentNode.parent
								: parentNode;

						if (
							astUtils.isSpecificMemberAccess(
								parentNode,
								"Number",
								"parseInt",
							) &&
							astUtils.isCallee(maybeCallee)
						) {
							checkArguments(maybeCallee.parent);
						}
					});
				}
			},
		};
	},
};

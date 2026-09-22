/**
 * @fileoverview Rule to disallow `parseInt()` in favor of binary, octal, and hexadecimal literals
 * @author Annie Zhang, Henry Zhu
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
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").SourceCode} SourceCode */

/**
 * How one radix is spelled as a numeric literal, and what that number system is
 * called in the report message.
 * @typedef {Object} RadixInfo
 * @property {string} system The name of the number system.
 * @property {string} literalPrefix The prefix a literal in that system starts with.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const radixMap = new Map([
	[2, { system: "binary", literalPrefix: "0b" }],
	[8, { system: "octal", literalPrefix: "0o" }],
	[16, { system: "hexadecimal", literalPrefix: "0x" }],
]);

/**
 * Checks to see if a CallExpression's callee node is `parseInt` or
 * `Number.parseInt`.
 * @param {ASTNode} calleeNode The callee node to evaluate.
 * @param {SourceCode} sourceCode The source code object.
 * @returns {boolean} True if the callee is `parseInt` or `Number.parseInt`,
 * false otherwise.
 */
function isParseInt(calleeNode, sourceCode) {
	if (astUtils.isSpecificId(calleeNode, "parseInt")) {
		return sourceCode.isGlobalReference(calleeNode);
	}

	if (astUtils.isSpecificMemberAccess(calleeNode, "Number", "parseInt")) {
		const objectNode = astUtils.skipChainExpression(calleeNode).object;

		return sourceCode.isGlobalReference(objectNode);
	}

	return false;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Disallow `parseInt()` and `Number.parseInt()` in favor of binary, octal, and hexadecimal literals",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/prefer-numeric-literals",
		},

		schema: [],

		messages: {
			useLiteral:
				"Use {{system}} literals instead of {{functionName}}().",
		},

		fixable: "code",
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		//----------------------------------------------------------------------
		// Public
		//----------------------------------------------------------------------

		return {
			/**
			 * Checks a two-argument call for a `parseInt()` that a numeric literal could replace.
			 * @param {ASTNode} node The `CallExpression` node to check.
			 * @returns {void}
			 */
			"CallExpression[arguments.length=2]"(node) {
				const [strNode, radixNode] = node.arguments,
					str = astUtils.getStaticStringValue(strNode),
					radix = radixNode.value;

				if (
					str !== null &&
					astUtils.isStringLiteral(strNode) &&
					radixNode.type === "Literal" &&
					typeof radix === "number" &&
					radixMap.has(radix) &&
					isParseInt(node.callee, sourceCode)
				) {
					// `radixMap.has(radix)` above guarantees the lookup hits; `Map#has` does not narrow `Map#get`.
					const { system, literalPrefix } = /** @type {RadixInfo} */ (
						radixMap.get(radix)
					);

					context.report({
						node,
						messageId: "useLiteral",
						data: {
							system,
							functionName: sourceCode.getText(node.callee),
						},
						/**
						 * Replaces the `parseInt()` call with the equivalent numeric literal.
						 * @param {RuleFixer} fixer The fixer.
						 * @returns {EditInfo | null} The fix, or `null` if the call has comments inside it or the literal would not round-trip.
						 */
						fix(fixer) {
							if (sourceCode.getCommentsInside(node).length) {
								return null;
							}

							const replacement = `${literalPrefix}${str}`;

							if (+replacement !== parseInt(str, radix)) {
								/*
								 * If the newly-produced literal would be invalid, (e.g. 0b1234),
								 * or it would yield an incorrect parseInt result for some other reason, don't make a fix.
								 *
								 * If `str` had numeric separators, `+replacement` will evaluate to `NaN` because unary `+`
								 * per the specification doesn't support numeric separators. Thus, the above condition will be `true`
								 * (`NaN !== anything` is always `true`) regardless of the `parseInt(str, radix)` value.
								 * Consequently, no autofixes will be made. This is correct behavior because `parseInt` also
								 * doesn't support numeric separators, but it does parse part of the string before the first `_`,
								 * so the autofix would be invalid:
								 *
								 *   parseInt("1_1", 2) // === 1
								 *   0b1_1 // === 3
								 */
								return null;
							}

							const tokenBefore = sourceCode.getTokenBefore(node),
								tokenAfter = sourceCode.getTokenAfter(node);
							let prefix = "",
								suffix = "";

							if (
								tokenBefore &&
								tokenBefore.range[1] === node.range[0] &&
								!astUtils.canTokensBeAdjacent(
									tokenBefore,
									replacement,
								)
							) {
								prefix = " ";
							}

							if (
								tokenAfter &&
								node.range[1] === tokenAfter.range[0] &&
								!astUtils.canTokensBeAdjacent(
									replacement,
									tokenAfter,
								)
							) {
								suffix = " ";
							}

							return fixer.replaceText(
								node,
								`${prefix}${replacement}${suffix}`,
							);
						},
					});
				}
			},
		};
	},
};

/**
 * @fileoverview Enforces or disallows inline comments.
 * @author Greg Cochard
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
 * A comment as `sourceCode.getAllComments()` hands it back. That is the
 * `lib/shared/types.js` variant, whose `type` is a plain `string`: the JS
 * language's comment list also carries the `"Shebang"` comment that
 * `espree` synthesizes for a hashbang line, which the narrower
 * `"Line" | "Block"` union in `./utils/ast-utils.js` cannot express.
 * @typedef {import("../shared/types.js").Comment} Comment
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [{}],

		docs: {
			description: "Disallow inline comments after code",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-inline-comments",
		},

		schema: [
			{
				type: "object",
				properties: {
					ignorePattern: {
						type: "string",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpectedInlineComment: "Unexpected comment inline with code.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const [{ ignorePattern }] = context.options;
		const customIgnoreRegExp =
			ignorePattern && new RegExp(ignorePattern, "u");

		/**
		 * Will check that comments are not on lines starting with or ending with code
		 * @param {Comment} node The comment node to check
		 * @returns {void}
		 * @private
		 */
		function testCodeAroundComment(node) {
			const startLine = String(sourceCode.lines[node.loc.start.line - 1]),
				endLine = String(sourceCode.lines[node.loc.end.line - 1]),
				preamble = startLine.slice(0, node.loc.start.column).trim(),
				postamble = endLine.slice(node.loc.end.column).trim(),
				isPreambleEmpty = !preamble,
				isPostambleEmpty = !postamble;

			// Nothing on both sides
			if (isPreambleEmpty && isPostambleEmpty) {
				return;
			}

			// Matches the ignore pattern
			if (customIgnoreRegExp && customIgnoreRegExp.test(node.value)) {
				return;
			}

			// JSX Exception
			if (
				(isPreambleEmpty || preamble === "{") &&
				(isPostambleEmpty || postamble === "}")
			) {
				const enclosingNode = sourceCode.getNodeByRangeIndex(
					node.range[0],
				);

				if (
					enclosingNode &&
					enclosingNode.type === "JSXEmptyExpression"
				) {
					return;
				}
			}

			/*
			 * `isDirectiveComment()` is typed for AST nodes but only reads `type`
			 * and `value`, both of which a comment carries. A comment is not a node
			 * — it has no `parent` — so the reinterpretation is made through
			 * `unknown`.
			 */
			const commentNode = /** @type {ASTNode} */ (
				/** @type {unknown} */ (node)
			);

			// Don't report ESLint directive comments
			if (astUtils.isDirectiveComment(commentNode)) {
				return;
			}

			context.report({
				node,
				messageId: "unexpectedInlineComment",
			});
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			/**
			 * Checks every comment in the file.
			 * @returns {void}
			 */
			Program() {
				sourceCode
					.getAllComments()
					.filter(token => token.type !== "Shebang")
					.forEach(testCodeAroundComment);
			},
		};
	},
};

/**
 * @fileoverview Rule to flag missing semicolons.
 * @author Nicholas C. Zakas
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const FixTracker = require("./utils/fix-tracker");
const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/ast-utils.js").Comment} Comment */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").SourceLocation} SourceLocation */

/**
 * The options object, which is the second element of the rule's options array.
 * Every member is optional, and which ones are read depends on the first
 * element: `omitLastInOneLineBlock` and `omitLastInOneLineClassBody` only apply
 * under `"always"`, and `beforeStatementContinuationChars` only under
 * `"never"`.
 * @typedef {Object} SemiOptions
 * @property {boolean} [omitLastInOneLineBlock] Whether to allow omitting the semicolon of the last statement in a one-line block.
 * @property {boolean} [omitLastInOneLineClassBody] Whether to allow omitting the semicolon of the last member in a one-line class body.
 * @property {"always" | "any" | "never"} [beforeStatementContinuationChars] Whether a semicolon is required before a statement that starts with a continuation character.
 */

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
						name: "semi",
						url: "https://eslint.style/rules/semi",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description: "Require or disallow semicolons instead of ASI",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/semi",
		},

		fixable: "code",

		schema: {
			anyOf: [
				{
					type: "array",
					items: [
						{
							enum: ["never"],
						},
						{
							type: "object",
							properties: {
								beforeStatementContinuationChars: {
									enum: ["always", "any", "never"],
								},
							},
							additionalProperties: false,
						},
					],
					minItems: 0,
					maxItems: 2,
				},
				{
					type: "array",
					items: [
						{
							enum: ["always"],
						},
						{
							type: "object",
							properties: {
								omitLastInOneLineBlock: { type: "boolean" },
								omitLastInOneLineClassBody: { type: "boolean" },
							},
							additionalProperties: false,
						},
					],
					minItems: 0,
					maxItems: 2,
				},
			],
		},

		messages: {
			missingSemi: "Missing semicolon.",
			extraSemi: "Extra semicolon.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const OPT_OUT_PATTERN = /^[-[(/+`]/u; // One of [(/+-`
		const unsafeClassFieldNames = new Set(["get", "set", "static"]);
		const unsafeClassFieldFollowers = new Set(["*", "in", "instanceof"]);

		// `meta.schema` has already checked the shape of the options object.
		const options = /** @type {SemiOptions | undefined} */ (
			context.options[1]
		);
		const never = context.options[0] === "never";
		const exceptOneLine = Boolean(
			options && options.omitLastInOneLineBlock,
		);
		const exceptOneLineClassBody = Boolean(
			options && options.omitLastInOneLineClassBody,
		);
		const beforeStatementContinuationChars =
			(options && options.beforeStatementContinuationChars) || "any";
		const sourceCode = context.sourceCode;

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Reports a semicolon error with appropriate location and message.
		 * @param {ASTNode} node The node with an extra or missing semicolon.
		 * @param {boolean} [missing] True if the semicolon is missing.
		 * @returns {void}
		 */
		function report(node, missing) {
			// Every statement this rule visits spans at least one token.
			const lastToken = /** @type {Token} */ (
				sourceCode.getLastToken(node)
			);
			let messageId, fix, loc;

			if (!missing) {
				messageId = "missingSemi";

				/*
				 * `getNextLocation()` returns `null` only for the location at
				 * the very end of the file, which is exactly where a missing
				 * semicolon can be reported. The linter normalizes a `null`
				 * `end` into a problem with no end position, so the shape is
				 * still a location as far as `context.report()` is concerned.
				 */
				loc = /** @type {SourceLocation} */ ({
					start: lastToken.loc.end,
					end: astUtils.getNextLocation(
						sourceCode,
						lastToken.loc.end,
					),
				});

				/**
				 * Inserts the missing semicolon.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix = function (fixer) {
					return fixer.insertTextAfter(lastToken, ";");
				};
			} else {
				messageId = "extraSemi";
				loc = lastToken.loc;

				/**
				 * Removes the extra semicolon.
				 * @param {RuleFixer} fixer The fixer to use.
				 * @returns {EditInfo} The fix.
				 */
				fix = function (fixer) {
					/*
					 * Expand the replacement range to include the surrounding
					 * tokens to avoid conflicting with no-extra-semi.
					 * https://github.com/eslint/eslint/issues/7928
					 */
					return new FixTracker(fixer, sourceCode)
						.retainSurroundingTokens(lastToken)
						.remove(lastToken);
				};
			}

			context.report({
				node,
				loc,
				messageId,
				fix,
			});
		}

		/**
		 * Check whether a given semicolon token is redundant.
		 * @param {Token} semiToken A semicolon token to check.
		 * @returns {boolean} `true` if the next token is `;` or `}`.
		 */
		function isRedundantSemi(semiToken) {
			const nextToken = sourceCode.getTokenAfter(semiToken);

			return (
				!nextToken ||
				astUtils.isClosingBraceToken(nextToken) ||
				astUtils.isSemicolonToken(nextToken)
			);
		}

		/**
		 * Check whether a given token is the closing brace of an arrow function.
		 * @param {Token} lastToken A token to check.
		 * @returns {boolean} `true` if the token is the closing brace of an arrow function.
		 */
		function isEndOfArrowBlock(lastToken) {
			if (!astUtils.isClosingBraceToken(lastToken)) {
				return false;
			}

			// A `}` in the source is always inside the node that it closes.
			const node = /** @type {ASTNode} */ (
				sourceCode.getNodeByRangeIndex(lastToken.range[0])
			);

			return (
				node.type === "BlockStatement" &&
				node.parent.type === "ArrowFunctionExpression"
			);
		}

		/**
		 * Checks if a given PropertyDefinition node followed by a semicolon
		 * can safely remove that semicolon. It is not to safe to remove if
		 * the class field name is "get", "set", or "static", or if
		 * followed by a generator method.
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} `true` if the node cannot have the semicolon
		 *      removed.
		 */
		function maybeClassFieldAsiHazard(node) {
			if (node.type !== "PropertyDefinition") {
				return false;
			}

			/*
			 * Computed property names and non-identifiers are always safe
			 * as they can be distinguished from keywords easily.
			 */
			const needsNameCheck =
				!node.computed && node.key.type === "Identifier";

			/*
			 * Certain names are problematic unless they also have a
			 * a way to distinguish between keywords and property
			 * names.
			 */
			if (needsNameCheck && unsafeClassFieldNames.has(node.key.name)) {
				/*
				 * Special case: If the field name is `static`,
				 * it is only valid if the field is marked as static,
				 * so "static static" is okay but "static" is not.
				 */
				const isStaticStatic =
					node.static && node.key.name === "static";

				/*
				 * For other unsafe names, we only care if there is no
				 * initializer. No initializer = hazard.
				 */
				if (!isStaticStatic && !node.value) {
					return true;
				}
			}

			// A class field is always followed by at least the class body's `}`.
			const followingToken = /** @type {Token} */ (
				sourceCode.getTokenAfter(node)
			);

			return unsafeClassFieldFollowers.has(followingToken.value);
		}

		/**
		 * Check whether a given node is on the same line with the next token.
		 * @param {ASTNode} node A statement node to check.
		 * @returns {boolean} `true` if the node is on the same line with the next token.
		 */
		function isOnSameLineWithNextToken(node) {
			/*
			 * This is only reached for a statement whose last token is a `;`,
			 * so the statement always has a token before that semicolon.
			 */
			const prevToken = /** @type {Token} */ (
				sourceCode.getLastToken(node, 1)
			);
			const nextToken = sourceCode.getTokenAfter(node);

			return (
				!!nextToken &&
				astUtils.isTokenOnSameLine(
					prevToken,
					/** @type {Token} */ (nextToken),
				)
			);
		}

		/**
		 * Check whether a given node can connect the next line if the next line is unreliable.
		 * @param {ASTNode} node A statement node to check.
		 * @returns {boolean} `true` if the node can connect the next line.
		 */
		function maybeAsiHazardAfter(node) {
			const t = node.type;

			if (
				t === "DoWhileStatement" ||
				t === "BreakStatement" ||
				t === "ContinueStatement" ||
				t === "DebuggerStatement" ||
				t === "ImportDeclaration" ||
				t === "ExportAllDeclaration"
			) {
				return false;
			}
			if (t === "ReturnStatement") {
				return Boolean(node.argument);
			}
			if (t === "ExportNamedDeclaration") {
				return Boolean(node.declaration);
			}

			/*
			 * This is only reached for a statement whose last token is a `;`,
			 * so the statement always has a token before that semicolon.
			 */
			if (
				isEndOfArrowBlock(
					/** @type {Token} */ (sourceCode.getLastToken(node, 1)),
				)
			) {
				return false;
			}

			return true;
		}

		/**
		 * Check whether a given token can connect the previous statement.
		 * @param {Token | Comment | null} token A token to check.
		 * @returns {boolean} `true` if the token is one of `[`, `(`, `/`, `+`, `-`, ```, `++`, and `--`.
		 */
		function maybeAsiHazardBefore(token) {
			/*
			 * `Boolean(token)` has already ruled out the `null` the token
			 * lookups can return, and both callers look the token up without
			 * `includeComments`, so what is left is a `Token`.
			 */
			return (
				Boolean(token) &&
				OPT_OUT_PATTERN.test(/** @type {Token} */ (token).value) &&
				/** @type {Token} */ (token).value !== "++" &&
				/** @type {Token} */ (token).value !== "--"
			);
		}

		/**
		 * Check if the semicolon of a given node is unnecessary, only true if:
		 *   - next token is a valid statement divider (`;` or `}`).
		 *   - next token is on a new line and the node is not connectable to the new line.
		 * @param {ASTNode} node A statement node to check.
		 * @returns {boolean} whether the semicolon is unnecessary.
		 */
		function canRemoveSemicolon(node) {
			// This is only called for a statement whose last token is a `;`.
			if (
				isRedundantSemi(
					/** @type {Token} */ (sourceCode.getLastToken(node)),
				)
			) {
				return true; // `;;` or `;}`
			}
			if (maybeClassFieldAsiHazard(node)) {
				return false;
			}
			if (isOnSameLineWithNextToken(node)) {
				return false; // One liner.
			}

			// continuation characters should not apply to class fields
			if (
				node.type !== "PropertyDefinition" &&
				beforeStatementContinuationChars === "never" &&
				!maybeAsiHazardAfter(node)
			) {
				return true; // ASI works. This statement doesn't connect to the next.
			}
			if (!maybeAsiHazardBefore(sourceCode.getTokenAfter(node))) {
				return true; // ASI works. The next token doesn't connect to this statement.
			}

			return false;
		}

		/**
		 * Checks a node to see if it's the last item in a one-liner block.
		 * Block is any `BlockStatement` or `StaticBlock` node. Block is a one-liner if its
		 * braces (and consequently everything between them) are on the same line.
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} whether the node is the last item in a one-liner block.
		 */
		function isLastInOneLinerBlock(node) {
			const parent = node.parent;
			const nextToken = sourceCode.getTokenAfter(node);

			if (!nextToken || nextToken.value !== "}") {
				return false;
			}

			if (parent.type === "BlockStatement") {
				return parent.loc.start.line === parent.loc.end.line;
			}

			if (parent.type === "StaticBlock") {
				// A `StaticBlock` is always `static` followed by a `{`.
				const openingBrace = /** @type {Token} */ (
					sourceCode.getFirstToken(parent, {
						skip: 1,
					})
				); // skip the `static` token

				return openingBrace.loc.start.line === parent.loc.end.line;
			}

			return false;
		}

		/**
		 * Checks a node to see if it's the last item in a one-liner `ClassBody` node.
		 * ClassBody is a one-liner if its braces (and consequently everything between them) are on the same line.
		 * @param {ASTNode} node The node to check.
		 * @returns {boolean} whether the node is the last item in a one-liner ClassBody.
		 */
		function isLastInOneLinerClassBody(node) {
			const parent = node.parent;
			const nextToken = sourceCode.getTokenAfter(node);

			if (!nextToken || nextToken.value !== "}") {
				return false;
			}

			if (parent.type === "ClassBody") {
				return parent.loc.start.line === parent.loc.end.line;
			}

			return false;
		}

		/**
		 * Checks a node to see if it's followed by a semicolon.
		 * @param {ASTNode} node The node to check.
		 * @returns {void}
		 */
		function checkForSemicolon(node) {
			// Every statement this rule visits spans at least one token.
			const isSemi = astUtils.isSemicolonToken(
				/** @type {Token} */ (sourceCode.getLastToken(node)),
			);

			if (never) {
				if (isSemi && canRemoveSemicolon(node)) {
					report(node, true);
				} else if (
					!isSemi &&
					beforeStatementContinuationChars === "always" &&
					node.type !== "PropertyDefinition" &&
					maybeAsiHazardBefore(sourceCode.getTokenAfter(node))
				) {
					report(node);
				}
			} else {
				const oneLinerBlock =
					exceptOneLine && isLastInOneLinerBlock(node);
				const oneLinerClassBody =
					exceptOneLineClassBody && isLastInOneLinerClassBody(node);
				const oneLinerBlockOrClassBody =
					oneLinerBlock || oneLinerClassBody;

				if (isSemi && oneLinerBlockOrClassBody) {
					report(node, true);
				} else if (!isSemi && !oneLinerBlockOrClassBody) {
					report(node);
				}
			}
		}

		/**
		 * Checks to see if there's a semicolon after a variable declaration.
		 * @param {ASTNode} node The node to check.
		 * @returns {void}
		 */
		function checkForSemicolonForVariableDeclaration(node) {
			const parent = node.parent;

			if (
				(parent.type !== "ForStatement" || parent.init !== node) &&
				(!/^For(?:In|Of)Statement/u.test(parent.type) ||
					parent.left !== node)
			) {
				checkForSemicolon(node);
			}
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			VariableDeclaration: checkForSemicolonForVariableDeclaration,
			ExpressionStatement: checkForSemicolon,
			ReturnStatement: checkForSemicolon,
			ThrowStatement: checkForSemicolon,
			DoWhileStatement: checkForSemicolon,
			DebuggerStatement: checkForSemicolon,
			BreakStatement: checkForSemicolon,
			ContinueStatement: checkForSemicolon,
			ImportDeclaration: checkForSemicolon,
			ExportAllDeclaration: checkForSemicolon,

			/**
			 * Checks an export statement without a declaration for a semicolon.
			 * @param {ASTNode} node The `ExportNamedDeclaration` node.
			 * @returns {void}
			 */
			ExportNamedDeclaration(node) {
				if (!node.declaration) {
					checkForSemicolon(node);
				}
			},

			/**
			 * Checks a default export of an expression for a semicolon.
			 * @param {ASTNode} node The `ExportDefaultDeclaration` node.
			 * @returns {void}
			 */
			ExportDefaultDeclaration(node) {
				if (
					!/(?:Class|Function)Declaration/u.test(
						node.declaration.type,
					)
				) {
					checkForSemicolon(node);
				}
			},
			PropertyDefinition: checkForSemicolon,
		};
	},
};

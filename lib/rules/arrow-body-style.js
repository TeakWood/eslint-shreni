/**
 * @fileoverview Rule to require braces in arrow function body.
 * @author Alberto Rodríguez
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
/** @typedef {import("./utils/ast-utils.js").Comment} Comment */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

/**
 * The per-arrow-function state this rule stacks, used only to answer whether
 * an `in` operator appears anywhere inside the arrow body.
 * @typedef {Object} FuncInfo
 * @property {FuncInfo | null} upper The entry for the enclosing arrow function.
 * @property {boolean} hasInOperator Whether an `in` operator was seen inside.
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: ["as-needed"],

		docs: {
			description: "Require braces around arrow function bodies",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/arrow-body-style",
		},

		schema: {
			anyOf: [
				{
					type: "array",
					items: [
						{
							enum: ["always", "never"],
						},
					],
					minItems: 0,
					maxItems: 1,
				},
				{
					type: "array",
					items: [
						{
							enum: ["as-needed"],
						},
						{
							type: "object",
							properties: {
								requireReturnForObjectLiteral: {
									type: "boolean",
								},
							},
							additionalProperties: false,
						},
					],
					minItems: 0,
					maxItems: 2,
				},
			],
		},

		fixable: "code",

		messages: {
			unexpectedOtherBlock:
				"Unexpected block statement surrounding arrow body.",
			unexpectedEmptyBlock:
				"Unexpected block statement surrounding arrow body; put a value of `undefined` immediately after the `=>`.",
			unexpectedObjectBlock:
				"Unexpected block statement surrounding arrow body; parenthesize the returned value and move it immediately after the `=>`.",
			unexpectedSingleBlock:
				"Unexpected block statement surrounding arrow body; move the returned value immediately after the `=>`.",
			expectedBlock: "Expected block statement surrounding arrow body.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const options = context.options;
		const always = options[0] === "always";
		const asNeeded = options[0] === "as-needed";
		const never = options[0] === "never";
		const requireReturnForObjectLiteral =
			options[1] && options[1].requireReturnForObjectLiteral;
		const sourceCode = context.sourceCode;
		/** @type {FuncInfo | null} */
		let funcInfo = null;

		/**
		 * Checks whether the given node has ASI problem or not.
		 * @param {Token | Comment | null} token The token to check.
		 * @returns {boolean} `true` if it changes semantics if `;` or `}` followed by the token are removed.
		 */
		function hasASIProblem(token) {
			/*
			 * `token` is `null` at end of file; the optional chain stands in
			 * for the `token &&` guard this used to open with, and every
			 * caller reads the result in a boolean position.
			 */
			return (
				token?.type === "Punctuator" && /^[([/`+-]/u.test(token.value)
			);
		}

		/**
		 * Gets the closing parenthesis by the given node.
		 * @param {ASTNode} node first node after an opening parenthesis.
		 * @returns {Token} The found closing parenthesis token.
		 */
		function findClosingParen(node) {
			let nodeToCheck = node;

			while (!astUtils.isParenthesised(sourceCode, nodeToCheck)) {
				nodeToCheck = nodeToCheck.parent;
			}

			// The loop only exits once a wrapping `(` was found, so `)` follows.
			return /** @type {Token} */ (sourceCode.getTokenAfter(nodeToCheck));
		}

		/**
		 * Check whether the node is inside of a for loop's init
		 * @param {ASTNode | null} node node is inside for loop
		 * @returns {boolean} `true` if the node is inside of a for loop, else `false`
		 */
		function isInsideForLoopInitializer(node) {
			if (node && node.parent) {
				if (
					node.parent.type === "ForStatement" &&
					node.parent.init === node
				) {
					return true;
				}
				return isInsideForLoopInitializer(node.parent);
			}
			return false;
		}

		/**
		 * Determines whether a arrow function body needs braces
		 * @param {ASTNode} node The arrow function node.
		 * @returns {void}
		 */
		function validate(node) {
			const arrowBody = node.body;

			if (arrowBody.type === "BlockStatement") {
				const blockBody = arrowBody.body;

				if (blockBody.length !== 1 && !never) {
					return;
				}

				if (
					asNeeded &&
					requireReturnForObjectLiteral &&
					blockBody[0].type === "ReturnStatement" &&
					blockBody[0].argument &&
					blockBody[0].argument.type === "ObjectExpression"
				) {
					return;
				}

				if (
					never ||
					(asNeeded && blockBody[0].type === "ReturnStatement")
				) {
					let messageId;

					if (blockBody.length === 0) {
						messageId = "unexpectedEmptyBlock";
					} else if (
						blockBody.length > 1 ||
						blockBody[0].type !== "ReturnStatement"
					) {
						messageId = "unexpectedOtherBlock";
					} else if (blockBody[0].argument === null) {
						messageId = "unexpectedSingleBlock";
					} else if (
						astUtils.isOpeningBraceToken(
							/*
							 * The branch above established that this is a
							 * `return` with an argument, so the token after
							 * the `return` keyword is always there.
							 */
							/** @type {Token} */ (
								sourceCode.getFirstToken(blockBody[0], {
									skip: 1,
								})
							),
						)
					) {
						messageId = "unexpectedObjectBlock";
					} else {
						messageId = "unexpectedSingleBlock";
					}

					context.report({
						node,
						loc: arrowBody.loc,
						messageId,
						/**
						 * Removes the braces around the arrow body.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {Array<EditInfo>} The fixes to apply.
						 */
						fix(fixer) {
							/** @type {Array<EditInfo>} */
							const fixes = [];

							if (
								blockBody.length !== 1 ||
								blockBody[0].type !== "ReturnStatement" ||
								!blockBody[0].argument ||
								hasASIProblem(
									sourceCode.getTokenAfter(arrowBody),
								)
							) {
								return fixes;
							}

							/*
							 * The body is a `BlockStatement` holding a single
							 * `ReturnStatement` with an argument, so each of
							 * these four tokens is guaranteed to be present.
							 */
							const openingBrace = /** @type {Token} */ (
								sourceCode.getFirstToken(arrowBody)
							);
							const closingBrace = /** @type {Token} */ (
								sourceCode.getLastToken(arrowBody)
							);
							const firstValueToken = /** @type {Token} */ (
								sourceCode.getFirstToken(blockBody[0], 1)
							);
							const lastValueToken = /** @type {Token} */ (
								sourceCode.getLastToken(blockBody[0])
							);
							const commentsExist =
								sourceCode.commentsExistBetween(
									openingBrace,
									firstValueToken,
								) ||
								sourceCode.commentsExistBetween(
									lastValueToken,
									closingBrace,
								);

							/*
							 * Remove tokens around the return value.
							 * If comments don't exist, remove extra spaces as well.
							 */
							if (commentsExist) {
								fixes.push(
									fixer.remove(openingBrace),
									fixer.remove(closingBrace),
									fixer.remove(
										/** @type {Token} */ (
											sourceCode.getTokenAfter(
												openingBrace,
											)
										),
									), // return keyword
								);
							} else {
								fixes.push(
									fixer.removeRange([
										openingBrace.range[0],
										firstValueToken.range[0],
									]),
									fixer.removeRange([
										lastValueToken.range[1],
										closingBrace.range[1],
									]),
								);
							}

							/*
							 * If the first token of the return value is `{` or the return value is a sequence expression,
							 * enclose the return value by parentheses to avoid syntax error.
							 */
							if (
								astUtils.isOpeningBraceToken(firstValueToken) ||
								blockBody[0].argument.type ===
									"SequenceExpression" ||
								/*
								 * `validate()` runs from
								 * `ArrowFunctionExpression:exit`, after the
								 * matching enter handler pushed an entry, so
								 * `funcInfo` is never `null` here.
								 */
								(funcInfo?.hasInOperator &&
									isInsideForLoopInitializer(node))
							) {
								if (
									!astUtils.isParenthesised(
										sourceCode,
										blockBody[0].argument,
									)
								) {
									fixes.push(
										fixer.insertTextBefore(
											firstValueToken,
											"(",
										),
										fixer.insertTextAfter(
											lastValueToken,
											")",
										),
									);
								}
							}

							/*
							 * If the last token of the return statement is semicolon, remove it.
							 * Non-block arrow body is an expression, not a statement.
							 */
							if (astUtils.isSemicolonToken(lastValueToken)) {
								fixes.push(fixer.remove(lastValueToken));
							}

							return fixes;
						},
					});
				}
			} else {
				if (
					always ||
					(asNeeded &&
						requireReturnForObjectLiteral &&
						arrowBody.type === "ObjectExpression")
				) {
					context.report({
						node,
						loc: arrowBody.loc,
						messageId: "expectedBlock",
						/**
						 * Wraps the arrow body in braces.
						 * @param {RuleFixer} fixer The fixer to use.
						 * @returns {Array<EditInfo>} The fixes to apply.
						 */
						fix(fixer) {
							/** @type {Array<EditInfo>} */
							const fixes = [];

							// An arrow function always has a `=>` and a last token.
							const arrowToken = /** @type {Token} */ (
								sourceCode.getTokenBefore(
									arrowBody,
									astUtils.isArrowToken,
								)
							);
							const [
								firstTokenAfterArrow,
								secondTokenAfterArrow,
							] = sourceCode.getTokensAfter(arrowToken, {
								count: 2,
							});
							const lastToken = /** @type {Token} */ (
								sourceCode.getLastToken(node)
							);

							/** @type {ASTNode | null} */
							let parenthesisedObjectLiteral = null;

							if (
								astUtils.isOpeningParenToken(
									firstTokenAfterArrow,
								) &&
								astUtils.isOpeningBraceToken(
									secondTokenAfterArrow,
								)
							) {
								/*
								 * The index is that of a `{` token inside the
								 * file, so a node always covers it.
								 */
								const braceNode = /** @type {ASTNode} */ (
									/** @type {unknown} */ (
										sourceCode.getNodeByRangeIndex(
											secondTokenAfterArrow.range[0],
										)
									)
								);

								if (braceNode.type === "ObjectExpression") {
									parenthesisedObjectLiteral = braceNode;
								}
							}

							// If the value is object literal, remove parentheses which were forced by syntax.
							if (parenthesisedObjectLiteral) {
								const openingParenToken = firstTokenAfterArrow;
								const openingBraceToken = secondTokenAfterArrow;

								if (
									astUtils.isTokenOnSameLine(
										openingParenToken,
										openingBraceToken,
									)
								) {
									fixes.push(
										fixer.replaceText(
											openingParenToken,
											"{return ",
										),
									);
								} else {
									// Avoid ASI
									fixes.push(
										fixer.replaceText(
											openingParenToken,
											"{",
										),
										fixer.insertTextBefore(
											openingBraceToken,
											"return ",
										),
									);
								}

								// Closing paren for the object doesn't have to be lastToken, e.g.: () => ({}).foo()
								fixes.push(
									fixer.remove(
										findClosingParen(
											parenthesisedObjectLiteral,
										),
									),
								);
								fixes.push(
									fixer.insertTextAfter(lastToken, "}"),
								);
							} else {
								fixes.push(
									fixer.insertTextBefore(
										firstTokenAfterArrow,
										"{return ",
									),
								);
								fixes.push(
									fixer.insertTextAfter(lastToken, "}"),
								);
							}

							return fixes;
						},
					});
				}
			}
		}

		return {
			/**
			 * Marks every enclosing arrow function as containing an `in`.
			 * @returns {void}
			 */
			"BinaryExpression[operator='in']"() {
				let info = funcInfo;

				while (info) {
					info.hasInOperator = true;
					info = info.upper;
				}
			},

			/**
			 * Pushes state for the arrow function being entered.
			 * @returns {void}
			 */
			ArrowFunctionExpression() {
				funcInfo = {
					upper: funcInfo,
					hasInOperator: false,
				};
			},

			/**
			 * Validates the arrow function and pops its state.
			 * @param {ASTNode} node The arrow function node.
			 * @returns {void}
			 */
			"ArrowFunctionExpression:exit"(node) {
				validate(node);
				// As in `validate()`: the enter handler pushed this entry.
				funcInfo = /** @type {FuncInfo} */ (funcInfo).upper;
			},
		};
	},
};

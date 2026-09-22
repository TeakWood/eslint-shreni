/**
 * @fileoverview A rule to disallow `this` keywords in contexts where the value of `this` is `undefined`.
 * @author Toru Nagashima
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
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * One entry of the stack of `this` contexts the rule maintains.
 * @typedef {Object} ThisContext
 * @property {boolean} init Whether `valid` has been calculated yet.
 * @property {ASTNode} node The node that opened the context.
 * @property {boolean} valid Whether a `this` keyword in the context is valid.
 */

/**
 * The stack of `this` contexts. It is a plain array with one extra accessor
 * hung off it, which an array literal's own type cannot express.
 * @typedef {Array<ThisContext> & { getCurrent(): ThisContext }} ThisContextStack
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Determines if the given code path is a code path with lexical `this` binding.
 * That is, if `this` within the code path refers to `this` of surrounding code path.
 * @param {CodePath} codePath Code path.
 * @param {ASTNode} node Node that started the code path.
 * @returns {boolean} `true` if it is a code path with lexical `this` binding.
 */
function isCodePathWithLexicalThis(codePath, node) {
	return (
		codePath.origin === "function" &&
		node.type === "ArrowFunctionExpression"
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [{ capIsConstructor: true }],

		docs: {
			description:
				"Disallow use of `this` in contexts where the value of `this` is `undefined`",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-invalid-this",
		},

		schema: [
			{
				type: "object",
				properties: {
					capIsConstructor: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpectedThis: "Unexpected 'this'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ capIsConstructor }] = context.options;
		// The `getCurrent` member is attached on the next statement.
		const stack = /** @type {ThisContextStack} */ (
				/** @type {Array<ThisContext>} */ ([])
			),
			sourceCode = context.sourceCode;

		/**
		 * Gets the current checking context.
		 *
		 * The return value has a flag that whether or not `this` keyword is valid.
		 * The flag is initialized when got at the first time.
		 *   an object which has a flag that whether or not `this` keyword is valid.
		 * @this {ThisContextStack}
		 * @returns {ThisContext} The current context, an object which has a flag that whether or not `this` keyword is valid.
		 */
		stack.getCurrent = function () {
			// A `this` keyword is only ever visited inside a code path, which always pushed a context.
			const current = /** @type {ThisContext} */ (this.at(-1));

			if (!current.init) {
				current.init = true;
				current.valid = !astUtils.isDefaultThisBinding(
					current.node,
					sourceCode,
					{ capIsConstructor },
				);
			}
			return current;
		};

		return {
			/**
			 * Pushes the `this` context the new code path introduces.
			 * @param {CodePath} codePath The code path that started.
			 * @param {ASTNode} node The node that started the code path.
			 * @returns {void}
			 */
			onCodePathStart(codePath, node) {
				if (isCodePathWithLexicalThis(codePath, node)) {
					return;
				}

				if (codePath.origin === "program") {
					const scope = sourceCode.getScope(node);
					const features =
						context.languageOptions.parserOptions.ecmaFeatures ||
						{};

					// `this` at the top level of scripts always refers to the global object
					stack.push({
						init: true,
						node,
						valid: !(
							node.sourceType === "module" ||
							(features.globalReturn &&
								scope.childScopes[0].isStrict)
						),
					});

					return;
				}

				/*
				 * `init: false` means that `valid` isn't determined yet.
				 * Most functions don't use `this`, and the calculation for `valid`
				 * is relatively costly, so we'll calculate it lazily when the first
				 * `this` within the function is traversed. A special case are non-strict
				 * functions, because `this` refers to the global object and therefore is
				 * always valid, so we can set `init: true` right away.
				 */
				stack.push({
					init: !sourceCode.getScope(node).isStrict,
					node,
					valid: true,
				});
			},

			/**
			 * Pops the `this` context the code path introduced.
			 * @param {CodePath} codePath The code path that ended.
			 * @param {ASTNode} node The node that started the code path.
			 * @returns {void}
			 */
			onCodePathEnd(codePath, node) {
				if (isCodePathWithLexicalThis(codePath, node)) {
					return;
				}

				stack.pop();
			},

			/**
			 * Pushes a context for an accessor property's value, where `this` is valid.
			 * @param {ASTNode} node The value node of the `AccessorProperty`.
			 * @returns {void}
			 */
			"AccessorProperty > *.value"(node) {
				stack.push({
					init: true,
					node,
					valid: true,
				});
			},

			/**
			 * Pops the context the accessor property's value introduced.
			 * @returns {void}
			 */
			"AccessorProperty:exit"() {
				stack.pop();
			},

			/**
			 * Reports if `this` of the current context is invalid.
			 * @param {ASTNode} node The `ThisExpression` node.
			 * @returns {void}
			 */
			ThisExpression(node) {
				// Special case: skip `this` if it's the value of an AccessorProperty
				if (
					node.parent.type === "AccessorProperty" &&
					node.parent.value === node
				) {
					return;
				}

				const current = stack.getCurrent();

				if (current && !current.valid) {
					context.report({
						node,
						messageId: "unexpectedThis",
					});
				}
			},
		};
	},
};

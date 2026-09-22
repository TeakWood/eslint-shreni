/**
 * @fileoverview Flag expressions in statement position that do not side effect
 * @author Michael Ficarra
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

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/**
 * Returns `true`.
 * @returns {boolean} `true`.
 */
function alwaysTrue() {
	return true;
}

/**
 * Returns `false`.
 * @returns {boolean} `false`.
 */
function alwaysFalse() {
	return false;
}

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow unused expressions",
			dialects: ["JavaScript", "TypeScript"],
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-unused-expressions",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowShortCircuit: {
						type: "boolean",
					},
					allowTernary: {
						type: "boolean",
					},
					allowTaggedTemplates: {
						type: "boolean",
					},
					enforceForJSX: {
						type: "boolean",
					},
					ignoreDirectives: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		defaultOptions: [
			{
				allowShortCircuit: false,
				allowTernary: false,
				allowTaggedTemplates: false,
				enforceForJSX: false,
				ignoreDirectives: false,
			},
		],

		messages: {
			unusedExpression:
				"Expected an assignment or function call and instead saw an expression.",
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
				allowShortCircuit,
				allowTernary,
				allowTaggedTemplates,
				enforceForJSX,
				ignoreDirectives,
			},
		] = context.options;

		/**
		 * Has AST suggesting a directive.
		 * @param {ASTNode} node any node
		 * @returns {boolean} whether the given node structurally represents a directive
		 */
		function looksLikeDirective(node) {
			return (
				node.type === "ExpressionStatement" &&
				node.expression.type === "Literal" &&
				typeof node.expression.value === "string"
			);
		}

		/**
		 * Gets the leading sequence of members in a list that pass the predicate.
		 * @template T
		 * @param {(item: T) => boolean} predicate the function used to make the determination
		 * @param {Array<T>} list the input list
		 * @returns {Array<T>} the leading sequence of members in the given list that pass the given predicate
		 */
		function takeWhile(predicate, list) {
			for (let i = 0; i < list.length; ++i) {
				if (!predicate(list[i])) {
					return list.slice(0, i);
				}
			}
			return list.slice();
		}

		/**
		 * Gets leading directives nodes in a Node body.
		 * @param {ASTNode} node a Program or BlockStatement node
		 * @returns {Array<ASTNode>} the leading sequence of directive nodes in the given node's body
		 */
		function directives(node) {
			return takeWhile(looksLikeDirective, node.body);
		}

		/**
		 * Detect if a Node is a directive.
		 * @param {ASTNode} node any node
		 * @returns {boolean} whether the given node is considered a directive in its current position
		 */
		function isDirective(node) {
			/**
			 * https://tc39.es/ecma262/#directive-prologue
			 *
			 * Only `FunctionBody`, `ScriptBody` and `ModuleBody` can have directive prologue.
			 * Class static blocks do not have directive prologue.
			 */
			return (
				astUtils.isTopLevelExpressionStatement(node) &&
				directives(node.parent).includes(node)
			);
		}

		/**
		 * The member functions return `true` if the type has no side-effects.
		 * Unknown nodes are handled as `false`, then this rule ignores those.
		 */
		const Checker = Object.assign(Object.create(null), {
			/**
			 * Checks whether the given expression is disallowed in statement position.
			 * @param {ASTNode} node The expression node to check.
			 * @returns {boolean} `true` if the expression has no side-effects.
			 */
			isDisallowed(node) {
				return (Checker[node.type] || alwaysFalse)(node);
			},

			ArrayExpression: alwaysTrue,
			ArrowFunctionExpression: alwaysTrue,
			BinaryExpression: alwaysTrue,

			/**
			 * Checks the expression a chain wraps.
			 * @param {ASTNode} node The `ChainExpression` node.
			 * @returns {boolean} `true` if the wrapped expression has no side-effects.
			 */
			ChainExpression(node) {
				return Checker.isDisallowed(node.expression);
			},

			ClassExpression: alwaysTrue,

			/**
			 * Checks the branches of a conditional expression.
			 * @param {ASTNode} node The `ConditionalExpression` node.
			 * @returns {boolean} `true` if the expression is disallowed.
			 */
			ConditionalExpression(node) {
				if (allowTernary) {
					return (
						Checker.isDisallowed(node.consequent) ||
						Checker.isDisallowed(node.alternate)
					);
				}
				return true;
			},
			FunctionExpression: alwaysTrue,
			Identifier: alwaysTrue,

			/**
			 * Checks a JSX element.
			 * @returns {boolean} `true` if JSX is enforced.
			 */
			JSXElement() {
				return enforceForJSX;
			},

			/**
			 * Checks a JSX fragment.
			 * @returns {boolean} `true` if JSX is enforced.
			 */
			JSXFragment() {
				return enforceForJSX;
			},

			Literal: alwaysTrue,

			/**
			 * Checks the right operand of a logical expression.
			 * @param {ASTNode} node The `LogicalExpression` node.
			 * @returns {boolean} `true` if the expression is disallowed.
			 */
			LogicalExpression(node) {
				if (allowShortCircuit) {
					return Checker.isDisallowed(node.right);
				}
				return true;
			},

			MemberExpression: alwaysTrue,
			MetaProperty: alwaysTrue,
			ObjectExpression: alwaysTrue,
			SequenceExpression: alwaysTrue,

			/**
			 * Checks a tagged template expression.
			 * @returns {boolean} `true` unless tagged templates are allowed.
			 */
			TaggedTemplateExpression() {
				return !allowTaggedTemplates;
			},

			TemplateLiteral: alwaysTrue,
			ThisExpression: alwaysTrue,

			/**
			 * Checks the operator of a unary expression.
			 * @param {ASTNode} node The `UnaryExpression` node.
			 * @returns {boolean} `true` unless the operator has side-effects.
			 */
			UnaryExpression(node) {
				return node.operator !== "void" && node.operator !== "delete";
			},

			// TypeScript-specific node types

			/**
			 * Checks the expression an `as` assertion wraps.
			 * @param {ASTNode} node The `TSAsExpression` node.
			 * @returns {boolean} `true` if the wrapped expression has no side-effects.
			 */
			TSAsExpression(node) {
				return Checker.isDisallowed(node.expression);
			},

			/**
			 * Checks the expression an angle-bracket assertion wraps.
			 * @param {ASTNode} node The `TSTypeAssertion` node.
			 * @returns {boolean} `true` if the wrapped expression has no side-effects.
			 */
			TSTypeAssertion(node) {
				return Checker.isDisallowed(node.expression);
			},

			/**
			 * Checks the expression a non-null assertion wraps.
			 * @param {ASTNode} node The `TSNonNullExpression` node.
			 * @returns {boolean} `true` if the wrapped expression has no side-effects.
			 */
			TSNonNullExpression(node) {
				return Checker.isDisallowed(node.expression);
			},

			/**
			 * Checks the expression an instantiation expression wraps.
			 * @param {ASTNode} node The `TSInstantiationExpression` node.
			 * @returns {boolean} `true` if the wrapped expression has no side-effects.
			 */
			TSInstantiationExpression(node) {
				return Checker.isDisallowed(node.expression);
			},
		});

		return {
			/**
			 * Reports an expression statement whose expression is unused.
			 * @param {ASTNode} node The `ExpressionStatement` node.
			 * @returns {void}
			 */
			ExpressionStatement(node) {
				if (
					Checker.isDisallowed(node.expression) &&
					!astUtils.isDirective(node) &&
					!(ignoreDirectives && isDirective(node))
				) {
					context.report({ node, messageId: "unusedExpression" });
				}
			},
		};
	},
};

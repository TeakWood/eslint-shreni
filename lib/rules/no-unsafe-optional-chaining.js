/**
 * @fileoverview Rule to disallow unsafe optional chaining
 * @author Yeon JuAn
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const UNSAFE_ARITHMETIC_OPERATORS = new Set(["+", "-", "/", "*", "%", "**"]);
const UNSAFE_ASSIGNMENT_OPERATORS = new Set([
	"+=",
	"-=",
	"/=",
	"*=",
	"%=",
	"**=",
]);
const UNSAFE_RELATIONAL_OPERATORS = new Set(["in", "instanceof"]);

/**
 * Checks whether a node is a destructuring pattern or not
 * @param {ASTNode} node node to check
 * @returns {boolean} `true` if a node is a destructuring pattern, otherwise `false`
 */
function isDestructuringPattern(node) {
	return node.type === "ObjectPattern" || node.type === "ArrayPattern";
}

module.exports = {
	meta: {
		type: "problem",

		defaultOptions: [
			{
				disallowArithmeticOperators: false,
			},
		],

		docs: {
			description:
				"Disallow use of optional chaining in contexts where the `undefined` value is not allowed",
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-unsafe-optional-chaining",
		},
		schema: [
			{
				type: "object",
				properties: {
					disallowArithmeticOperators: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],
		fixable: null,
		messages: {
			unsafeOptionalChain:
				"Unsafe usage of optional chaining. If it short-circuits with 'undefined' the evaluation will throw TypeError.",
			unsafeArithmetic:
				"Unsafe arithmetic operation on optional chaining. It can result in NaN.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ disallowArithmeticOperators }] = context.options;

		/**
		 * Reports unsafe usage of optional chaining
		 * @param {ASTNode} node node to report
		 * @returns {void}
		 */
		function reportUnsafeUsage(node) {
			context.report({
				messageId: "unsafeOptionalChain",
				node,
			});
		}

		/**
		 * Reports unsafe arithmetic operation on optional chaining
		 * @param {ASTNode} node node to report
		 * @returns {void}
		 */
		function reportUnsafeArithmetic(node) {
			context.report({
				messageId: "unsafeArithmetic",
				node,
			});
		}

		/**
		 * Checks and reports if a node can short-circuit with `undefined` by optional chaining.
		 * @param {ASTNode | null | undefined} node node to check
		 * @param {(node: ASTNode) => void} reportFunc report function
		 * @returns {void}
		 */
		function checkUndefinedShortCircuit(node, reportFunc) {
			if (!node) {
				return;
			}
			switch (node.type) {
				case "LogicalExpression":
					if (node.operator === "||" || node.operator === "??") {
						checkUndefinedShortCircuit(node.right, reportFunc);
					} else if (node.operator === "&&") {
						checkUndefinedShortCircuit(node.left, reportFunc);
						checkUndefinedShortCircuit(node.right, reportFunc);
					}
					break;
				case "SequenceExpression":
					checkUndefinedShortCircuit(
						node.expressions.at(-1),
						reportFunc,
					);
					break;
				case "ConditionalExpression":
					checkUndefinedShortCircuit(node.consequent, reportFunc);
					checkUndefinedShortCircuit(node.alternate, reportFunc);
					break;
				case "AwaitExpression":
					checkUndefinedShortCircuit(node.argument, reportFunc);
					break;
				case "ChainExpression":
					reportFunc(node);
					break;
				default:
					break;
			}
		}

		/**
		 * Checks unsafe usage of optional chaining
		 * @param {ASTNode | null | undefined} node node to check
		 * @returns {void}
		 */
		function checkUnsafeUsage(node) {
			checkUndefinedShortCircuit(node, reportUnsafeUsage);
		}

		/**
		 * Checks unsafe arithmetic operations on optional chaining
		 * @param {ASTNode | null | undefined} node node to check
		 * @returns {void}
		 */
		function checkUnsafeArithmetic(node) {
			checkUndefinedShortCircuit(node, reportUnsafeArithmetic);
		}

		return {
			/**
			 * Checks the right-hand side of a destructuring assignment.
			 * @param {ASTNode} node The `AssignmentExpression` or `AssignmentPattern` node.
			 * @returns {void}
			 */
			"AssignmentExpression, AssignmentPattern"(node) {
				if (isDestructuringPattern(node.left)) {
					checkUnsafeUsage(node.right);
				}
			},

			/**
			 * Checks the superclass of a class.
			 * @param {ASTNode} node The `ClassDeclaration` or `ClassExpression` node.
			 * @returns {void}
			 */
			"ClassDeclaration, ClassExpression"(node) {
				checkUnsafeUsage(node.superClass);
			},

			/**
			 * Checks the callee of a call expression.
			 * @param {ASTNode} node The `CallExpression` node.
			 * @returns {void}
			 */
			CallExpression(node) {
				if (!node.optional) {
					checkUnsafeUsage(node.callee);
				}
			},

			/**
			 * Checks the callee of a `new` expression.
			 * @param {ASTNode} node The `NewExpression` node.
			 * @returns {void}
			 */
			NewExpression(node) {
				checkUnsafeUsage(node.callee);
			},

			/**
			 * Checks the initializer of a destructuring declarator.
			 * @param {ASTNode} node The `VariableDeclarator` node.
			 * @returns {void}
			 */
			VariableDeclarator(node) {
				if (isDestructuringPattern(node.id)) {
					checkUnsafeUsage(node.init);
				}
			},

			/**
			 * Checks the object of a member expression.
			 * @param {ASTNode} node The `MemberExpression` node.
			 * @returns {void}
			 */
			MemberExpression(node) {
				if (!node.optional) {
					checkUnsafeUsage(node.object);
				}
			},

			/**
			 * Checks the tag of a tagged template expression.
			 * @param {ASTNode} node The `TaggedTemplateExpression` node.
			 * @returns {void}
			 */
			TaggedTemplateExpression(node) {
				checkUnsafeUsage(node.tag);
			},

			/**
			 * Checks the iterated expression of a `for-of` statement.
			 * @param {ASTNode} node The `ForOfStatement` node.
			 * @returns {void}
			 */
			ForOfStatement(node) {
				checkUnsafeUsage(node.right);
			},

			/**
			 * Checks the argument of a spread element.
			 * @param {ASTNode} node The `SpreadElement` node.
			 * @returns {void}
			 */
			SpreadElement(node) {
				if (node.parent && node.parent.type !== "ObjectExpression") {
					checkUnsafeUsage(node.argument);
				}
			},

			/**
			 * Checks the operands of a relational or arithmetic binary expression.
			 * @param {ASTNode} node The `BinaryExpression` node.
			 * @returns {void}
			 */
			BinaryExpression(node) {
				if (UNSAFE_RELATIONAL_OPERATORS.has(node.operator)) {
					checkUnsafeUsage(node.right);
				}
				if (
					disallowArithmeticOperators &&
					UNSAFE_ARITHMETIC_OPERATORS.has(node.operator)
				) {
					checkUnsafeArithmetic(node.right);
					checkUnsafeArithmetic(node.left);
				}
			},

			/**
			 * Checks the object of a `with` statement.
			 * @param {ASTNode} node The `WithStatement` node.
			 * @returns {void}
			 */
			WithStatement(node) {
				checkUnsafeUsage(node.object);
			},

			/**
			 * Checks the argument of an arithmetic unary expression.
			 * @param {ASTNode} node The `UnaryExpression` node.
			 * @returns {void}
			 */
			UnaryExpression(node) {
				if (
					disallowArithmeticOperators &&
					UNSAFE_ARITHMETIC_OPERATORS.has(node.operator)
				) {
					checkUnsafeArithmetic(node.argument);
				}
			},

			/**
			 * Checks the right-hand side of an arithmetic assignment.
			 * @param {ASTNode} node The `AssignmentExpression` node.
			 * @returns {void}
			 */
			AssignmentExpression(node) {
				if (
					disallowArithmeticOperators &&
					UNSAFE_ASSIGNMENT_OPERATORS.has(node.operator)
				) {
					checkUnsafeArithmetic(node.right);
				}
			},
		};
	},
};

/**
 * @fileoverview Counts the cyclomatic complexity of each function of the script. See https://en.wikipedia.org/wiki/Cyclomatic_complexity.
 * Counts the number of if, conditional, for, while, try, switch/case,
 * @author Patrick Brosset
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");
const { upperCaseFirst } = require("../shared/string-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").CodePath} CodePath */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").SourceLocation} SourceLocation */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const THRESHOLD_DEFAULT = 20;

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [THRESHOLD_DEFAULT],

		docs: {
			description:
				"Enforce a maximum cyclomatic complexity allowed in a program",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/complexity",
		},

		schema: [
			{
				oneOf: [
					{
						type: "integer",
						minimum: 0,
					},
					{
						type: "object",
						properties: {
							maximum: {
								type: "integer",
								minimum: 0,
							},
							max: {
								type: "integer",
								minimum: 0,
							},
							variant: {
								enum: ["classic", "modified"],
							},
						},
						additionalProperties: false,
					},
				],
			},
		],

		messages: {
			complex:
				"{{name}} has a complexity of {{complexity}}. Maximum allowed is {{max}}.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const option = context.options[0];
		let threshold = THRESHOLD_DEFAULT;
		let VARIANT = "classic";

		if (typeof option === "object") {
			if (
				Object.hasOwn(option, "maximum") ||
				Object.hasOwn(option, "max")
			) {
				threshold = option.maximum || option.max;
			}

			if (Object.hasOwn(option, "variant")) {
				VARIANT = option.variant;
			}
		} else if (typeof option === "number") {
			threshold = option;
		}

		const IS_MODIFIED_COMPLEXITY = VARIANT === "modified";

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		// Using a stack to store complexity per code path
		/** @type {Array<number>} */
		const complexities = [];

		/**
		 * Increase the complexity of the code path in context
		 * @returns {void}
		 * @private
		 */
		function increaseComplexity() {
			complexities[complexities.length - 1]++;
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		return {
			/**
			 * Pushes a fresh complexity counter for the code path that started.
			 * @returns {void}
			 */
			onCodePathStart() {
				// The initial complexity is 1, representing one execution path in the CodePath
				complexities.push(1);
			},

			// Each branching in the code adds 1 to the complexity
			CatchClause: increaseComplexity,
			ConditionalExpression: increaseComplexity,
			LogicalExpression: increaseComplexity,
			ForStatement: increaseComplexity,
			ForInStatement: increaseComplexity,
			ForOfStatement: increaseComplexity,
			IfStatement: increaseComplexity,
			WhileStatement: increaseComplexity,
			DoWhileStatement: increaseComplexity,
			AssignmentPattern: increaseComplexity,

			// Avoid `default`
			/**
			 * Counts a non-`default` switch case, which the classic variant treats
			 * as a branch and the modified variant does not.
			 * @returns {boolean | void} `true` when the modified variant is in use.
			 */
			"SwitchCase[test]": () =>
				IS_MODIFIED_COMPLEXITY || increaseComplexity(),

			/**
			 * Counts the switch statement itself, which only the modified variant
			 * treats as a single branch.
			 * @returns {boolean | void} `false` when the classic variant is in use.
			 */
			SwitchStatement: () =>
				IS_MODIFIED_COMPLEXITY && increaseComplexity(),

			// Logical assignment operators have short-circuiting behavior
			/**
			 * Counts a logical assignment, which short-circuits and so branches.
			 * @param {ASTNode} node The assignment expression to check.
			 * @returns {void}
			 */
			AssignmentExpression(node) {
				if (astUtils.isLogicalAssignmentOperator(node.operator)) {
					increaseComplexity();
				}
			},

			/**
			 * Counts an optional member access, which short-circuits and so branches.
			 * @param {ASTNode} node The member expression to check.
			 * @returns {void}
			 */
			MemberExpression(node) {
				if (node.optional === true) {
					increaseComplexity();
				}
			},

			/**
			 * Counts an optional call, which short-circuits and so branches.
			 * @param {ASTNode} node The call expression to check.
			 * @returns {void}
			 */
			CallExpression(node) {
				if (node.optional === true) {
					increaseComplexity();
				}
			},

			/**
			 * Reports the code path that ended if its complexity is over the
			 * configured threshold.
			 * @param {CodePath} codePath The code path that ended.
			 * @param {ASTNode} node The node the code path belongs to.
			 * @returns {void}
			 */
			onCodePathEnd(codePath, node) {
				const complexity = /** @type {number} */ (complexities.pop());

				/*
				 * This rule only evaluates complexity of functions, so "program" is excluded.
				 * Class field initializers and class static blocks are implicit functions. Therefore,
				 * they shouldn't contribute to the enclosing function's complexity, but their
				 * own complexity should be evaluated.
				 */
				if (
					codePath.origin !== "function" &&
					codePath.origin !== "class-field-initializer" &&
					codePath.origin !== "class-static-block"
				) {
					return;
				}

				if (complexity > threshold) {
					/** @type {string} */
					let name;

					/** @type {SourceLocation} */
					let loc = node.loc;

					if (codePath.origin === "class-field-initializer") {
						name = "class field initializer";
					} else if (codePath.origin === "class-static-block") {
						name = "class static block";
						loc = /** @type {Token} */ (
							sourceCode.getFirstToken(node)
						).loc;
					} else {
						name = astUtils.getFunctionNameWithKind(node);
						loc = astUtils.getFunctionHeadLoc(node, sourceCode);
					}

					context.report({
						node,
						loc,
						messageId: "complex",
						data: {
							name: upperCaseFirst(name),
							complexity,
							max: threshold,
						},
					});
				}
			},
		};
	},
};

/**
 * @fileoverview Prefer destructuring from arrays and objects
 * @author Alex LaFroscia
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
/** @typedef {import("./utils/types.js").FixFunction} FixFunction */

/**
 * Whether array and/or object destructuring is required for one kind of node.
 * Both properties are optional because the schema lets a user write either half
 * on its own (`{ VariableDeclarator: { object: true } }`); the rule treats an
 * absent property as "not enforced" rather than filling in a default.
 * @typedef {Object} DestructuringTypes
 * @property {boolean} [array] Whether array destructuring is required.
 * @property {boolean} [object] Whether object destructuring is required.
 */

/**
 * The first option, after normalization. The schema also accepts the legacy
 * flat `{ array, object }` shape, which `create()` widens into this one by
 * using it for both node types, so past that point only this shape exists.
 * @typedef {Object} NormalizedOptions
 * @property {DestructuringTypes} [VariableDeclarator] What to enforce on variable declarators.
 * @property {DestructuringTypes} [AssignmentExpression] What to enforce on assignment expressions.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/*
 * `getPrecedence()` switches on `type`, so a synthetic stand-in carries
 * everything it reads. It is not a parsed node, which is why it has no
 * `parent`/`range`/`loc` for the cast to preserve.
 */
const PRECEDENCE_OF_ASSIGNMENT_EXPR = astUtils.getPrecedence(
	/** @type {ASTNode} */ ({
		type: "AssignmentExpression",
	}),
);

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Require destructuring from arrays and/or objects",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/prefer-destructuring",
		},

		fixable: "code",

		schema: [
			{
				/*
				 * old support {array: Boolean, object: Boolean}
				 * new support {VariableDeclarator: {}, AssignmentExpression: {}}
				 */
				oneOf: [
					{
						type: "object",
						properties: {
							VariableDeclarator: {
								type: "object",
								properties: {
									array: {
										type: "boolean",
									},
									object: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
							AssignmentExpression: {
								type: "object",
								properties: {
									array: {
										type: "boolean",
									},
									object: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
						},
						additionalProperties: false,
					},
					{
						type: "object",
						properties: {
							array: {
								type: "boolean",
							},
							object: {
								type: "boolean",
							},
						},
						additionalProperties: false,
					},
				],
			},
			{
				type: "object",
				properties: {
					enforceForRenamedProperties: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			preferDestructuring: "Use {{type}} destructuring.",
		},
	},
	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const enabledTypes = context.options[0];
		const enforceForRenamedProperties =
			context.options[1] &&
			context.options[1].enforceForRenamedProperties;

		/** @type {NormalizedOptions} */
		let normalizedOptions = {
			VariableDeclarator: { array: true, object: true },
			AssignmentExpression: { array: true, object: true },
		};

		if (enabledTypes) {
			normalizedOptions =
				typeof enabledTypes.array !== "undefined" ||
				typeof enabledTypes.object !== "undefined"
					? {
							VariableDeclarator: enabledTypes,
							AssignmentExpression: enabledTypes,
						}
					: enabledTypes;
		}

		//--------------------------------------------------------------------------
		// Helpers
		//--------------------------------------------------------------------------

		/**
		 * Checks if destructuring type should be checked.
		 * @param {string} nodeType "AssignmentExpression" or "VariableDeclarator"
		 * @param {"array" | "object"} destructuringType "array" or "object"
		 * @returns {boolean | undefined} `true` if the destructuring type should be checked for the given node
		 */
		function shouldCheck(nodeType, destructuringType) {
			/*
			 * Callers pass the `type` of a node the rule reports on, which the
			 * two visitors below restrict to the two keys the normalized
			 * options are keyed by. `ASTNode` types `type` as a plain `string`,
			 * so that has to be restated here.
			 */
			const key = /** @type {keyof NormalizedOptions} */ (nodeType);

			return (
				normalizedOptions &&
				normalizedOptions[key] &&
				normalizedOptions[key][destructuringType]
			);
		}

		/**
		 * Determines if the given node is accessing an array index
		 *
		 * This is used to differentiate array index access from object property
		 * access.
		 * @param {ASTNode} node the node to evaluate
		 * @returns {boolean} whether or not the node is an integer
		 */
		function isArrayIndexAccess(node) {
			return Number.isInteger(node.property.value);
		}

		/**
		 * Report that the given node should use destructuring
		 * @param {ASTNode} reportNode the node to report
		 * @param {"array" | "object"} type the type of destructuring that should have been done
		 * @param {FixFunction | null} fix the fix function or null to pass to context.report
		 * @returns {void}
		 */
		function report(reportNode, type, fix) {
			context.report({
				node: reportNode,
				messageId: "preferDestructuring",
				data: { type },
				fix,
			});
		}

		/**
		 * Determines if a node should be fixed into object destructuring
		 *
		 * The fixer only fixes the simplest case of object destructuring,
		 * like: `let x = a.x`;
		 *
		 * Assignment expression is not fixed.
		 * Array destructuring is not fixed.
		 * Renamed property is not fixed.
		 * @param {ASTNode} node the node to evaluate
		 * @returns {boolean} whether or not the node should be fixed
		 */
		function shouldFix(node) {
			return (
				node.type === "VariableDeclarator" &&
				node.id.type === "Identifier" &&
				node.init.type === "MemberExpression" &&
				!node.init.computed &&
				node.init.property.type === "Identifier" &&
				node.id.name === node.init.property.name
			);
		}

		/**
		 * Fix a node into object destructuring.
		 * This function only handles the simplest case of object destructuring,
		 * see {@link shouldFix}.
		 * @param {RuleFixer} fixer the fixer object
		 * @param {ASTNode} node the node to be fixed.
		 * @returns {EditInfo | null} a fix for the node
		 */
		function fixIntoObjectDestructuring(fixer, node) {
			const rightNode = node.init;
			const sourceCode = context.sourceCode;

			// Don't fix if that would remove any comments. Only comments inside `rightNode.object` can be preserved.
			if (
				sourceCode.getCommentsInside(node).length >
				sourceCode.getCommentsInside(rightNode.object).length
			) {
				return null;
			}

			let objectText = sourceCode.getText(rightNode.object);

			if (
				astUtils.getPrecedence(rightNode.object) <
				PRECEDENCE_OF_ASSIGNMENT_EXPR
			) {
				objectText = `(${objectText})`;
			}

			return fixer.replaceText(
				node,
				`{${rightNode.property.name}} = ${objectText}`,
			);
		}

		/**
		 * Check that the `prefer-destructuring` rules are followed based on the
		 * given left- and right-hand side of the assignment.
		 *
		 * Pulled out into a separate method so that VariableDeclarators and
		 * AssignmentExpressions can share the same verification logic.
		 * @param {ASTNode} leftNode the left-hand side of the assignment
		 * @param {ASTNode} rightNode the right-hand side of the assignment
		 * @param {ASTNode} reportNode the node to report the error on
		 * @returns {void}
		 */
		function performCheck(leftNode, rightNode, reportNode) {
			if (
				rightNode.type !== "MemberExpression" ||
				rightNode.object.type === "Super" ||
				rightNode.property.type === "PrivateIdentifier"
			) {
				return;
			}

			if (isArrayIndexAccess(rightNode)) {
				if (shouldCheck(reportNode.type, "array")) {
					report(reportNode, "array", null);
				}
				return;
			}

			const fix = shouldFix(reportNode)
				? (/** @type {RuleFixer} */ fixer) =>
						fixIntoObjectDestructuring(fixer, reportNode)
				: null;

			if (
				shouldCheck(reportNode.type, "object") &&
				enforceForRenamedProperties
			) {
				report(reportNode, "object", fix);
				return;
			}

			if (shouldCheck(reportNode.type, "object")) {
				const property = rightNode.property;

				if (
					(property.type === "Literal" &&
						leftNode.name === property.value) ||
					(property.type === "Identifier" &&
						leftNode.name === property.name &&
						!rightNode.computed)
				) {
					report(reportNode, "object", fix);
				}
			}
		}

		/**
		 * Check if a given variable declarator is coming from an property access
		 * that should be using destructuring instead
		 * @param {ASTNode} node the variable declarator to check
		 * @returns {void}
		 */
		function checkVariableDeclarator(node) {
			// Skip if variable is declared without assignment
			if (!node.init) {
				return;
			}

			// Variable declarations using explicit resource management cannot use destructuring (parse error)
			if (
				node.parent.kind === "using" ||
				node.parent.kind === "await using"
			) {
				return;
			}

			// We only care about member expressions past this point
			if (node.init.type !== "MemberExpression") {
				return;
			}

			performCheck(node.id, node.init, node);
		}

		/**
		 * Run the `prefer-destructuring` check on an AssignmentExpression
		 * @param {ASTNode} node the AssignmentExpression node
		 * @returns {void}
		 */
		function checkAssignmentExpression(node) {
			if (node.operator === "=") {
				performCheck(node.left, node.right, node);
			}
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			VariableDeclarator: checkVariableDeclarator,
			AssignmentExpression: checkAssignmentExpression,
		};
	},
};

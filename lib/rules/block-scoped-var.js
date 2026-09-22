/**
 * @fileoverview Rule to check for "block scoped" variables by binding context
 * @author Matt DuVall <http://www.mattduvall.com>
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("../shared/types.js").Range} Range */
/** @typedef {import("../shared/types.js").SourceLocation} SourceLocation */
/** @typedef {import("eslint-scope").Reference} Reference */
/** @typedef {import("eslint-scope").Definition} Definition */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description:
				"Enforce the use of variables within the scope they are defined",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/block-scoped-var",
		},

		schema: [],

		messages: {
			outOfScope:
				"'{{name}}' declared on line {{definitionLine}} column {{definitionColumn}} is used outside of binding context.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/** @type {Array<Range>} */
		let stack = [];
		const sourceCode = context.sourceCode;

		/**
		 * Makes a block scope.
		 * @param {ASTNode} node A node of a scope.
		 * @returns {void}
		 */
		function enterScope(node) {
			stack.push(node.range);
		}

		/**
		 * Pops the last block scope.
		 * @returns {void}
		 */
		function exitScope() {
			stack.pop();
		}

		/**
		 * Reports a given reference.
		 * @param {Reference} reference A reference to report.
		 * @param {Definition} definition A definition for which to report reference.
		 * @returns {void}
		 */
		function report(reference, definition) {
			const identifier = reference.identifier;

			// The linter always populates `loc` on the nodes it hands to rules.
			const definitionPosition = /** @type {SourceLocation} */ (
				definition.name.loc
			).start;

			context.report({
				node: identifier,
				messageId: "outOfScope",
				data: {
					name: identifier.name,
					definitionLine: definitionPosition.line,
					definitionColumn: definitionPosition.column + 1,
				},
			});
		}

		/**
		 * Finds and reports references which are outside of valid scopes.
		 * @param {ASTNode} node A node to get variables.
		 * @returns {void}
		 */
		function checkForVariables(node) {
			if (node.kind !== "var") {
				return;
			}

			/*
			 * Defines a predicate to check whether or not a given reference is
			 * outside of valid scope. `stack` is seeded by the `Program`
			 * handler before any `VariableDeclaration` can be visited, and
			 * every scope push is paired with a pop, so it is never empty here.
			 */
			const scopeRange = /** @type {Range} */ (stack.at(-1));

			/**
			 * Check if a reference is out of scope
			 * @param {Reference} reference node to examine
			 * @returns {boolean} True is its outside the scope
			 * @private
			 */
			function isOutsideOfScope(reference) {
				// As above: `range` is always populated on a parsed node.
				const idRange = /** @type {Range} */ (
					reference.identifier.range
				);

				return idRange[0] < scopeRange[0] || idRange[1] > scopeRange[1];
			}

			/**
			 * Checks whether a definition was produced by the declaration
			 * being checked.
			 * @param {Definition} def The definition to check.
			 * @returns {boolean} `true` if `def` came from `node`.
			 * @private
			 */
			function isDefinitionOfNode(def) {
				/*
				 * `Definition["parent"]` is an ESTree node while `node` is the
				 * rules-layer `ASTNode`; the two describe the same object at
				 * runtime but have no declared overlap, so the identity check
				 * is made through `unknown`.
				 */
				return /** @type {unknown} */ (def.parent) === node;
			}

			// Gets declared variables, and checks its references.
			const variables = sourceCode.getDeclaredVariables(node);

			for (let i = 0; i < variables.length; ++i) {
				// Reports.
				variables[i].references.filter(isOutsideOfScope).forEach(ref =>
					report(
						ref,
						/*
						 * `variables[i]` was declared by `node`, so one of its
						 * definitions necessarily has `node` as its parent.
						 */
						/** @type {Definition} */ (
							variables[i].defs.find(isDefinitionOfNode)
						),
					),
				);
			}
		}

		return {
			/**
			 * Seeds the scope stack with the program's range.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			Program(node) {
				stack = [node.range];
			},

			// Manages scopes.
			BlockStatement: enterScope,
			"BlockStatement:exit": exitScope,
			ForStatement: enterScope,
			"ForStatement:exit": exitScope,
			ForInStatement: enterScope,
			"ForInStatement:exit": exitScope,
			ForOfStatement: enterScope,
			"ForOfStatement:exit": exitScope,
			SwitchStatement: enterScope,
			"SwitchStatement:exit": exitScope,
			CatchClause: enterScope,
			"CatchClause:exit": exitScope,
			StaticBlock: enterScope,
			"StaticBlock:exit": exitScope,

			// Finds and reports references which are outside of valid scope.
			VariableDeclaration: checkForVariables,
		};
	},
};

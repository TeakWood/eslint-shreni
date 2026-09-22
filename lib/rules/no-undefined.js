/**
 * @fileoverview Rule to flag references to the undefined variable.
 * @author Michael Ficarra
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Scope} Scope */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		docs: {
			description: "Disallow the use of `undefined` as an identifier",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-undefined",
		},

		schema: [],

		messages: {
			unexpectedUndefined: "Unexpected use of undefined.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Report an invalid "undefined" identifier node.
		 *
		 * The node is typed as a bare `object` because every caller passes one
		 * of `eslint-scope`'s own nodes — a `Reference#identifier` or a
		 * `Definition#name` — and it is only ever used for its location, which
		 * is all `context.report()` asks of it.
		 * @param {object} node The node to report.
		 * @returns {void}
		 */
		function report(node) {
			context.report({
				node,
				messageId: "unexpectedUndefined",
			});
		}

		/**
		 * Checks the given scope for references to `undefined` and reports
		 * all references found.
		 * @param {Scope} scope The scope to check.
		 * @returns {void}
		 */
		function checkScope(scope) {
			const undefinedVar = scope.set.get("undefined");

			if (!undefinedVar) {
				return;
			}

			const references = undefinedVar.references;

			const defs = undefinedVar.defs;

			// Report non-initializing references (those are covered in defs below)
			references
				.filter(ref => !ref.init)
				.forEach(ref => report(ref.identifier));

			defs.forEach(def => report(def.name));
		}

		return {
			/**
			 * Walks every scope in the file and reports uses of `undefined`.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);

				const stack = [globalScope];

				while (stack.length) {
					// The loop guard is the stack's own length, so this pop always yields a scope.
					const scope = /** @type {Scope} */ (stack.pop());

					stack.push(...scope.childScopes);
					checkScope(scope);
				}
			},
		};
	},
};

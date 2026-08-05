/**
 * @fileoverview Rule to flag references to the undefined variable.
 * @author Michael Ficarra
 */
"use strict";

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

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

	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * Report an invalid "undefined" identifier node.
		 * @param node The node to report.
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
		 * @param scope The scope to check.
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
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);

				const stack = [globalScope];

				while (stack.length) {
					const scope = stack.pop();

					stack.push(...scope.childScopes);
					checkScope(scope);
				}
			},
		};
	},
};

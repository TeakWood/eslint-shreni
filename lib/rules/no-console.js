/**
 * @fileoverview Rule to flag use of console object
 * @author Nicholas C. Zakas
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
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").SuggestionDescriptor} SuggestionDescriptor */
/** @typedef {import("eslint-scope").Reference} Reference */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types `Reference#identifier` as a bare ESTree `Identifier`: no
 * `parent`, and `range` and `loc` optional. The linter populates all three
 * before any rule runs, so this is the same object a visitor would have
 * received and is reinterpreted rather than re-checked.
 * @param {Object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [{}],

		docs: {
			description: "Disallow the use of `console`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-console",
		},

		schema: [
			{
				type: "object",
				properties: {
					allow: {
						type: "array",
						items: {
							type: "string",
						},
						minItems: 1,
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],

		hasSuggestions: true,

		messages: {
			unexpected: "Unexpected console statement.",
			limited:
				"Unexpected console statement. Only these console methods are allowed: {{ allowed }}.",
			removeConsole: "Remove the console.{{ propertyName }}().",
			removeMethodCall: "Remove the console method call.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		const [{ allow: allowed = [] }] = context.options;
		const sourceCode = context.sourceCode;

		/**
		 * Checks whether the given reference is 'console' or not.
		 * @param {Reference} reference The reference to check.
		 * @returns {boolean} `true` if the reference is 'console'.
		 */
		function isConsole(reference) {
			const id = reference.identifier;

			return id && id.name === "console";
		}

		/**
		 * Checks whether the property name of the given MemberExpression node
		 * is allowed by options or not.
		 * @param {ASTNode} node The MemberExpression node to check.
		 * @returns {boolean} `true` if the property name of the node is allowed.
		 */
		function isAllowed(node) {
			const propertyName = astUtils.getStaticPropertyName(node);

			return propertyName && allowed.includes(propertyName);
		}

		/**
		 * Checks whether the given reference is a member access which is not
		 * allowed by options or not.
		 * @param {Reference} reference The reference to check.
		 * @returns {boolean} `true` if the reference is a member access which
		 *      is not allowed by options.
		 */
		function isMemberAccessExceptAllowed(reference) {
			const node = asNode(reference.identifier);
			const parent = node.parent;

			return (
				parent.type === "MemberExpression" &&
				parent.object === node &&
				!isAllowed(parent)
			);
		}

		/**
		 * Checks if removing the ExpressionStatement node will cause ASI to
		 * break.
		 * eg.
		 * foo()
		 * console.log();
		 * [1, 2, 3].forEach(a => doSomething(a))
		 *
		 * Removing the console.log(); statement should leave two statements, but
		 * here the two statements will become one because [ causes continuation after
		 * foo().
		 * @param {ASTNode} node The ExpressionStatement node to check.
		 * @returns {boolean} `true` if ASI will break after removing the ExpressionStatement
		 *      node.
		 */
		function maybeAsiHazard(node) {
			const SAFE_TOKENS_BEFORE = /^[:;{]$/u; // One of :;{
			const UNSAFE_CHARS_AFTER = /^[-[(/+`]/u; // One of [(/+-`

			const tokenBefore = sourceCode.getTokenBefore(node);
			const tokenAfter = sourceCode.getTokenAfter(node);

			return (
				tokenAfter !== null &&
				UNSAFE_CHARS_AFTER.test(tokenAfter.value) &&
				tokenAfter.value !== "++" &&
				tokenAfter.value !== "--" &&
				tokenBefore !== null &&
				!SAFE_TOKENS_BEFORE.test(tokenBefore.value)
			);
		}

		/**
		 * Checks if the MemberExpression node's parent.parent.parent is a
		 * Program, BlockStatement, StaticBlock, or SwitchCase node. This check
		 * is necessary to avoid providing a suggestion that might cause a syntax error.
		 *
		 * eg. if (a) console.log(b), removing console.log() here will lead to a
		 *     syntax error.
		 *     if (a) { console.log(b) }, removing console.log() here is acceptable.
		 *
		 * Additionally, it checks if the callee of the CallExpression node is
		 * the node itself.
		 *
		 * eg. foo(console.log), cannot provide a suggestion here.
		 * @param {ASTNode} node The MemberExpression node to check.
		 * @returns {boolean} `true` if a suggestion can be provided for a node.
		 */
		function canProvideSuggestions(node) {
			return (
				node.parent.type === "CallExpression" &&
				node.parent.callee === node &&
				node.parent.parent.type === "ExpressionStatement" &&
				astUtils.STATEMENT_LIST_PARENTS.has(
					node.parent.parent.parent.type,
				) &&
				!maybeAsiHazard(node.parent.parent)
			);
		}

		/**
		 * Reports the given reference as a violation.
		 * @param {Reference} reference The reference to report.
		 * @returns {void} No return value.
		 */
		function report(reference) {
			const node = asNode(reference.identifier).parent;

			/** @type {Array<SuggestionDescriptor>} */
			const suggest = [];

			if (canProvideSuggestions(node)) {
				/**
				 * The suggestion that removes the whole `console` call.
				 * @type {SuggestionDescriptor}
				 */
				const suggestion = {
					/**
					 * Removes the statement containing the `console` call.
					 * @param {RuleFixer} fixer The fixer to build the edit with.
					 * @returns {EditInfo} The edit that removes the statement.
					 */
					fix(fixer) {
						return fixer.remove(node.parent.parent);
					},
				};

				if (node.computed) {
					suggestion.messageId = "removeMethodCall";
				} else {
					suggestion.messageId = "removeConsole";
					suggestion.data = { propertyName: node.property.name };
				}
				suggest.push(suggestion);
			}
			context.report({
				node,
				loc: node.loc,
				messageId: allowed.length ? "limited" : "unexpected",
				data: { allowed: allowed.join(", ") },
				suggest,
			});
		}

		return {
			/**
			 * Reports every disallowed `console` member access in the file.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void} No return value.
			 */
			"Program:exit"(node) {
				const scope = sourceCode.getScope(node);
				const consoleVar = astUtils.getVariableByName(scope, "console");
				const shadowed = consoleVar && consoleVar.defs.length > 0;

				/*
				 * 'scope.through' includes all references to undefined
				 * variables. If the variable 'console' is not defined, it uses
				 * 'scope.through'.
				 */
				const references = consoleVar
					? consoleVar.references
					: scope.through.filter(isConsole);

				if (!shadowed) {
					references
						.filter(isMemberAccessExceptAllowed)
						.forEach(report);
				}
			},
		};
	},
};

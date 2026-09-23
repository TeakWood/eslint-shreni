/**
 * @fileoverview A rule to disallow duplicate name in class members.
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * Whether a member name has already been declared, tracked separately for the
 * normal, getter, and setter forms of that name.
 * @typedef {Object} MemberState
 * @property {boolean} init Whether the name is declared as a normal member.
 * @property {boolean} get Whether the name is declared as a getter.
 * @property {boolean} set Whether the name is declared as a setter.
 */

/**
 * The state of every member name seen in one class body, keyed by `$`-prefixed
 * name so that `__proto__` cannot collide with the prototype chain.
 * @typedef {Record<string, { nonStatic: MemberState, static: MemberState }>} ClassBodyState
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow duplicate class members",
			dialects: ["JavaScript", "TypeScript"],
			recommended: true,
			url: "https://eslint.org/docs/latest/rules/no-dupe-class-members",
		},

		schema: [],

		messages: {
			unexpected: "Duplicate name '{{name}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor for this rule.
	 */
	create(context) {
		/** @type {Array<ClassBodyState>} */
		let stack = [];

		/**
		 * Gets state of a given member name.
		 * @param {string} name A name of a member.
		 * @param {boolean} isStatic A flag which specifies that is a static member.
		 * @returns {MemberState} A state of a given member name, recording whether it is already declared as a normal member, a getter, and a setter.
		 */
		function getState(name, isStatic) {
			// `getState()` only runs from the member handler, which is only reached inside a `ClassBody`, so the stack is never empty.
			const stateMap = /** @type {ClassBodyState} */ (stack.at(-1));
			const key = `$${name}`; // to avoid "__proto__".

			if (!stateMap[key]) {
				stateMap[key] = {
					nonStatic: { init: false, get: false, set: false },
					static: { init: false, get: false, set: false },
				};
			}

			return stateMap[key][isStatic ? "static" : "nonStatic"];
		}

		return {
			/**
			 * Initializes the stack of state of member declarations.
			 * @returns {void} No return value.
			 */
			Program() {
				stack = [];
			},

			/**
			 * Initializes state of member declarations for the class.
			 * @returns {void} No return value.
			 */
			ClassBody() {
				stack.push(Object.create(null));
			},

			/**
			 * Disposes the state for the class.
			 * @returns {void} No return value.
			 */
			"ClassBody:exit"() {
				stack.pop();
			},

			/**
			 * Reports the node if its name has been declared already.
			 * @param {ASTNode} node The member definition to check.
			 * @returns {void} No return value.
			 */
			"MethodDefinition, PropertyDefinition"(node) {
				if (
					node.value &&
					node.value.type === "TSEmptyBodyFunctionExpression"
				) {
					return;
				}

				const name = astUtils.getStaticPropertyName(node);
				const kind =
					node.type === "MethodDefinition" ? node.kind : "field";

				if (name === null || kind === "constructor") {
					return;
				}

				const state = getState(name, node.static);
				let isDuplicate;

				if (kind === "get") {
					isDuplicate = state.init || state.get;
					state.get = true;
				} else if (kind === "set") {
					isDuplicate = state.init || state.set;
					state.set = true;
				} else {
					isDuplicate = state.init || state.get || state.set;
					state.init = true;
				}

				if (isDuplicate) {
					context.report({
						loc: node.key.loc,
						messageId: "unexpected",
						data: { name },
					});
				}
			},
		};
	},
};

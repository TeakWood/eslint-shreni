/**
 * @fileoverview Disallow Labeled Statements
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
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */

/**
 * The rule's option object. `meta.defaultOptions` has already filled both
 * members in by the time `create()` runs, so neither is optional here.
 * @typedef {Object} RuleOptions
 * @property {boolean} allowLoop Whether a label on a loop statement is allowed.
 * @property {boolean} allowSwitch Whether a label on a `switch` statement is allowed.
 */

/**
 * The kind of statement a label is attached to. Only "loop" and "switch" can be
 * allowed by an option; everything else is reported unconditionally.
 * @typedef {"loop" | "switch" | "other"} LabelKind
 */

/**
 * One entry of the stack of labels currently being traversed, innermost first.
 * @typedef {Object} ScopeInfo
 * @property {string} label The name of the label.
 * @property {LabelKind} kind The kind of statement the label is attached to.
 * @property {ScopeInfo | null} upper The entry for the enclosing label, or `null` at the outermost one.
 */

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				allowLoop: false,
				allowSwitch: false,
			},
		],

		docs: {
			description: "Disallow labeled statements",
			recommended: false,
			frozen: true,
			url: "https://eslint.org/docs/latest/rules/no-labels",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowLoop: {
						type: "boolean",
					},
					allowSwitch: {
						type: "boolean",
					},
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpectedLabel: "Unexpected labeled statement.",
			unexpectedLabelInBreak: "Unexpected label in break statement.",
			unexpectedLabelInContinue:
				"Unexpected label in continue statement.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const [{ allowLoop, allowSwitch }] = /** @type {[RuleOptions]} */ (
			context.options
		);

		/** @type {ScopeInfo | null} */
		let scopeInfo = null;

		/**
		 * Gets the kind of a given node.
		 * @param {ASTNode} node A node to get.
		 * @returns {LabelKind} The kind of the node.
		 */
		function getBodyKind(node) {
			if (astUtils.isLoop(node)) {
				return "loop";
			}
			if (node.type === "SwitchStatement") {
				return "switch";
			}
			return "other";
		}

		/**
		 * Checks whether the label of a given kind is allowed or not.
		 * @param {LabelKind} kind A kind to check.
		 * @returns {boolean} `true` if the kind is allowed.
		 */
		function isAllowed(kind) {
			switch (kind) {
				case "loop":
					return allowLoop;
				case "switch":
					return allowSwitch;
				default:
					return false;
			}
		}

		/**
		 * Checks whether a given name is a label of a loop or not.
		 * @param {string} label A name of a label to check.
		 * @returns {LabelKind} The kind of the statement the named label is attached to.
		 */
		function getKind(label) {
			let info = scopeInfo;

			while (info) {
				if (info.label === label) {
					return info.kind;
				}
				info = info.upper;
			}

			/* c8 ignore next */
			return "other";
		}

		//--------------------------------------------------------------------------
		// Public
		//--------------------------------------------------------------------------

		return {
			LabeledStatement(node) {
				scopeInfo = {
					label: node.label.name,
					kind: getBodyKind(node.body),
					upper: scopeInfo,
				};
			},

			"LabeledStatement:exit"(node) {
				// The enter handler above pushed an entry for this very node.
				const info = /** @type {ScopeInfo} */ (scopeInfo);

				if (!isAllowed(info.kind)) {
					context.report({
						node,
						messageId: "unexpectedLabel",
					});
				}

				scopeInfo = info.upper;
			},

			BreakStatement(node) {
				if (node.label && !isAllowed(getKind(node.label.name))) {
					context.report({
						node,
						messageId: "unexpectedLabelInBreak",
					});
				}
			},

			ContinueStatement(node) {
				if (node.label && !isAllowed(getKind(node.label.name))) {
					context.report({
						node,
						messageId: "unexpectedLabelInContinue",
					});
				}
			},
		};
	},
};

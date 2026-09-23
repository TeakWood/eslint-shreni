/**
 * @fileoverview Rule to flag use of eval() statement
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
/** @typedef {import("eslint-scope").Scope} Scope */

/**
 * The tracking information for one `this` scope, kept as a linked stack.
 * @typedef {Object} FuncInfo
 * @property {FuncInfo | null} upper The information of the enclosing `this` scope, if any.
 * @property {ASTNode} node The node that introduced the scope.
 * @property {boolean} strict Whether the scope is strict mode code.
 * @property {boolean} isTopLevelOfScript Whether the scope is the top level of a script, where `this` is always the global object.
 * @property {boolean} defaultThis Whether the scope has the default `this` binding. Only meaningful once `initialized` is `true`.
 * @property {boolean} initialized Whether `defaultThis` has been computed yet.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const candidatesOfGlobalObject = Object.freeze([
	"global",
	"window",
	"globalThis",
]);

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

/**
 * Checks a given node is a MemberExpression node which has the specified name's
 * property.
 * @param {ASTNode} node A node to check.
 * @param {string} name A name to check.
 * @returns {boolean} `true` if the node is a MemberExpression node which has
 *      the specified name's property
 */
function isMember(node, name) {
	return astUtils.isSpecificMemberAccess(node, null, name);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "suggestion",

		defaultOptions: [
			{
				allowIndirect: false,
			},
		],

		docs: {
			description: "Disallow the use of `eval()`",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-eval",
		},

		schema: [
			{
				type: "object",
				properties: {
					allowIndirect: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],

		messages: {
			unexpected: "`eval` can be harmful.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor the linter walks the AST with.
	 */
	create(context) {
		const [{ allowIndirect }] = context.options;
		const sourceCode = context.sourceCode;

		/** @type {FuncInfo | null} */
		let funcInfo = null;

		/**
		 * Pushes a `this` scope (non-arrow function, class static block, or class field initializer) information to the stack.
		 * Top-level scopes are handled separately.
		 *
		 * This is used in order to check whether or not `this` binding is a
		 * reference to the global object.
		 * @param {ASTNode} node A node of the scope.
		 *      For functions, this is one of FunctionDeclaration, FunctionExpression.
		 *      For class static blocks, this is StaticBlock.
		 *      For class field initializers, this can be any node that is PropertyDefinition#value.
		 * @returns {void}
		 */
		function enterThisScope(node) {
			const strict = sourceCode.getScope(node).isStrict;

			funcInfo = {
				upper: funcInfo,
				node,
				strict,
				isTopLevelOfScript: false,
				defaultThis: false,
				initialized: strict,
			};
		}

		/**
		 * Pops a variable scope from the stack.
		 * @returns {void}
		 */
		function exitThisScope() {
			/*
			 * This only runs as the `:exit` half of a visitor whose entry half
			 * pushed an entry, so the stack is never empty here.
			 */
			funcInfo = /** @type {FuncInfo} */ (funcInfo).upper;
		}

		/**
		 * Reports a given node.
		 *
		 * `node` is `Identifier` or `MemberExpression`.
		 * The parent of `node` might be `CallExpression`.
		 *
		 * The location of the report is always `eval` `Identifier` (or possibly
		 * `Literal`). The type of the report is `CallExpression` if the parent is
		 * `CallExpression`. Otherwise, it's the given node type.
		 * @param {ASTNode} node A node to report.
		 * @returns {void}
		 */
		function report(node) {
			const parent = node.parent;
			const locationNode =
				node.type === "MemberExpression" ? node.property : node;

			const reportNode =
				parent.type === "CallExpression" && parent.callee === node
					? parent
					: node;

			context.report({
				node: reportNode,
				loc: locationNode.loc,
				messageId: "unexpected",
			});
		}

		/**
		 * Reports accesses of `eval` via the global object.
		 * @param {Scope} globalScope The global scope.
		 * @returns {void}
		 */
		function reportAccessingEvalViaGlobalObject(globalScope) {
			for (let i = 0; i < candidatesOfGlobalObject.length; ++i) {
				const name = candidatesOfGlobalObject[i];
				const variable = astUtils.getVariableByName(globalScope, name);

				if (!variable) {
					continue;
				}

				const references = variable.references;

				for (let j = 0; j < references.length; ++j) {
					const identifier = asNode(references[j].identifier);
					let node = identifier.parent;

					// To detect code like `window.window.eval`.
					while (isMember(node, name)) {
						node = node.parent;
					}

					// Reports.
					if (isMember(node, "eval")) {
						report(node);
					}
				}
			}
		}

		/**
		 * Reports all accesses of `eval` (excludes direct calls to eval).
		 * @param {Scope} globalScope The global scope.
		 * @returns {void}
		 */
		function reportAccessingEval(globalScope) {
			const variable = astUtils.getVariableByName(globalScope, "eval");

			if (!variable) {
				return;
			}

			const references = variable.references;

			for (let i = 0; i < references.length; ++i) {
				const reference = references[i];
				const id = asNode(reference.identifier);

				if (id.name === "eval" && !astUtils.isCallee(id)) {
					// Is accessing to eval (excludes direct calls to eval)
					report(id);
				}
			}
		}

		if (allowIndirect) {
			// Checks only direct calls to eval. It's simple!
			return {
				/**
				 * Reports a direct call to `eval`.
				 * @param {ASTNode} node The CallExpression node to check.
				 * @returns {void}
				 */
				"CallExpression:exit"(node) {
					const callee = node.callee;

					/*
					 * Optional call (`eval?.("code")`) is not direct eval.
					 * The direct eval is only step 6.a.vi of https://tc39.es/ecma262/#sec-function-calls-runtime-semantics-evaluation
					 * But the optional call is https://tc39.es/ecma262/#sec-optional-chaining-chain-evaluation
					 */
					if (
						!node.optional &&
						astUtils.isSpecificId(callee, "eval")
					) {
						report(callee);
					}
				},
			};
		}

		return {
			/**
			 * Reports a call to `eval`, direct or indirect.
			 * @param {ASTNode} node The CallExpression node to check.
			 * @returns {void}
			 */
			"CallExpression:exit"(node) {
				const callee = node.callee;

				if (astUtils.isSpecificId(callee, "eval")) {
					report(callee);
				}
			},

			/**
			 * Pushes the top-level `this` scope onto the stack.
			 * @param {ASTNode} node The Program node.
			 * @returns {void}
			 */
			Program(node) {
				const scope = sourceCode.getScope(node),
					features =
						context.languageOptions.parserOptions.ecmaFeatures ||
						{},
					strict =
						scope.isStrict ||
						node.sourceType === "module" ||
						(features.globalReturn &&
							scope.childScopes[0].isStrict),
					isTopLevelOfScript =
						node.sourceType !== "module" && !features.globalReturn;

				funcInfo = {
					upper: null,
					node,
					strict,
					isTopLevelOfScript,
					defaultThis: true,
					initialized: true,
				};
			},

			/**
			 * Reports every access of `eval` found in the global scope.
			 * @param {ASTNode} node The Program node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const globalScope = sourceCode.getScope(node);

				exitThisScope();
				reportAccessingEval(globalScope);
				reportAccessingEvalViaGlobalObject(globalScope);
			},

			FunctionDeclaration: enterThisScope,
			"FunctionDeclaration:exit": exitThisScope,
			FunctionExpression: enterThisScope,
			"FunctionExpression:exit": exitThisScope,
			"PropertyDefinition > *.value": enterThisScope,
			"PropertyDefinition > *.value:exit": exitThisScope,
			StaticBlock: enterThisScope,
			"StaticBlock:exit": exitThisScope,

			/**
			 * Reports `this.eval` when `this` may be the global object.
			 * @param {ASTNode} node The ThisExpression node to check.
			 * @returns {void}
			 */
			ThisExpression(node) {
				if (!isMember(node.parent, "eval")) {
					return;
				}

				/*
				 * `Program` pushes the top-level entry before any other visitor
				 * runs, so the stack always holds the current `this` scope here.
				 */
				const currentFuncInfo = /** @type {FuncInfo} */ (funcInfo);

				/*
				 * `this.eval` is found.
				 * Checks whether or not the value of `this` is the global object.
				 */
				if (!currentFuncInfo.initialized) {
					currentFuncInfo.initialized = true;
					currentFuncInfo.defaultThis = astUtils.isDefaultThisBinding(
						currentFuncInfo.node,
						sourceCode,
					);
				}

				// `this` at the top level of scripts always refers to the global object
				if (
					currentFuncInfo.isTopLevelOfScript ||
					(!currentFuncInfo.strict && currentFuncInfo.defaultThis)
				) {
					// `this.eval` is possible built-in `eval`.
					report(node.parent);
				}
			},
		};
	},
};

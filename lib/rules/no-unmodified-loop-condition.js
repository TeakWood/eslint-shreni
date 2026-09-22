/**
 * @fileoverview Rule to disallow use of unmodified expressions in loop conditions
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const Traverser = require("../shared/traverser"),
	astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("eslint-scope").Reference} Reference */
/** @typedef {import("eslint-scope").Scope} Scope */
/** @typedef {import("eslint-scope").Variable} Variable */
/** @typedef {import("estree").Node} ESTreeNode */

/**
 * One reference that appears in a loop's condition, together with everything
 * the rule needs in order to decide whether that condition can ever change.
 * @typedef {Object} LoopCondition
 * @property {Reference} reference The reference that appears in the loop condition.
 * @property {ASTNode | null} group The `BinaryExpression` or `ConditionalExpression` this reference is an operand of, if any. Conditions in the same group are reported only if none of them is modified.
 * @property {(reference: Reference) => boolean} isInLoop Checks whether a given reference lies inside the loop this condition belongs to.
 * @property {boolean} modified Whether the loop body modifies the referenced variable.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Reinterprets a node that `eslint-scope` handed back as a rules-layer node.
 *
 * `eslint-scope` types the AST it stores — `Reference#identifier` here — as
 * bare ESTree nodes: no `parent`, and `range` and `loc` optional. The linter
 * populates all three before any rule runs, so each of these is the same object
 * a visitor would have received and is reinterpreted rather than re-checked.
 * @param {object} node The node to reinterpret.
 * @returns {ASTNode} The same node, as the rules layer sees it.
 * @private
 */
function asNode(node) {
	return /** @type {ASTNode} */ (/** @type {unknown} */ (node));
}

const SENTINEL_PATTERN =
	/(?:(?:Call|Class|Function|Member|New|Yield)Expression|Statement|Declaration)$/u;
const LOOP_PATTERN = /^(?:DoWhile|For|While)Statement$/u; // for-in/of statements don't have `test` property.
const GROUP_PATTERN = /^(?:BinaryExpression|ConditionalExpression)$/u;
const SKIP_PATTERN = /^(?:ArrowFunction|Class|Function)Expression$/u;
const DYNAMIC_PATTERN = /^(?:Call|Member|New|TaggedTemplate|Yield)Expression$/u;

/**
 * Checks whether or not a given reference is a write reference.
 * @param {Reference} reference A reference to check.
 * @returns {boolean} `true` if the reference is a write reference.
 */
function isWriteReference(reference) {
	if (reference.init) {
		const def = reference.resolved && reference.resolved.defs[0];

		if (!def || def.type !== "Variable" || def.parent.kind !== "var") {
			return false;
		}
	}
	return reference.isWrite();
}

/**
 * Checks whether or not a given loop condition info does not have the modified
 * flag.
 * @param {LoopCondition} condition A loop condition info to check.
 * @returns {boolean} `true` if the loop condition info is "unmodified".
 */
function isUnmodified(condition) {
	return !condition.modified;
}

/**
 * Checks whether or not a given loop condition info does not have the modified
 * flag and does not have the group this condition belongs to.
 * @param {LoopCondition} condition A loop condition info to check.
 * @returns {boolean} `true` if the loop condition info is "unmodified".
 */
function isUnmodifiedAndNotBelongToGroup(condition) {
	return !(condition.modified || condition.group);
}

/**
 * Checks whether or not a given reference is inside of a given node.
 * @param {ASTNode} node A node to check.
 * @param {Reference} reference A reference to check.
 * @returns {boolean} `true` if the reference is inside of the node.
 */
function isInRange(node, reference) {
	const or = node.range;
	const ir = asNode(reference.identifier).range;

	return or[0] <= ir[0] && ir[1] <= or[1];
}

/**
 * Checks whether or not a given reference is inside of a loop node's condition,
 * keyed by the type of the loop node.
 * @type {Record<string, (node: ASTNode, reference: Reference) => boolean>}
 */
const isInLoop = {
	WhileStatement: isInRange,
	DoWhileStatement: isInRange,

	/**
	 * Checks whether or not a given reference is inside of a `for` statement's
	 * condition, which excludes its initializer.
	 * @param {ASTNode} node The `ForStatement` node to check.
	 * @param {Reference} reference A reference to check.
	 * @returns {boolean} `true` if the reference is inside of the loop node's condition.
	 */
	ForStatement(node, reference) {
		return (
			isInRange(node, reference) &&
			!(node.init && isInRange(node.init, reference))
		);
	},
};

/**
 * Gets the function which encloses a given reference.
 * This supports only FunctionDeclaration.
 * @param {Reference} reference A reference to get.
 * @returns {ASTNode | null} The function node or null.
 */
function getEncloseFunctionDeclaration(reference) {
	/** @type {ASTNode | null} */
	let node = asNode(reference.identifier);

	while (node) {
		if (node.type === "FunctionDeclaration") {
			return node.id ? node : null;
		}

		node = node.parent;
	}

	return null;
}

/**
 * Checks whether a given modifier is in a loop.
 *
 * Besides checking for the condition being in the loop, this also checks
 * whether the function that this modifier is belonging to is called
 * in the loop.
 * @param {LoopCondition} condition The condition to check.
 * @param {Reference} modifier The modifier to check.
 * @returns {boolean} `true` if the modifier is in a loop.
 */
function hasModifierInLoop(condition, modifier) {
	if (condition.isInLoop(modifier)) {
		return true;
	}

	const funcNode = getEncloseFunctionDeclaration(modifier);

	if (!funcNode) {
		return false;
	}

	// `funcNode` encloses the modifier, so the modifier's own scope is nested at least one level deep and always has an upper scope.
	const funcVar = astUtils.getVariableByName(
		/** @type {Scope} */ (modifier.from.upper),
		funcNode.id.name,
	);

	return Boolean(funcVar && funcVar.references.some(condition.isInLoop));
}

/**
 * Updates the "modified" flags of given loop conditions with given modifiers.
 * @param {Array<LoopCondition>} conditions The loop conditions to be updated.
 * @param {Array<Reference>} modifiers The references to update.
 * @returns {void}
 */
function updateModifiedFlag(conditions, modifiers) {
	for (let i = 0; i < conditions.length; ++i) {
		const condition = conditions[i];

		for (let j = 0; !condition.modified && j < modifiers.length; ++j) {
			const modifier = modifiers[j];

			condition.modified = hasModifierInLoop(condition, modifier);
		}
	}
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: "problem",

		docs: {
			description: "Disallow unmodified loop conditions",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/no-unmodified-loop-condition",
		},

		schema: [],

		messages: {
			loopConditionNotModified:
				"'{{name}}' is not modified in this loop.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;

		/** @type {Map<ASTNode, Array<LoopCondition>> | null} */
		let groupMap = null;

		/**
		 * Reports a given condition info.
		 * @param {LoopCondition} condition A loop condition info to report.
		 * @returns {void}
		 */
		function report(condition) {
			const node = asNode(condition.reference.identifier);

			context.report({
				node,
				messageId: "loopConditionNotModified",
				data: node,
			});
		}

		/**
		 * Registers given conditions to the group the condition belongs to.
		 * @param {Array<LoopCondition>} conditions A loop condition info to
		 *      register.
		 * @returns {void}
		 */
		function registerConditionsToGroup(conditions) {
			// Only reachable from the `Program:exit` handler below, which owns the map.
			const groups = /** @type {Map<ASTNode, Array<LoopCondition>>} */ (
				groupMap
			);

			for (let i = 0; i < conditions.length; ++i) {
				const condition = conditions[i];

				if (condition.group) {
					let group = groups.get(condition.group);

					if (!group) {
						group = [];
						groups.set(condition.group, group);
					}
					group.push(condition);
				}
			}
		}

		/**
		 * Reports references which are inside of unmodified groups.
		 * @param {Array<LoopCondition>} conditions A loop condition info to report.
		 * @returns {void}
		 */
		function checkConditionsInGroup(conditions) {
			if (conditions.every(isUnmodified)) {
				conditions.forEach(report);
			}
		}

		/**
		 * Checks whether or not a given group node has any dynamic elements.
		 * @param {ASTNode} root A node to check.
		 *      This node is one of BinaryExpression or ConditionalExpression.
		 * @returns {boolean} `true` if the node is dynamic.
		 */
		function hasDynamicExpressions(root) {
			let retv = false;

			Traverser.traverse(/** @type {ESTreeNode} */ (root), {
				visitorKeys: sourceCode.visitorKeys,

				/**
				 * Flags the traversal as dynamic, or skips subtrees that cannot
				 * contribute to the group's value.
				 * @this {Traverser}
				 * @param {ESTreeNode} node The node being entered.
				 * @returns {void}
				 */
				enter(node) {
					if (DYNAMIC_PATTERN.test(node.type)) {
						retv = true;
						this.break();
					} else if (SKIP_PATTERN.test(node.type)) {
						this.skip();
					}
				},
			});

			return retv;
		}

		/**
		 * Creates the loop condition information from a given reference.
		 * @param {Reference} reference A reference to create.
		 * @returns {LoopCondition | null} Created loop condition info, or null.
		 */
		function toLoopCondition(reference) {
			if (reference.init) {
				return null;
			}

			/** @type {ASTNode | null} */
			let group = null;
			let child = asNode(reference.identifier);
			let node = child.parent;

			while (node) {
				if (SENTINEL_PATTERN.test(node.type)) {
					if (LOOP_PATTERN.test(node.type) && node.test === child) {
						// This reference is inside of a loop condition.
						return {
							reference,
							group,
							isInLoop: isInLoop[node.type].bind(null, node),
							modified: false,
						};
					}

					// This reference is outside of a loop condition.
					break;
				}

				/*
				 * If it's inside of a group, OK if either operand is modified.
				 * So stores the group this reference belongs to.
				 */
				if (GROUP_PATTERN.test(node.type)) {
					// If this expression is dynamic, no need to check.
					if (hasDynamicExpressions(node)) {
						break;
					} else {
						group = node;
					}
				}

				child = node;
				node = node.parent;
			}

			return null;
		}

		/**
		 * Finds unmodified references which are inside of a loop condition.
		 * Then reports the references which are outside of groups.
		 * @param {Variable} variable A variable to report.
		 * @returns {void}
		 */
		function checkReferences(variable) {
			// Gets references that exist in loop conditions.
			const conditions = /** @type {Array<LoopCondition>} */ (
				variable.references.map(toLoopCondition).filter(Boolean)
			);

			if (conditions.length === 0) {
				return;
			}

			// Registers the conditions to belonging groups.
			registerConditionsToGroup(conditions);

			// Check the conditions are modified.
			const modifiers = variable.references.filter(isWriteReference);

			if (modifiers.length > 0) {
				updateModifiedFlag(conditions, modifiers);
			}

			/*
			 * Reports the conditions which are not belonging to groups.
			 * Others will be reported after all variables are done.
			 */
			conditions.filter(isUnmodifiedAndNotBelongToGroup).forEach(report);
		}

		return {
			/**
			 * Walks every scope in the file and reports the loop conditions
			 * that nothing in their loop modifies.
			 * @param {ASTNode} node The `Program` node.
			 * @returns {void}
			 */
			"Program:exit"(node) {
				const queue = [sourceCode.getScope(node)];

				groupMap = new Map();

				/** @type {Scope | undefined} */
				let scope;

				while ((scope = queue.pop())) {
					queue.push(...scope.childScopes);
					scope.variables.forEach(checkReferences);
				}

				groupMap.forEach(checkConditionsInGroup);
				groupMap = null;
			},
		};
	},
};

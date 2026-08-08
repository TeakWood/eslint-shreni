// @ts-check
/**
 * @fileoverview Helper class to aid in constructing fix commands.
 * @author Alan Pierce
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./ast-utils");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/** @import { NodeOrToken, RuleFix, RuleFixer, SourceCode, SourceRange } from "../../types/core.js" */

/**
 * A node as `ast-utils.js` sees one.
 *
 * `getUpperFunction` walks `parent`, which `ASTNode` declares as
 * `ASTNode | null`, so it takes the widened view that module exports rather
 * than `ASTNode` itself. Reusing that view here — instead of restating it —
 * keeps this file on ONE vocabulary: it retires automatically when the closed
 * node union lands and `ast-utils.js` drops its `Node` typedef.
 * @typedef {Parameters<typeof astUtils.getUpperFunction>[0]} Node
 */

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * A helper class to combine fix options into a fix command. Currently, it
 * exposes some "retain" methods that extend the range of the text being
 * replaced so that other fixes won't touch that region in the same pass.
 */
class FixTracker {
	/**
	 * Create a new FixTracker.
	 * @param {RuleFixer} fixer A ruleFixer instance.
	 * @param {SourceCode} sourceCode A SourceCode object for the current code.
	 */
	constructor(fixer, sourceCode) {
		this.fixer = fixer;
		this.sourceCode = sourceCode;

		/**
		 * The retained range, or `null` before `retainRange` has been called.
		 * Annotated explicitly because inference from the `null` initializer
		 * alone would type it `null` and reject every later assignment.
		 * @type {SourceRange | null}
		 */
		this.retainedRange = null;
	}

	/**
	 * Mark the given range as "retained", meaning that other fixes may not
	 * may not modify this region in the same pass.
	 * @param {SourceRange} range The range to retain.
	 * @returns {FixTracker} The same FixTracker, for chained calls.
	 */
	retainRange(range) {
		this.retainedRange = range;
		return this;
	}

	/**
	 * Given a node, find the function containing it (or the entire program) and
	 * mark it as retained, meaning that other fixes may not modify it in this
	 * pass. This is useful for avoiding conflicts in fixes that modify control
	 * flow.
	 * @param {Node} node The node to use as a starting point.
	 * @returns {FixTracker} The same FixTracker, for chained calls.
	 */
	retainEnclosingFunction(node) {
		const functionNode = astUtils.getUpperFunction(node);

		return this.retainRange(
			functionNode ? functionNode.range : this.sourceCode.ast.range,
		);
	}

	/**
	 * Given a node or token, find the token before and afterward, and mark that
	 * range as retained, meaning that other fixes may not modify it in this
	 * pass. This is useful for avoiding conflicts in fixes that make a small
	 * change to the code where the AST should not be changed.
	 * @param {NodeOrToken} nodeOrToken The node or token to use as a starting
	 *      point. The token to the left and right are use in the range.
	 * @returns {FixTracker} The same FixTracker, for chained calls.
	 */
	retainSurroundingTokens(nodeOrToken) {
		const tokenBefore =
			this.sourceCode.getTokenBefore(nodeOrToken) || nodeOrToken;
		const tokenAfter =
			this.sourceCode.getTokenAfter(nodeOrToken) || nodeOrToken;

		return this.retainRange([tokenBefore.range[0], tokenAfter.range[1]]);
	}

	/**
	 * Create a fix command that replaces the given range with the given text,
	 * accounting for any retained ranges.
	 * @param {SourceRange} range The range to remove in the fix.
	 * @param {string} text The text to insert in place of the range.
	 * @returns {RuleFix} The fix command.
	 */
	replaceTextRange(range, text) {
		/**
		 * Annotated because the `[min, max]` literal below infers as `number[]`,
		 * which is not assignable to the `SourceRange` tuple `fixer` expects.
		 * @type {SourceRange}
		 */
		let actualRange;

		if (this.retainedRange) {
			actualRange = [
				Math.min(this.retainedRange[0], range[0]),
				Math.max(this.retainedRange[1], range[1]),
			];
		} else {
			actualRange = range;
		}

		return this.fixer.replaceTextRange(
			actualRange,
			this.sourceCode.text.slice(actualRange[0], range[0]) +
				text +
				this.sourceCode.text.slice(range[1], actualRange[1]),
		);
	}

	/**
	 * Create a fix command that removes the given node or token, accounting for
	 * any retained ranges.
	 * @param {NodeOrToken} nodeOrToken The node or token to remove.
	 * @returns {RuleFix} The fix command.
	 */
	remove(nodeOrToken) {
		return this.replaceTextRange(nodeOrToken.range, "");
	}
}

module.exports = FixTracker;

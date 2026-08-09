// @ts-check
/**
 * @fileoverview Helpers to debug for code path analysis.
 * @author Toru Nagashima
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const debug = require("debug")("eslint:code-path");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @import { ASTNode } from "../../types/core.js" */

/**
 * @typedef {InstanceType<typeof import("./code-path.js")>} CodePath
 * @typedef {InstanceType<typeof import("./code-path-segment.js")>} CodePathSegment
 * @typedef {InstanceType<typeof import("./code-path-state.js")>} CodePathState
 */

/**
 * A node, as this module sees one.
 *
 * ESCAPE HATCH. The AST vocabulary settled on by the phase-0 spike is a closed
 * union of ~89 node interfaces; `lib/types/core.d.ts` carries only its agreed
 * base (`ASTNode`, with `type`, `range`, `loc` and `parent`), and the union is
 * authored by a later bead. `Node` is that base intersected with the two
 * members this module reads, which is the same interim widening
 * `lib/rules/utils/ast-utils.js` documents at its own `Node` typedef.
 *
 * It is declared here rather than imported from `code-path-analyzer.js`
 * deliberately: this module is the leaf of the code-path-analysis subtree —
 * `code-path-segment.js` and `code-path-analyzer.js` both require it — so it
 * must not point back up at either of them, not even for a type.
 *
 * RETIREMENT: when the node union lands, delete `Node` and `NodeMembers` and
 * take `ASTNode` directly. `nodeToString` will then narrow on `node.type` and
 * both members below become reachable through the union instead.
 * @typedef {ASTNode & NodeMembers} Node
 */

/**
 * The per-node members this module reads. See `Node`.
 *
 * Both are declared non-optional for the reason `ast-utils.js` gives: an
 * interim view that cannot discriminate on `type` can only offer per-kind
 * members unconditionally or make every one of them `| undefined`, and the
 * second buys no safety — it just moves the assertion to every read. The
 * `switch` in `nodeToString` is what guarantees each one at runtime.
 * @typedef {Object} NodeMembers
 * @property {string} name The name of an `Identifier`.
 * @property {unknown} value A `Literal`'s value. `unknown` rather than the
 * literal-value union `ast-utils.js` uses, because callers reach this with
 * nodes whose `value` is another node (a `Property`'s, say) and all this
 * module does with it is interpolate it into a debug string.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Gets id of a given segment.
 * @param {CodePathSegment} segment A segment to get.
 * @returns {string} Id of the segment.
 */
/* c8 ignore next */
// eslint-disable-next-line jsdoc/require-jsdoc -- Ignoring
function getId(segment) {
	return segment.id + (segment.reachable ? "" : "!");
}

/**
 * Get string for the given node and operation.
 * @param {Node} node The node to convert.
 * @param {string} [label] The operation label.
 * @returns {string} The string representation.
 */
function nodeToString(node, label) {
	const suffix = label ? `:${label}` : "";

	switch (node.type) {
		case "Identifier":
			return `${node.type}${suffix} (${node.name})`;
		case "Literal":
			return `${node.type}${suffix} (${node.value})`;
		default:
			return `${node.type}${suffix}`;
	}
}

/**
 * Escape text for use in a DOT label.
 * @param {string} value The value to escape.
 * @returns {string} The escaped value.
 */
function escapeDotLabelText(value) {
	return value.replace(/\\/gu, String.raw`\\`).replace(/"/gu, String.raw`\"`);
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

module.exports = {
	/**
	 * A flag that debug dumping is enabled or not.
	 */
	enabled: debug.enabled,

	/**
	 * Dumps given objects.
	 * @param args objects to dump.
	 */
	dump: debug,

	/**
	 * Dumps the current analyzing state.
	 *
	 * The annotation is on the property rather than on the function expression
	 * because the value is a union: when debug dumping is off this is the
	 * `debug` logger itself, which accepts anything. Stating the signature here
	 * gives the callers one shape to call instead of a union of two.
	 * @type {(node: Node, state: CodePathState, leaving: boolean) => void}
	 * @param node A node to dump.
	 * @param state A state to dump.
	 * @param leaving A flag whether or not it's leaving
	 */
	dumpState: !debug.enabled
		? debug
		: /* c8 ignore next */ function (node, state, leaving) {
				for (let i = 0; i < state.currentSegments.length; ++i) {
					/*
					 * ESCAPE HATCH: `nodes` exists on a segment's hidden slot
					 * only while debug dumping is enabled, which is exactly
					 * the branch this function is. `code-path-segment.js`
					 * declares it optional because that is the truth for the
					 * other branch.
					 */
					const segInternal =
						/** @type {Required<CodePathSegment["internal"]>} */ (
							state.currentSegments[i].internal
						);

					if (leaving) {
						const last = segInternal.nodes.length - 1;

						if (
							last >= 0 &&
							segInternal.nodes[last] ===
								nodeToString(node, "enter")
						) {
							segInternal.nodes[last] = nodeToString(
								node,
								void 0,
							);
						} else {
							segInternal.nodes.push(nodeToString(node, "exit"));
						}
					} else {
						segInternal.nodes.push(nodeToString(node, "enter"));
					}
				}

				debug(
					[
						`${state.currentSegments.map(getId).join(",")})`,
						`${node.type}${leaving ? ":exit" : ""}`,
					].join(" "),
				);
			},

	/**
	 * Dumps a DOT code of a given code path.
	 * The DOT code can be visualized with Graphvis.
	 *
	 * See `dumpState` for why the signature is stated on the property. `this`
	 * is named explicitly because the annotation replaces the contextual type
	 * the object literal would otherwise supply, and the body calls
	 * `this.makeDotArrows`.
	 * @type {(this: { makeDotArrows: (codePath: CodePath, traceMap?: Record<string, CodePathSegment>) => string }, codePath: CodePath) => void}
	 * @param codePath A code path to dump.
	 * @see https://www.graphviz.org
	 * @see http://www.webgraphviz.com
	 */
	dumpDot: !debug.enabled
		? debug
		: /* c8 ignore next */ function (codePath) {
				let text =
					"\n" +
					"digraph {\n" +
					'node[shape=box,style="rounded,filled",fillcolor=white];\n' +
					'initial[label="",shape=circle,style=filled,fillcolor=black,width=0.25,height=0.25];\n';

				if (codePath.returnedSegments.length > 0) {
					text +=
						'final[label="",shape=doublecircle,style=filled,fillcolor=black,width=0.25,height=0.25];\n';
				}
				if (codePath.thrownSegments.length > 0) {
					text +=
						'thrown[label="✘",shape=circle,width=0.3,height=0.3,fixedsize=true];\n';
				}

				/** @type {Record<string, CodePathSegment>} */
				const traceMap = Object.create(null);
				const arrows = this.makeDotArrows(codePath, traceMap);

				// eslint-disable-next-line guard-for-in -- Want ability to traverse prototype
				for (const id in traceMap) {
					const segment = traceMap[id];

					text += `${id}[`;

					if (segment.reachable) {
						text += 'label="';
					} else {
						text +=
							'style="rounded,dashed,filled",fillcolor="#FF9800",label="<<unreachable>>\\n';
					}

					/*
					 * ESCAPE HATCH: same as `dumpState` — `nodes` is present
					 * on the hidden slot only while debug dumping is enabled,
					 * and this branch only runs then.
					 */
					const segNodes =
						/** @type {Required<CodePathSegment["internal"]>} */ (
							segment.internal
						).nodes;

					if (segNodes.length > 0) {
						text += segNodes.map(escapeDotLabelText).join("\\n");
					} else {
						text += "????";
					}

					text += '"];\n';
				}

				text += `${arrows}\n`;
				text += "}";
				debug("DOT", text);
			},

	/**
	 * Makes a DOT code of a given code path.
	 * The DOT code can be visualized with Graphvis.
	 * @param {CodePath} codePath A code path to make DOT.
	 * @param {Record<string, CodePathSegment>} [traceMap] Optional. A map to check whether or not segments had been done.
	 * @returns {string} A DOT code of the code path.
	 */
	makeDotArrows(codePath, traceMap) {
		/** @type {[CodePathSegment, number][]} */
		const stack = [[codePath.initialSegment, 0]];

		/** @type {Record<string, CodePathSegment>} */
		const done = traceMap || Object.create(null);

		/** @type {string | null} */
		let lastId = codePath.initialSegment.id;
		let text = `initial->${codePath.initialSegment.id}`;

		while (stack.length > 0) {
			// The loop condition is what guarantees the pop succeeds.
			const item = /** @type {[CodePathSegment, number]} */ (stack.pop());
			const segment = item[0];
			const index = item[1];

			if (done[segment.id] && index === 0) {
				continue;
			}
			done[segment.id] = segment;

			const nextSegment = segment.allNextSegments[index];

			if (!nextSegment) {
				continue;
			}

			if (lastId === segment.id) {
				text += `->${nextSegment.id}`;
			} else {
				text += `;\n${segment.id}->${nextSegment.id}`;
			}
			lastId = nextSegment.id;

			stack.unshift([segment, 1 + index]);
			stack.push([nextSegment, 0]);
		}

		codePath.returnedSegments.forEach(finalSegment => {
			if (lastId === finalSegment.id) {
				text += "->final";
			} else {
				text += `;\n${finalSegment.id}->final`;
			}
			lastId = null;
		});

		codePath.thrownSegments.forEach(finalSegment => {
			if (lastId === finalSegment.id) {
				text += "->thrown";
			} else {
				text += `;\n${finalSegment.id}->thrown`;
			}
			lastId = null;
		});

		return `${text};`;
	},
};

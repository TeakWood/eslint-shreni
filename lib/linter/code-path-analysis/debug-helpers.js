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

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/** @typedef {import("./code-path")} CodePath */
/** @typedef {import("./code-path-segment")} CodePathSegment */
/** @typedef {import("./code-path-segment").SegmentWithInternal} SegmentWithInternal */
/** @typedef {import("./code-path-state")} CodePathState */
/** @typedef {import("../../shared/traverser.js").TraversableNode} ASTNode */

/**
 * The segments a DOT dump has already drawn, keyed by segment id.
 * @typedef {Record<string, CodePathSegment>} SegmentTraceMap
 */

/**
 * The object `dumpDot()` is called as a method of, which is how it reaches its
 * sibling `makeDotArrows()`.
 *
 * Declaring `dumpDot`'s type below replaces the contextual `this` an object
 * literal would otherwise supply, so the `this` parameter has to be spelled
 * out, and this names the one member it uses.
 * @typedef {Object} DotArrowMaker
 * @property {(codePath: CodePath, traceMap?: SegmentTraceMap) => string} makeDotArrows Builds the arrows of a code path's DOT code.
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
 * @param {ASTNode} node The node to convert.
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
	 * @type {boolean}
	 */
	enabled: debug.enabled,

	/**
	 * Dumps given objects.
	 * @type {(...args: any[]) => void}
	 */
	dump: debug,

	/**
	 * Dumps the current analyzing state.
	 *
	 * The `@type` tag is what pins the signature callers see: the conditional
	 * below is typed as the union of `debug` and the dumping function, and
	 * only one of the two describes the arguments this is called with.
	 * @type {(node: ASTNode, state: CodePathState, leaving: boolean) => void}
	 */
	dumpState: !debug.enabled
		? debug
		: /* c8 ignore next */ function (node, state, leaving) {
				for (let i = 0; i < state.currentSegments.length; ++i) {
					const segInternal = /** @type {SegmentWithInternal} */ (
						state.currentSegments[i]
					).internal;

					/*
					 * `nodes` is created only when debug dumping is enabled,
					 * which is the only way this branch runs at all.
					 */
					const nodes = /** @type {string[]} */ (segInternal.nodes);

					if (leaving) {
						const last = nodes.length - 1;

						if (
							last >= 0 &&
							nodes[last] === nodeToString(node, "enter")
						) {
							nodes[last] = nodeToString(node, void 0);
						} else {
							nodes.push(nodeToString(node, "exit"));
						}
					} else {
						nodes.push(nodeToString(node, "enter"));
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
	 * Typed with `@type` for the same reason as `dumpState` above.
	 * @type {(this: DotArrowMaker, codePath: CodePath) => void}
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

				/** @type {SegmentTraceMap} */
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

					// As in `dumpState()`: `nodes` exists whenever this runs.
					const nodes = /** @type {string[]} */ (
						/** @type {SegmentWithInternal} */ (segment).internal
							.nodes
					);

					if (nodes.length > 0) {
						text += nodes.map(escapeDotLabelText).join("\\n");
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
	 * @param {SegmentTraceMap} [traceMap] Optional. A map to check whether or not segments had been done.
	 * @returns {string} A DOT code of the code path.
	 */
	makeDotArrows(codePath, traceMap) {
		/** @type {[CodePathSegment, number][]} */
		const stack = [[codePath.initialSegment, 0]];

		/** @type {SegmentTraceMap} */
		const done = traceMap || Object.create(null);

		/** @type {string | null} */
		let lastId = codePath.initialSegment.id;
		let text = `initial->${codePath.initialSegment.id}`;

		while (stack.length > 0) {
			// The loop condition is what makes this non-nullable.
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

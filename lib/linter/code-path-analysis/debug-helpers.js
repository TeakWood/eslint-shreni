/**
 * @fileoverview Helpers to debug for code path analysis.
 * @author Toru Nagashima
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const debug = require("debug")("eslint:code-path");

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/**
 * The loose node shape the linter hands around. This is the same vocabulary the
 * rules layer sees, so it is reused here rather than duplicated; the reference
 * is type-only and adds no runtime dependency.
 * @typedef {import("../../rules/utils/ast-utils.js").ASTNode} ASTNode
 */
/** @typedef {import("./code-path.js")} CodePath */
/** @typedef {import("./code-path-segment.js")} CodePathSegment */
/** @typedef {import("./code-path-state.js")} CodePathState */

/**
 * The part of this module that `dumpDot` calls back into through `this`.
 * @typedef {Object} DebugHelpers
 * @property {(codePath: CodePath, traceMap?: Record<string, CodePathSegment>) => string} makeDotArrows Makes a DOT code of a given code path.
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
	 * @type {(...args: Array<any>) => void}
	 */
	dump: debug,

	/**
	 * Dumps the current analyzing state.
	 *
	 * When debug dumping is disabled this is the no-op `debug` function itself,
	 * which accepts (and discards) any arguments.
	 * @type {(node: ASTNode, state: CodePathState, leaving: boolean) => void}
	 */
	dumpState: !debug.enabled
		? debug
		: /* c8 ignore next */ function (node, state, leaving) {
				for (let i = 0; i < state.currentSegments.length; ++i) {
					/*
					 * `internal.nodes` is populated by the `CodePathSegment`
					 * constructor whenever debug dumping is enabled, which is
					 * the only way this branch is reached.
					 */
					const segNodes = /** @type {Array<string>} */ (
						state.currentSegments[i].internal.nodes
					);

					if (leaving) {
						const last = segNodes.length - 1;

						if (
							last >= 0 &&
							segNodes[last] === nodeToString(node, "enter")
						) {
							segNodes[last] = nodeToString(node, void 0);
						} else {
							segNodes.push(nodeToString(node, "exit"));
						}
					} else {
						segNodes.push(nodeToString(node, "enter"));
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
	 * When debug dumping is disabled this is the no-op `debug` function itself,
	 * which accepts (and discards) any arguments.
	 * @type {(this: DebugHelpers, codePath: CodePath) => void}
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
					 * `internal.nodes` is populated by the `CodePathSegment`
					 * constructor whenever debug dumping is enabled, which is
					 * the only way this branch is reached.
					 */
					const segNodes = /** @type {Array<string>} */ (
						segment.internal.nodes
					);

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
		/** @type {Array<[CodePathSegment, number]>} */
		const stack = [[codePath.initialSegment, 0]];

		/** @type {Record<string, CodePathSegment>} */
		const done = traceMap || Object.create(null);

		/** @type {string | null} */
		let lastId = codePath.initialSegment.id;
		let text = `initial->${codePath.initialSegment.id}`;

		while (stack.length > 0) {
			// The loop condition guarantees there is an item to pop.
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

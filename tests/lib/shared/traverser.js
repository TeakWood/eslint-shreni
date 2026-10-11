"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("chai").assert;
const Traverser = require("../../../lib/shared/traverser");
const {
	formatDiagnostics,
	typeCheckProbe,
} = require("../../_utils/type-probe");

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("Traverser", () => {
	it("traverses all keys except 'parent', 'leadingComments', and 'trailingComments'", () => {
		const traverser = new Traverser();
		const fakeAst = {
			type: "Program",
			body: [
				{
					type: "ExpressionStatement",
					leadingComments: {
						type: "Line",
					},
					trailingComments: {
						type: "Block",
					},
				},
				{
					type: "FooStatement",
					foo: {
						type: "BarStatement",
					},
				},
			],
		};

		fakeAst.body[0].parent = fakeAst;

		const enteredNodes = [];
		const exitedNodes = [];

		traverser.traverse(fakeAst, {
			enter: node => enteredNodes.push(node),
			leave: node => exitedNodes.push(node),
		});

		assert.deepStrictEqual(enteredNodes, [
			fakeAst,
			fakeAst.body[0],
			fakeAst.body[1],
			fakeAst.body[1].foo,
		]);
		assert.deepStrictEqual(exitedNodes, [
			fakeAst.body[0],
			fakeAst.body[1].foo,
			fakeAst.body[1],
			fakeAst,
		]);
	});

	it("traverses AST as using 'visitorKeys' option if given", () => {
		const traverser = new Traverser();
		const fakeAst = {
			type: "Program",
			body: [
				{
					type: "ClassDeclaration",
					id: {
						type: "Identifier",
					},
					superClass: null,
					body: {
						type: "ClassBody",
						body: [],
					},
					experimentalDecorators: [
						{
							type: "Decorator",
							expression: {},
						},
					],
				},
			],
		};

		fakeAst.body[0].parent = fakeAst;

		const visited = [];

		// with 'visitorKeys' option to traverse decorators.
		traverser.traverse(fakeAst, {
			enter: node => visited.push(node.type),
			visitorKeys: Object.assign({}, Traverser.DEFAULT_VISITOR_KEYS, {
				ClassDeclaration:
					Traverser.DEFAULT_VISITOR_KEYS.ClassDeclaration.concat([
						"experimentalDecorators",
					]),
			}),
		});
		assert.deepStrictEqual(visited, [
			"Program",
			"ClassDeclaration",
			"Identifier",
			"ClassBody",
			"Decorator",
		]);
	});
});

describe("Traverser declarations", () => {
	it("should expose `getKeys()` to other modules", () => {
		/*
		 * `getKeys()` is internal to ESLint but is used across modules, so it
		 * cannot carry a `@private` tag: tsc turns the tag into a real
		 * `private` modifier in the emitted `traverser.d.ts`, and the call
		 * below then fails with TS2341. This probe mirrors that call site.
		 */
		const diagnostics = typeCheckProbe(
			[
				'"use strict";',
				'const Traverser = require("./traverser.js");',
				"",
				"module.exports = { fallback: Traverser.getKeys };",
			].join("\n"),
			"lib/shared/__visibility-probe__.js",
		);

		assert.strictEqual(
			diagnostics.length,
			0,
			`\`Traverser.getKeys\` should be reachable from \`lib/linter/linter.js\`:\n${formatDiagnostics(diagnostics)}`,
		);
	});
});

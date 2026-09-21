/**
 * @fileoverview Wrapper around tsc that exits 0 when the only TypeScript error
 * is TS18003 ("No inputs were found"). This allows lint:types and build:types
 * to pass while tsconfig.json's include array is empty during the staged
 * JSDoc-annotation rollout.
 *
 * Usage:
 *   node tools/lint-types.js             # runs: tsc --noEmit
 *   node tools/lint-types.js --emit      # runs: tsc  (emits declaration files)
 */

"use strict";

const { spawnSync } = require("node:child_process");

const emitMode = process.argv.includes("--emit");
const tscArgs = emitMode ? [] : ["--noEmit"];

/*
 * Resolve tsc through the module graph rather than relying on `tsc` being on
 * PATH. PATH only contains node_modules/.bin when invoked through an npm
 * script, and on Windows a bare `tsc` never resolves to `tsc.cmd` without a
 * shell — in both cases spawning by name fails and the gate would silently
 * pass without ever type-checking anything.
 */
const result = spawnSync(
	process.execPath,
	[require.resolve("typescript/bin/tsc"), ...tscArgs],
	{
		encoding: "utf8",
		stdio: "pipe",
		shell: false,
	},
);

if (result.error) {
	process.stderr.write(`Failed to run tsc: ${result.error.message}\n`);
	process.exit(1);
}

if (result.status === 0) {
	process.exit(0);
}

const output = (result.stdout ?? "") + (result.stderr ?? "");

// TS18003 = "No inputs were found" — expected while include is empty
const realErrors = output
	.split("\n")
	.filter(line => /error TS(?!18003\b)/u.test(line));

if (realErrors.length === 0) {
	process.exit(0);
}

process.stderr.write(output);
process.exit(1);

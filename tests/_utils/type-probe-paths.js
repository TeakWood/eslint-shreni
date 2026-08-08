/**
 * @fileoverview Path helpers shared by the type-probe suites in
 * `tests/lib/types/`.
 *
 * Those suites all follow the same pattern: build an in-memory
 * `ts.CompilerHost` whose `getSourceFile`/`fileExists`/`readFile` overrides
 * serve synthetic probe sources out of a `Map`, then compile them against the
 * real `node_modules/`. The map is keyed by absolute path, and that key is the
 * one place the pattern is easy to get wrong.
 *
 * TypeScript runs `normalizePath` over every root name and asks the host for
 * FORWARD-slash paths, on every platform. A key built with `path.join` alone is
 * therefore correct on POSIX and wrong on Windows, where it comes out as
 * `D:\a\repo\lib\probe.ts` and `contents.has(fileName)` never matches. The
 * override falls through to the real filesystem, the file is not there, and the
 * probe is dropped from the program without a word.
 *
 * That silence is the dangerous part. A dropped probe produces zero
 * diagnostics, so a `expectError`-style test — one that asserts a probe must
 * NOT compile — sees an empty diagnostic array and reports the opposite of the
 * truth, and `program.getSourceFile(...)` returns `undefined`, which crashes
 * inside the type checker when it is handed to `getSymbolAtLocation`.
 *
 * So: build every host key with `probePath()`, and run `assertProbesLoaded()`
 * after `ts.createProgram` so a key that is wrong again fails loudly instead of
 * inverting an assertion.
 * @author Silpi
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const path = require("node:path");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Builds an absolute path in the form a TypeScript compiler host is keyed on.
 *
 * Use this for probe file names, for `.d.ts` root names passed to
 * `ts.createProgram`, and for anything later handed to
 * `program.getSourceFile()` — so a suite has one path convention rather than
 * two that differ by accident.
 * @param {...string} segments Path segments, as `path.join` takes them.
 * @returns {string} The joined path, with every separator forward-slashed.
 */
function probePath(...segments) {
	return path.join(...segments).replaceAll(path.sep, "/");
}

/**
 * Asserts that every probe root actually made it into the program.
 *
 * This is the tripwire for the failure above: a probe served from memory but
 * keyed on a path the compiler never asks for is silently absent, and every
 * assertion downstream of it becomes vacuous. Throwing here turns that into a
 * visible failure on the platform where the key is wrong.
 * @param {import("typescript").Program} program The compiled program.
 * @param {Iterable<string>} fileNames The probe paths that were passed as roots.
 * @returns {void}
 * @throws {Error} If any probe is missing from the program.
 */
function assertProbesLoaded(program, fileNames) {
	for (const fileName of fileNames) {
		if (!program.getSourceFile(fileName)) {
			throw new Error(
				`The probe "${fileName}" is not in the compiled program, so every assertion about it would be vacuous. Compiler host keys must be forward-slash normalized with probePath(): TypeScript normalizes the paths it asks the host for.`,
			);
		}
	}
}

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

module.exports = {
	probePath,
	assertProbesLoaded,
};

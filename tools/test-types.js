/**
 * @fileoverview Type-checks the consumer probe in `tests/types/` under every
 * TypeScript major this package supports.
 *
 * The probe imports through the four public entry point specifiers and
 * exercises the API a consumer actually touches, so a regression in the
 * emitted declarations shows up here rather than in a downstream project.
 *
 * Usage:
 *   node tools/test-types.js
 *
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..");
const PROBE_DIR = path.join(REPO_ROOT, "tests", "types");
const PROBE_TSCONFIG = path.join(PROBE_DIR, "tsconfig.json");

/*
 * Each supported TypeScript major is installed under its own package name, so
 * that both can be resolved from one `node_modules` tree. `package` is the
 * name to resolve `bin/tsc` through; `major` is the major version that copy
 * is required to report, which keeps a mis-specified alias from silently
 * running the same compiler twice.
 */
const COMPILERS = [
	{ package: "typescript-5", major: 5 },
	{ package: "typescript", major: 6 },
];

/**
 * Reads the compiler options of the probe's tsconfig.json.
 *
 * The file is JSON with comments, which `require()` cannot parse, so the
 * comments are stripped first. Only block comments appear in it, and no
 * string value in it can contain the closing delimiter.
 * @returns {Object} The parsed tsconfig.json contents.
 */
function readProbeTsconfig() {
	const text = fs.readFileSync(PROBE_TSCONFIG, "utf8");

	return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//gu, ""));
}

/**
 * Asserts that every declaration file the probe's `paths` mapping points at
 * exists.
 *
 * Without this, a missing `dist/types` would make TypeScript fall back to
 * ordinary node resolution, which finds this package through its own
 * `file:.` devDependency — possibly a stale copy left by an earlier build.
 * The probe would then type-check successfully against declarations that are
 * not the ones this repository just emitted.
 * @returns {Array<string>} The absolute paths that are missing, if any.
 */
function findMissingDeclarations() {
	const { paths = {} } = readProbeTsconfig().compilerOptions;

	return Object.values(paths)
		.flat()
		.map(target => path.resolve(PROBE_DIR, target))
		.filter(target => !fs.existsSync(target));
}

/**
 * Runs one TypeScript compiler over the probe project.
 * @param {{package: string, major: number}} compiler The compiler to run.
 * @returns {boolean} `true` when the probe type-checks cleanly.
 */
function checkWith(compiler) {
	let tsc;

	try {
		tsc = require.resolve(`${compiler.package}/bin/tsc`);
	} catch {
		process.stderr.write(
			`Cannot resolve "${compiler.package}/bin/tsc". Install dependencies first.\n`,
		);
		return false;
	}

	const { version } = require(`${compiler.package}/package.json`);

	if (Number(version.split(".")[0]) !== compiler.major) {
		process.stderr.write(
			`"${compiler.package}" resolves to TypeScript ${version}, expected ${compiler.major}.x.\n`,
		);
		return false;
	}

	process.stdout.write(
		`Type-checking tests/types with TypeScript ${version}\n`,
	);

	const result = spawnSync(
		process.execPath,
		[tsc, "--noEmit", "--project", PROBE_TSCONFIG],
		{
			cwd: REPO_ROOT,
			encoding: "utf8",
			stdio: "inherit",
			shell: false,
		},
	);

	if (result.error) {
		process.stderr.write(`Failed to run tsc: ${result.error.message}\n`);
		return false;
	}

	return result.status === 0;
}

//------------------------------------------------------------------------------
// Execution
//------------------------------------------------------------------------------

const missing = findMissingDeclarations();

if (missing.length > 0) {
	process.stderr.write(
		`Missing emitted declarations:\n${missing
			.map(target => `  ${path.relative(REPO_ROOT, target)}\n`)
			.join("")}Run "npm run build:types" first.\n`,
	);
	process.exit(1);
}

const failed = COMPILERS.filter(compiler => !checkWith(compiler));

if (failed.length > 0) {
	process.stderr.write(
		`Type check failed for: ${failed.map(compiler => compiler.package).join(", ")}\n`,
	);
	process.exit(1);
}

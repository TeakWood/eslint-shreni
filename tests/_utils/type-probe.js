/**
 * @fileoverview Helpers for type-level tests.
 *
 * These let a test assert what `tsc` makes of a snippet, using the project's
 * real `tsconfig.json` rather than a hand-rolled set of options. The snippet is
 * served from memory, so a deliberately-broken probe never reaches the linted
 * and formatted source tree.
 * @author Navakanth Gandavarapu
 */

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const path = require("node:path"),
	ts = require("typescript");

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TSCONFIG_PATH = path.join(PROJECT_ROOT, "tsconfig.json");

/*
 * The project sets `checkJs: false` and opts each annotated source into
 * checking with this pragma, so a probe has to carry it too or it is parsed and
 * never checked — which would make every negative probe pass vacuously.
 */
const CHECK_PRAGMA = "// @ts-check";

/**
 * Rewrites a path to forward slashes.
 *
 * TypeScript always reports paths with forward slashes, while `path.join()`
 * uses a backslash on Windows. Normalizing both sides keeps assertions from
 * passing on POSIX and failing on Windows.
 * @param {string} filePath The path to normalize.
 * @returns {string} The path with every separator as a forward slash.
 */
function toPosix(filePath) {
	return filePath.split(path.sep).join("/");
}

/**
 * Reads and resolves the root `tsconfig.json` the way `tsc` does.
 * @returns {{ raw: any, parsed: ts.ParsedCommandLine, readError: ts.Diagnostic | undefined }}
 * The raw config object, the resolved command line, and the error from reading
 * the file, if any.
 */
function parseProjectConfig() {
	const { config, error } = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);

	return {
		raw: config,
		parsed: ts.parseJsonConfigFileContent(
			config,
			ts.sys,
			PROJECT_ROOT,
			void 0,
			TSCONFIG_PATH,
		),
		readError: error,
	};
}

/**
 * Formats diagnostics as a single readable string for assertion messages.
 * @param {readonly ts.Diagnostic[]} diagnostics The diagnostics to format.
 * @returns {string} One message per line.
 */
function formatDiagnostics(diagnostics) {
	return diagnostics
		.map(
			diagnostic =>
				`TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
		)
		.join("\n");
}

/**
 * Type-checks a snippet as if it were a module at `probePath`, so that it can
 * reach the modules under test through the same relative paths the real sources
 * use.
 * The snippet is opted into checking automatically, so callers write it exactly
 * as they would write a source module.
 * @param {string} code The snippet to type-check.
 * @param {string} probePath The snippet's location, relative to the project
 * root. It must not name an existing file.
 * @returns {readonly ts.Diagnostic[]} The diagnostics reported for the snippet
 * itself, ignoring any reported for the real sources it pulls in.
 */
function typeCheckProbe(code, probePath) {
	const absoluteProbePath = path.join(PROJECT_ROOT, probePath);
	const options = { ...parseProjectConfig().parsed.options, noEmit: true };
	const source = code.startsWith(CHECK_PRAGMA)
		? code
		: `${CHECK_PRAGMA}\n${code}`;

	/**
	 * Checks whether a path is the probe's.
	 * @param {string} fileName The path to check.
	 * @returns {boolean} `true` when it refers to the probe.
	 */
	function isProbe(fileName) {
		return toPosix(fileName) === toPosix(absoluteProbePath);
	}

	const host = ts.createCompilerHost(options, true);
	const { getSourceFile, fileExists, readFile } = host;

	host.getSourceFile = (fileName, languageVersion, ...rest) =>
		isProbe(fileName)
			? ts.createSourceFile(fileName, source, languageVersion, true)
			: getSourceFile.call(host, fileName, languageVersion, ...rest);
	host.fileExists = fileName =>
		isProbe(fileName) || fileExists.call(host, fileName);
	host.readFile = fileName =>
		isProbe(fileName) ? source : readFile.call(host, fileName);

	const program = ts.createProgram([absoluteProbePath], options, host);

	return ts
		.getPreEmitDiagnostics(program)
		.filter(
			diagnostic => diagnostic.file && isProbe(diagnostic.file.fileName),
		);
}

//-----------------------------------------------------------------------------
// Public Interface
//-----------------------------------------------------------------------------

module.exports = {
	CHECK_PRAGMA,
	PROJECT_ROOT,
	TSCONFIG_PATH,
	formatDiagnostics,
	parseProjectConfig,
	toPosix,
	typeCheckProbe,
};

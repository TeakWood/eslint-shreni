/**
 * @fileoverview Tests for the consumer type probe in `tests/types/` and the
 * runner that type-checks it under every supported TypeScript major.
 * @author Navakanth Gandavarapu
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "../..");
const TEST_TYPES = path.join(REPO_ROOT, "tools", "test-types.js");
const PROBE_DIR = path.join(REPO_ROOT, "tests", "types");
const PROBE_SOURCE = path.join(PROBE_DIR, "index.ts");
const PROBE_TSCONFIG_PATH = path.join(PROBE_DIR, "tsconfig.json");
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");

const PACKAGE_JSON = require(path.join(REPO_ROOT, "package.json"));
const TSCONFIG_JSON = require(path.join(REPO_ROOT, "tsconfig.json"));

/**
 * The four subpaths of the `exports` map that carry a `types` condition.
 * `./package.json` is excluded deliberately: it is a file, not an entry
 * point, and has no declarations.
 * @type {Array<string>}
 */
const PUBLIC_SUBPATHS = [
	".",
	"./config",
	"./universal",
	"./use-at-your-own-risk",
];

/**
 * Maps an `exports` subpath onto the specifier a consumer writes for it.
 * @param {string} subpath The `exports` map key.
 * @returns {string} The bare module specifier.
 */
function specifierFor(subpath) {
	return subpath === "." ? "eslint" : `eslint/${subpath.slice("./".length)}`;
}

/**
 * Reads the probe's tsconfig.json.
 *
 * It is JSON with comments, which `require()` cannot parse, so block comments
 * are stripped first. Only block comments appear in it, and no string value in
 * it contains the closing delimiter.
 * @returns {Object} The parsed contents.
 */
function readProbeTsconfig() {
	const text = fs.readFileSync(PROBE_TSCONFIG_PATH, "utf8");

	return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//gu, ""));
}

/**
 * Extracts one top-level job from the CI workflow.
 *
 * The workflow is read as text rather than parsed, because this repository
 * ships no YAML parser as a declared dependency and relying on an undeclared
 * transitive one is how a gate ends up passing only on one machine. Jobs are
 * indented four spaces and their bodies more than that, which is enough to
 * slice one out unambiguously.
 * @param {string} name The job key.
 * @returns {string} The job's block, including its key line.
 */
function ciJob(name) {
	const lines = fs.readFileSync(CI_WORKFLOW_PATH, "utf8").split("\n");
	const start = lines.indexOf(`    ${name}:`);

	assert.notStrictEqual(
		start,
		-1,
		`ci.yml has no top-level job named "${name}".`,
	);

	let end = start + 1;

	while (
		end < lines.length &&
		(lines[end].trim() === "" || lines[end].startsWith("     "))
	) {
		end += 1;
	}

	return lines.slice(start, end).join("\n");
}

let tmpDir;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("test-types", function () {
	// Emitting declarations and running two compilers over them is not quick.
	this.timeout(120000); // eslint-disable-line no-invalid-this -- Mocha context.

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eslint-test-types-"));
	});

	after(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("npm script wiring", () => {
		it("builds the declarations before type-checking them", () => {
			assert.strictEqual(
				PACKAGE_JSON.scripts["test:types"],
				"node tools/lint-types.js --emit && node tools/test-types.js",
			);
		});
	});

	describe("the probe's paths mapping", () => {
		/*
		 * The probe imports bare specifiers, but resolving them from inside
		 * this repository goes through the self-referential `file:.`
		 * devDependency, which npm materializes as a symlink and pnpm as a
		 * copy. `paths` pins the probe to the declarations this repository
		 * just emitted under either one. That duplicates the `exports` map,
		 * so this test is the thing keeping the two in step.
		 */
		it("names exactly the four public entry points", () => {
			assert.deepStrictEqual(
				Object.keys(readProbeTsconfig().compilerOptions.paths).sort(),
				PUBLIC_SUBPATHS.map(specifierFor).sort(),
			);
		});

		it("points each specifier at that entry point's types condition", () => {
			const { paths } = readProbeTsconfig().compilerOptions;

			for (const subpath of PUBLIC_SUBPATHS) {
				const declared = PACKAGE_JSON.exports[subpath].types;

				assert.ok(
					declared,
					`package.json exports["${subpath}"] has no types condition.`,
				);

				/*
				 * `paths` targets are relative to the probe's tsconfig.json,
				 * the `exports` target to the package root. Resolving both
				 * compares the files rather than the spellings.
				 */
				assert.strictEqual(
					path.resolve(PROBE_DIR, paths[specifierFor(subpath)][0]),
					path.resolve(REPO_ROOT, declared),
					`The probe and package.json disagree about "${subpath}".`,
				);
			}
		});
	});

	describe("the probe source", () => {
		const source = fs.readFileSync(PROBE_SOURCE, "utf8");

		it("imports from every public entry point", () => {
			for (const subpath of PUBLIC_SUBPATHS) {
				assert.match(
					source,
					new RegExp(`from "${specifierFor(subpath)}";`, "u"),
					`The probe never imports from "${specifierFor(subpath)}".`,
				);
			}
		});

		it("exercises the APIs a consumer reaches for", () => {
			for (const usage of [
				"new ESLint(",
				".lintText(",
				".lintFiles(",
				"new RuleTester(",
				"new Linter(",
				"sourceCode: SourceCode",
			]) {
				assert.ok(
					source.includes(usage),
					`The probe never exercises \`${usage}\`.`,
				);
			}
		});
	});

	describe("the repository's own tsconfig.json", () => {
		/*
		 * Without this mapping, `@eslint-community/eslint-utils` resolves its
		 * `eslint` import through this package's own `exports` map and lands
		 * on `dist/types`. The program then holds two nominally distinct
		 * copies of every class it is compiling, and `lint:types` starts
		 * failing -- but only once `build:types` has run, so it reads as a
		 * flake rather than as the ordering dependency it is.
		 */
		it("maps the eslint specifier onto the source entry point", () => {
			assert.deepStrictEqual(TSCONFIG_JSON.compilerOptions.paths, {
				eslint: ["./lib/api.js"],
			});
		});

		it("type-checks the same whether or not declarations exist", async () => {
			const lintTypes = path.join(REPO_ROOT, "tools", "lint-types.js");

			// Emitting first is what used to break the run that follows it.
			await execFileAsync(process.execPath, [lintTypes, "--emit"], {
				cwd: REPO_ROOT,
			});

			const { stdout, stderr } = await execFileAsync(
				process.execPath,
				[lintTypes],
				{ cwd: REPO_ROOT },
			);

			assert.strictEqual(stdout, "");
			assert.strictEqual(stderr, "");
		});
	});

	describe("the runner", () => {
		it("type-checks the probe under every supported TypeScript major", async () => {
			const { stdout } = await execFileAsync(
				process.execPath,
				[TEST_TYPES],
				{ cwd: REPO_ROOT },
			);

			/*
			 * Asserting on the majors rather than a count is what makes this
			 * fail loudly if the two aliases were ever pointed at one copy of
			 * TypeScript, which would leave the run green while checking
			 * nothing new.
			 */
			assert.match(stdout, /TypeScript 5\./u);
			assert.match(stdout, /TypeScript 6\./u);
		});

		it("fails when a declaration the probe imports is missing", async () => {
			const projectDir = path.join(tmpDir, "missing-declarations");

			fs.mkdirSync(path.join(projectDir, "tests", "types"), {
				recursive: true,
			});
			fs.mkdirSync(path.join(projectDir, "tools"), { recursive: true });
			fs.copyFileSync(
				TEST_TYPES,
				path.join(projectDir, "tools", "test-types.js"),
			);
			fs.writeFileSync(
				path.join(projectDir, "tests", "types", "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						paths: { eslint: ["../../dist/types/lib/api.d.ts"] },
					},
				}),
			);

			await assert.rejects(
				execFileAsync(
					process.execPath,
					[path.join(projectDir, "tools", "test-types.js")],
					{ cwd: projectDir },
				),
				error => {
					assert.strictEqual(error.code, 1);
					assert.match(
						error.stderr,
						/Missing emitted declarations:/u,
					);
					assert.match(error.stderr, /dist\/types\/lib\/api\.d\.ts/u);
					return true;
				},
			);
		});
	});

	describe("the CI workflow", () => {
		it("runs the source type check", () => {
			assert.match(ciJob("typecheck"), /run: npm run lint:types$/mu);
		});

		it("runs the published-types check", () => {
			assert.match(ciJob("typecheck"), /run: npm run test:types$/mu);
		});
	});
});

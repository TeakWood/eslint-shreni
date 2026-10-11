/**
 * @fileoverview Ambient declarations for `@humanwhocodes/module-importer`.
 *
 * The package ships `dist/module-importer.d.ts`, but its `exports` map has only
 * `require` and `import` conditions and no `types` condition, so under
 * `"moduleResolution": "node16"` TypeScript resolves the runtime
 * `src/module-importer.cjs` and finds no types alongside it (TS7016). The
 * bundled declaration file is unusable anyway: it re-exports from the `.cjs`
 * entry, which has no declarations of its own.
 *
 * Written against @humanwhocodes/module-importer@1.0.1.
 */

declare module "@humanwhocodes/module-importer" {
	/**
	 * Imports both CommonJS and ESM modules in Node.js.
	 */
	export class ModuleImporter {
		/**
		 * The base directory from which paths are resolved, with a trailing slash.
		 */
		cwd: string;

		/**
		 * @param cwd The current working directory to resolve from. Defaults to `process.cwd()`.
		 */
		constructor(cwd?: string);

		/**
		 * Resolves a module based on its name or location.
		 * @param specifier Either an npm package name or a relative file path.
		 * @returns The location of the import.
		 */
		resolve(specifier: string): string | undefined;

		/**
		 * Imports a module based on its name or location.
		 * @param specifier Either an npm package name or a relative file path.
		 * @returns The module's exports.
		 */
		import(specifier: string): Promise<Record<string, any>>;
	}
}

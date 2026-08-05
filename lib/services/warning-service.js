/**
 * @fileoverview Emits warnings for ESLint.
 * @author Francesco Trotta
 */

"use strict";

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * A service that emits warnings for ESLint.
 */
class WarningService {
	/**
	 * Creates a new instance of the service.
	 * @param [options] A function called internally to emit warnings using API provided by the runtime.
	 */
	constructor({
		emitWarning = globalThis.process?.emitWarning ?? (() => {}),
	} = {}) {
		this.emitWarning = emitWarning;
	}

	/**
	 * Emits a warning when circular fixes are detected while fixing a file.
	 * This method is used by the Linter and is safe to call outside Node.js.
	 * @param filename The name of the file being fixed.
	 */
	emitCircularFixesWarning(filename) {
		this.emitWarning(
			`Circular fixes detected while fixing ${filename}. It is likely that you have conflicting rules in your configuration.`,
			"ESLintCircularFixesWarning",
		);
	}

	/**
	 * Emits a warning when an empty config file has been loaded.
	 * @param configFilePath The path to the config file.
	 */
	emitEmptyConfigWarning(configFilePath) {
		this.emitWarning(
			`Running ESLint with an empty config (from ${configFilePath}). Please double-check that this is what you want. If you want to run ESLint with an empty config, export [{}] to remove this warning.`,
			"ESLintEmptyConfigWarning",
		);
	}

	/**
	 * Emits a warning when an ".eslintignore" file is found.
	 */
	emitESLintIgnoreWarning() {
		this.emitWarning(
			'The ".eslintignore" file is no longer supported. Switch to using the "ignores" property in "eslint.config.js": https://eslint.org/docs/latest/use/configure/migration-guide#ignore-files',
			"ESLintIgnoreWarning",
		);
	}

	/**
	 * Emits a warning when an inactive flag is used.
	 * This method is used by the Linter and is safe to call outside Node.js.
	 * @param flag The name of the flag.
	 * @param message The warning message.
	 */
	emitInactiveFlagWarning(flag, message) {
		this.emitWarning(message, `ESLintInactiveFlag_${flag}`);
	}

	/**
	 * Emits a warning when a suboptimal concurrency setting is detected.
	 * Currently, this is only used to warn when the net linting ratio is low.
	 * @param notice A notice about how to improve performance.
	 */
	emitPoorConcurrencyWarning(notice) {
		this.emitWarning(
			`You may ${notice} to improve performance.`,
			"ESLintPoorConcurrencyWarning",
		);
	}
}

module.exports = { WarningService };

/**
 * @fileoverview The FileContext class.
 * @author Nicholas C. Zakas
 */

"use strict";

/**
 * Represents a file context that the linter can use to lint a file.
 */
class FileContext {
	/**
	 * The current working directory.
	 */
	cwd;

	/**
	 * The filename of the file being linted.
	 */
	filename;

	/**
	 * The physical filename of the file being linted.
	 */
	physicalFilename;

	/**
	 * The source code of the file being linted.
	 */
	sourceCode;

	/**
	 * The language options used when parsing this file.
	 */
	languageOptions;

	/**
	 * The settings for the file being linted.
	 */
	settings;

	/**
	 * Creates a new instance.
	 * @param config The configuration object for the file context.
	 * @param config.cwd The current working directory.
	 * @param config.filename The filename of the file being linted.
	 * @param config.physicalFilename The physical filename of the file being linted.
	 * @param config.sourceCode The source code of the file being linted.
	 * @param config.languageOptions The language options used when parsing this file.
	 * @param config.settings The settings for the file being linted.
	 */
	constructor({
		cwd,
		filename,
		physicalFilename,
		sourceCode,
		languageOptions,
		settings,
	}) {
		this.cwd = cwd;
		this.filename = filename;
		this.physicalFilename = physicalFilename;
		this.sourceCode = sourceCode;
		this.languageOptions = languageOptions;
		this.settings = settings;

		Object.freeze(this);
	}

	/**
	 * Creates a new object with the current object as the prototype and
	 * the specified properties as its own properties.
	 * @param extension The properties to add to the new object.
	 * @returns A new object with the current object as the prototype
	 * and the specified properties as its own properties.
	 */
	extend(extension) {
		return Object.freeze(Object.assign(Object.create(this), extension));
	}
}

exports.FileContext = FileContext;

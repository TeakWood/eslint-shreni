/**
 * @fileoverview The FileContext class.
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/**
 * The parsed representation of a file. ESLint supports arbitrary languages, so
 * the linter only relies on the `Language` plugin to hand back something it
 * passes straight through to the rules.
 * @typedef {Record<string, unknown>} AnySourceCode
 */

/**
 * The resolved `languageOptions` for the file. The shape is owned by whichever
 * language parsed the file, so it is opaque here.
 * @typedef {Record<string, unknown>} AnyLanguageOptions
 */

/**
 * Represents a file context that the linter can use to lint a file.
 */
class FileContext {
	/**
	 * The current working directory.
	 * @type {string}
	 */
	cwd;

	/**
	 * The filename of the file being linted.
	 * @type {string}
	 */
	filename;

	/**
	 * The physical filename of the file being linted.
	 * @type {string}
	 */
	physicalFilename;

	/**
	 * The source code of the file being linted.
	 * @type {AnySourceCode}
	 */
	sourceCode;

	/**
	 * The language options used when parsing this file.
	 * @type {AnyLanguageOptions}
	 */
	languageOptions;

	/**
	 * The settings for the file being linted.
	 * @type {Record<string, unknown>}
	 */
	settings;

	/**
	 * Creates a new instance.
	 * @param {Object} config The configuration object for the file context.
	 * @param {string} config.cwd The current working directory.
	 * @param {string} config.filename The filename of the file being linted.
	 * @param {string} config.physicalFilename The physical filename of the file being linted.
	 * @param {AnySourceCode} config.sourceCode The source code of the file being linted.
	 * @param {AnyLanguageOptions} config.languageOptions The language options used when parsing this file.
	 * @param {Record<string, unknown>} config.settings The settings for the file being linted.
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
	 * @template {object} T
	 * @param {T} extension The properties to add to the new object.
	 * @returns {Readonly<FileContext & T>} A new object with the current object as the prototype
	 * and the specified properties as its own properties.
	 */
	extend(extension) {
		/*
		 * `Object.create(this)` is typed `any`, so the assertion is what carries
		 * the prototype relationship the runtime actually establishes.
		 */
		return /** @type {Readonly<FileContext & T>} */ (
			Object.freeze(Object.assign(Object.create(this), extension))
		);
	}
}

exports.FileContext = FileContext;

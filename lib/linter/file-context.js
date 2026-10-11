// @ts-check
/**
 * @fileoverview The FileContext class.
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").LanguageOptions} LanguageOptions */

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
	 *
	 * Left as `any` for the same reason as `RuleContext.sourceCode` in
	 * `lib/shared/types.js`: which source code class this is depends on the
	 * language the file was linted with, and a `FileContext` is not
	 * parameterized by one.
	 * @type {any}
	 */
	sourceCode;

	/**
	 * The language options used when parsing this file.
	 * @type {LanguageOptions}
	 */
	languageOptions;

	/**
	 * The settings for the file being linted.
	 * @type {Record<string, any>}
	 */
	settings;

	/**
	 * Creates a new instance.
	 * @param {object} config The configuration object for the file context.
	 * @param {string} config.cwd The current working directory.
	 * @param {string} config.filename The filename of the file being linted.
	 * @param {string} config.physicalFilename The physical filename of the file being linted.
	 * @param {any} config.sourceCode The source code of the file being linted.
	 * @param {LanguageOptions} config.languageOptions The language options used when parsing this file.
	 * @param {Record<string, any>} config.settings The settings for the file being linted.
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
	 * @returns {Readonly<FileContext & T>} A new object with the current object
	 * as the prototype and the specified properties as its own properties.
	 */
	extend(extension) {
		/*
		 * `Object.create(this)` is typed `any`, so the intersection with the
		 * prototype's own members has to be stated rather than inferred.
		 */
		return Object.freeze(
			/** @type {FileContext & T} */ (
				Object.assign(Object.create(this), extension)
			),
		);
	}
}

exports.FileContext = FileContext;

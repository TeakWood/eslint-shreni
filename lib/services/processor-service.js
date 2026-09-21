/**
 * @fileoverview ESLint Processor Service
 * @author Nicholas C. Zakas
 */

// @ts-check
/* eslint class-methods-use-this: off -- Anticipate future constructor arguments. */

"use strict";

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

const path = require("node:path");
const { VFile } = require("../linter/vfile.js");

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/** @typedef {import("../shared/types.js").LintMessage} LintMessage */
/** @typedef {import("../linter/vfile.js").VFileBody} VFileBody */

/**
 * One of the code blocks a processor extracts from a file. A processor may also
 * yield a bare string, which is the legacy form of the same thing.
 * @typedef {Object} ProcessorBlock
 * @property {string} filename The name to give the block, appended to the file's path.
 * @property {string} text The source text of the block.
 */

/*
 * A processor, as contributed by a plugin. Only the two members this service
 * calls are named; a processor may carry anything else alongside them.
 *
 * The two are written as methods rather than function-typed properties on
 * purpose: method parameters are checked bivariantly, which is what lets a
 * plugin declare `preprocess(text: string, ...)` — the only body shape most
 * languages produce — without having to restate the binary case it never sees.
 */

/**
 * @typedef {{
 *   preprocess(text: VFileBody, filename: string): Array<string | ProcessorBlock>,
 *   postprocess(messages: Array<Array<LintMessage>>, filename: string): Array<LintMessage>
 * }} Processor
 */

/**
 * The subset of a resolved config this service reads.
 * @typedef {Object} ProcessorConfig
 * @property {Processor} processor The processor to apply.
 */

/**
 * The outcome of a preprocess: either the blocks to lint or the errors that
 * prevented them from being extracted.
 * @typedef {{ ok: true, files: Array<string | VFile> } | { ok: false, errors: Array<LintMessage> }} PreprocessResult
 */

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The service that applies processors to files.
 */
class ProcessorService {
	/**
	 * Preprocesses the given file synchronously.
	 * @param {VFile} file The file to preprocess.
	 * @param {ProcessorConfig} config The configuration to use.
	 * @returns {PreprocessResult} An array of preprocessed files or errors.
	 * @throws {Error} If the preprocessor returns a promise.
	 */
	preprocessSync(file, config) {
		const { processor } = config;
		let blocks;

		try {
			blocks = processor.preprocess(file.rawBody, file.path);
		} catch (ex) {
			/*
			 * The thrown value comes from third-party code, so its shape is
			 * only a convention: the properties read below are the ones
			 * ESLint has always reported on.
			 */
			const error =
				/** @type {{ message: string, lineNumber?: number, column?: number }} */ (
					ex
				);

			// If the message includes a leading line number, strip it:
			const message = `Preprocessing error: ${error.message.replace(/^line \d+:/iu, "").trim()}`;

			return {
				ok: false,
				errors: [
					{
						ruleId: null,
						fatal: true,
						severity: 2,
						message,
						line: /** @type {number} */ (error.lineNumber),
						column: /** @type {number} */ (error.column),
					},
				],
			};
		}

		/*
		 * A processor is required to be synchronous, but nothing stops one from
		 * returning a promise, so probe the result for a `then` method rather
		 * than trusting the declared return type.
		 */
		if (
			typeof (/** @type {{ then?: unknown }} */ (blocks).then) ===
			"function"
		) {
			throw new Error("Unsupported: Preprocessor returned a promise.");
		}

		return {
			ok: true,
			files: blocks.map((block, i) => {
				// Legacy behavior: return the block as a string
				if (typeof block === "string") {
					return block;
				}

				const filePath = path.join(file.path, `${i}_${block.filename}`);

				return new VFile(filePath, block.text, {
					physicalPath: file.physicalPath,
				});
			}),
		};
	}

	/**
	 * Postprocesses the given messages synchronously.
	 * @param {VFile} file The file to postprocess.
	 * @param {Array<Array<LintMessage>>} messages The messages to postprocess,
	 *      one array per code block.
	 * @param {ProcessorConfig} config The configuration to use.
	 * @returns {Array<LintMessage>} The postprocessed messages.
	 */
	postprocessSync(file, messages, config) {
		const { processor } = config;

		return processor.postprocess(messages, file.path);
	}
}

module.exports = { ProcessorService };

// @ts-check
/**
 * @fileoverview ESLint Processor Service
 * @author Nicholas C. Zakas
 */
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
/** @typedef {import("../shared/types.js").Processor} Processor */

/**
 * The part of a resolved config this service uses. Written as its own typedef
 * rather than taken from `lib/config/config.js` because `Linter` also calls the
 * service with an inline processor built out of the `preprocess` and
 * `postprocess` verify options, which is not a config object.
 * @typedef {Object} ProcessorConfig
 * @property {Processor} processor The processor to apply.
 */

/**
 * The outcome of {@link ProcessorService.preprocessSync}. A processor may hand
 * back a bare string for a block instead of a file, which is the legacy form.
 * @typedef {{ ok: true, files: (string | VFile)[] } | { ok: false, errors: LintMessage[] }} PreprocessSyncResult
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
	 * @returns {PreprocessSyncResult} An array of preprocessed files or errors.
	 * @throws {Error} If the preprocessor returns a promise.
	 */
	preprocessSync(file, config) {
		const { processor } = config;
		let blocks;

		try {
			/*
			 * `VFile#rawBody` is `string | Uint8Array` because a language may
			 * read a binary file, but a processor is only ever reached for text:
			 * `ESLint` reads files as UTF-8 and `Linter` is handed a string.
			 */
			const rawText = /** @type {string} */ (file.rawBody);

			blocks = processor.preprocess(rawText, file.path);
		} catch (ex) {
			/*
			 * Narrowed into a second local rather than by casting the catch
			 * binding, which `preserve-caught-error` rejects. A thrown
			 * preprocessing error may carry its own position.
			 */
			const error =
				/** @type {Error & { lineNumber?: number, column?: number }} */ (
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
						line: error.lineNumber,
						column: error.column,
					},
				],
			};
		}

		/*
		 * A processor is contracted to preprocess synchronously, so the result
		 * type is an array with no `then`. This guard exists for the processor
		 * that breaks that contract, which is why it reads through a view.
		 */
		const thenable = /** @type {{ then?: unknown }} */ (
			/** @type {unknown} */ (blocks)
		);

		if (typeof thenable.then === "function") {
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
	 * @param {LintMessage[][]} messages The messages to postprocess, one array per code block.
	 * @param {ProcessorConfig} config The configuration to use.
	 * @returns {LintMessage[]} The postprocessed messages.
	 */
	postprocessSync(file, messages, config) {
		const { processor } = config;

		return processor.postprocess(messages, file.path);
	}
}

module.exports = { ProcessorService };

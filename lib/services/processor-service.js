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

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The service that applies processors to files.
 */
class ProcessorService {
	/**
	 * Preprocesses the given file synchronously.
	 * @param file The file to preprocess.
	 * @param config The configuration to use.
	 * @returns An array of preprocessed files or errors.
	 * @throws If the preprocessor returns a promise.
	 */
	preprocessSync(file, config) {
		const { processor } = config;
		let blocks;

		try {
			blocks = processor.preprocess(file.rawBody, file.path);
		} catch (ex) {
			// If the message includes a leading line number, strip it:
			const message = `Preprocessing error: ${ex.message.replace(/^line \d+:/iu, "").trim()}`;

			return {
				ok: false,
				errors: [
					{
						ruleId: null,
						fatal: true,
						severity: 2,
						message,
						line: ex.lineNumber,
						column: ex.column,
					},
				],
			};
		}

		if (typeof blocks.then === "function") {
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
	 * @param file The file to postprocess.
	 * @param messages The messages to postprocess.
	 * @param config The configuration to use.
	 * @returns The postprocessed messages.
	 */
	postprocessSync(file, messages, config) {
		const { processor } = config;

		return processor.postprocess(messages, file.path);
	}
}

module.exports = { ProcessorService };

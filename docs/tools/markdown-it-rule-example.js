"use strict";

const { docsExampleCodeToParsableCode } = require("./code-block-utils");

/**
 * This is a utility to simplify the creation of `markdown-it-container` options to handle rule
 * examples in the documentation.
 * It is designed to automate the following common tasks:
 *
 * - Ensure that the plugin instance only matches container blocks tagged with 'correct' or
 * 'incorrect'.
 * - Parse the optional `languageOptions` after the correct/incorrect tag.
 * - Apply common transformations to the code inside the code block, like stripping '⏎' at the end
 * of a line or the last newline character.
 *
 * Additionally, the opening and closing of the container blocks are handled by two distinct
 * callbacks, of which only the `open` callback is required.
 * @param options The options object.
 * @param options.open The open callback.
 * @param [options.close] The close callback.
 * @returns The `markdown-it-container` options.
 * @example
 * const markdownIt = require("markdown-it");
 * const markdownItContainer = require("markdown-it-container");
 *
 * markdownIt()
 *     .use(markdownItContainer, "rule-example", markdownItRuleExample({
 *         open({ type, code, languageOptions, codeBlockToken, env }) {
 *             // do something
 *         }
 *         close() {
 *             // do something
 *         }
 *     }))
 *     .render(text);
 *
 */
function markdownItRuleExample({ open, close }) {
	return {
		validate(info) {
			return /^\s*(?:in)?correct(?!\S)/u.test(info);
		},
		render(tokens, index, options, env) {
			const tagToken = tokens[index];

			if (tagToken.nesting < 0) {
				const text = close ? close() : void 0;

				// Return an empty string to avoid appending unexpected text to the output.
				return typeof text === "string" ? text : "";
			}

			const { type, languageOptionsJSON } =
				/^\s*(?<type>\S+)(?:\s+(?<languageOptionsJSON>\S(?:.*\S)?))?/u.exec(
					tagToken.info,
				).groups;
			const languageOptions = languageOptionsJSON
				? JSON.parse(languageOptionsJSON)
				: void 0;
			const codeBlockToken = tokens[index + 1];

			// Remove trailing newline and presentational `⏎` characters (https://github.com/eslint/eslint/issues/17627):
			const code = docsExampleCodeToParsableCode(codeBlockToken.content);

			const text = open({
				type,
				code,
				languageOptions,
				codeBlockToken,
				env,
			});

			// Return an empty string to avoid appending unexpected text to the output.
			return typeof text === "string" ? text : "";
		},
	};
}

module.exports = markdownItRuleExample;

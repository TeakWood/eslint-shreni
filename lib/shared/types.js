// @ts-check
/**
 * @fileoverview Central hub for the `@typedef` declarations describing ESLint's
 * core public shapes.
 *
 * Every other module references these with
 * `@type {import("../shared/types.js").TypeName}` rather than declaring its own
 * copy. Centralising them here avoids circular type references between modules
 * that mutually `require()` each other (for example
 * `lib/eslint/eslint.js` and `lib/eslint/eslint-helpers.js`).
 *
 * The shapes mirror the public API documented in
 * `docs/src/integrate/nodejs-api.md`; keep the two in sync.
 *
 * @author Nicholas C. Zakas
 */

"use strict";

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/*
 * This module exists only to carry type declarations. It deliberately exports
 * an empty object so that `require("./types")` is harmless and so that tooling
 * (Knip, c8) sees a real CommonJS module rather than a stray file.
 */
module.exports = {};

//------------------------------------------------------------------------------
// Configuration primitives
//------------------------------------------------------------------------------

/**
 * How a single global variable may be configured.
 * @typedef {boolean | "off" | "readable" | "readonly" | "writable" | "writeable"} GlobalConf
 */

/**
 * A severity as it may be written in a config file.
 * @typedef {0 | 1 | 2 | "off" | "warn" | "error"} SeverityConf
 */

/**
 * The severity of a message that was actually reported. `0` ("off") never
 * reaches a reported message, so it is excluded.
 * @typedef {1 | 2} ReportedSeverity
 */

/**
 * How a single rule may be configured: a bare severity, or a severity followed
 * by that rule's options.
 * @typedef {SeverityConf | [SeverityConf, ...any[]]} RuleConf
 */

/**
 * The `rules` key of a config object, keyed by rule ID.
 * @typedef {Record<string, RuleConf>} RulesConfig
 */

/**
 * An `Error` carrying the two extra fields ESLint's convention attaches so that
 * the CLI can render a templated message from `templates/` instead of the raw
 * `message`.
 *
 * Nothing in the codebase subclasses `Error` to add them — they are assigned to
 * an already-constructed error — so what makes them visible is asserting this
 * type at the construction site, then assigning to the result. See
 * `assertConfigurationExists()` in `lib/config/config-loader.js` for the shape.
 * @typedef {Error & { messageTemplate?: string, messageData?: Record<string, unknown> }} ESLintError
 */

//------------------------------------------------------------------------------
// Edits and suggestions
//------------------------------------------------------------------------------

/**
 * Information to edit text, as produced by a rule's fixer.
 *
 * Applying it means replacing the `range` of the source text with `text`, i.e.
 * `text.slice(0, range[0]) + edit.text + text.slice(range[1])`. It is an
 * insertion when both range indices are equal, and a removal when `text` is the
 * empty string.
 * @typedef {Object} EditInfo
 * @property {[number, number]} range The pair of 0-based indices in the source text to replace.
 * @property {string} text The text to add.
 */

/**
 * The normalized form of a suggestion offered alongside a lint message.
 * @typedef {Object} SuggestionResult
 * @property {string} desc A short description of what the suggestion does.
 * @property {string} [messageId] The ID of the message in the rule's meta that produced `desc`.
 * @property {EditInfo} fix The edit that applies the suggestion.
 */

//------------------------------------------------------------------------------
// Lint messages and results
//------------------------------------------------------------------------------

/**
 * The classification of the problem a rule reports, taken from the reporting
 * rule's `meta.type`.
 * @typedef {"problem" | "suggestion" | "layout"} LintMessageType
 */

/**
 * The information of a single linting error. The `messages` property of a
 * {@link LintResult} contains these.
 * @typedef {Object} LintMessage
 * @property {string | null} ruleId The ID of the rule that generated this message, or `null` when it came from the ESLint core rather than a rule.
 * @property {ReportedSeverity} severity The severity of this message: `1` is a warning and `2` is an error.
 * @property {boolean} [fatal] `true` if this is a fatal error unrelated to a rule, such as a parsing error.
 * @property {string} message The error message.
 * @property {string} [messageId] The ID of the message in the rule's meta. Unset when the rule does not use message IDs.
 * @property {number | undefined} line The 1-based line number of the start of this message.
 * @property {number | undefined} column The 1-based column number of the start of this message.
 * @property {number} [endLine] The 1-based line number of the end of this message. Unset when the message is not a range.
 * @property {number} [endColumn] The 1-based column number of the end of this message. Unset when the message is not a range.
 * @property {string | null} [nodeType] The type of the AST node this message was reported on.
 * @property {EditInfo} [fix] The autofix for this message. Unset when the message is not fixable.
 * @property {SuggestionResult[]} [suggestions] The suggestions for this message. Unset when the message has none.
 */

/**
 * Why a single lint message was suppressed.
 * @typedef {Object} SuppressionInfo
 * @property {string} kind The kind of suppression, such as `"directive"`.
 * @property {string} justification The justification given for the suppression, or the empty string.
 */

/**
 * The information of a single suppressed linting error. The
 * `suppressedMessages` property of a {@link LintResult} contains these. It is a
 * {@link LintMessage} plus the record of what suppressed it.
 * @typedef {LintMessage & { suppressions: SuppressionInfo[] }} SuppressedLintMessage
 */

/**
 * A count of suppressed violations, keyed by rule ID and then by suppression kind.
 * @typedef {Record<string, Record<string, { count: number }>>} SuppressedViolations
 */

/**
 * The time spent in one phase of a lint pass.
 * @typedef {Object} TimeTotal
 * @property {number} total The total time spent, in milliseconds.
 */

/**
 * The times spent in a single pass over a file.
 * @typedef {Object} TimePass
 * @property {TimeTotal} parse The time spent parsing the file.
 * @property {Record<string, TimeTotal>} [rules] The time spent in each rule, keyed by rule ID.
 * @property {TimeTotal} fix The time spent applying fixes.
 * @property {number} total The total time spent on this pass.
 */

/**
 * The times spent linting a file, one entry per fix pass.
 * @typedef {Object} Times
 * @property {TimePass[]} passes The time spent on each pass.
 */

/**
 * The performance statistics collected when the `stats` option is enabled.
 * @typedef {Object} Stats
 * @property {number} fixPasses The number of times ESLint applied at least one fix after linting.
 * @property {Times} times The times spent parsing, fixing and linting the file.
 */

/**
 * The linting result for a single file, as returned by `eslint.lintFiles()` and
 * `eslint.lintText()`.
 * @typedef {Object} LintResult
 * @property {string} filePath The absolute path to the file that was linted, or `"<text>"` when the path is unknown.
 * @property {LintMessage[]} messages All of the messages for this result.
 * @property {SuppressedLintMessage[]} suppressedMessages All of the suppressed messages for this result.
 * @property {number} errorCount The number of errors, including fixable and fatal errors.
 * @property {number} fatalErrorCount The number of fatal errors.
 * @property {number} warningCount The number of warnings, including fixable warnings.
 * @property {number} fixableErrorCount The number of errors fixable by the `fix` option.
 * @property {number} fixableWarningCount The number of warnings fixable by the `fix` option.
 * @property {Stats} [stats] The performance statistics collected with the `stats` option.
 * @property {string} [source] The original source text. Unset when there were no messages, or when `output` is set.
 * @property {string} [output] The source text with as many fixes applied as possible. Unset when no fixable message existed.
 * @property {DeprecatedRuleInfo[]} [usedDeprecatedRules] The deprecated rules that were used to check this file.
 */

/**
 * Information provided when the maximum warning threshold is exceeded.
 * @typedef {Object} MaxWarningsExceeded
 * @property {number} maxWarnings The number of warnings that triggers a nonzero exit code.
 * @property {number} foundWarnings The number of warnings found while linting.
 */

/**
 * Metadata about a set of results, passed through to formatters.
 * @typedef {Object} ResultsMeta
 * @property {MaxWarningsExceeded} [maxWarningsExceeded] Present when the `maxWarnings` threshold was exceeded.
 */

//------------------------------------------------------------------------------
// Rule deprecation
//------------------------------------------------------------------------------

/**
 * Information about a rule that replaces a deprecated rule.
 * @typedef {Object} ReplacedByInfo
 * @property {string} [message] A message presented to the user explaining how to replace the rule.
 * @property {string} [url] A URL with more information about this replacement.
 * @property {{ name?: string, url?: string }} [plugin] The plugin providing the replacement; `"eslint"` for a core rule, omitted when the replacement is in the same plugin.
 * @property {{ name?: string, url?: string }} [rule] The name of, and information about, the replacement rule.
 */

/**
 * Additional metadata about a rule deprecation, as provided by a rule's
 * `meta.deprecated` when it is an object rather than a boolean.
 * @typedef {Object} DeprecatedInfo
 * @property {string} [message] A message presented to the user explaining why the rule is deprecated.
 * @property {string} [url] A URL with more information about this deprecation.
 * @property {ReplacedByInfo[]} [replacedBy] Potential replacements. An empty array explicitly states that there is no replacement.
 * @property {string} [deprecatedSince] The version in which the rule was deprecated, as full semver without a leading `"v"`.
 * @property {string | null} [availableUntil] The version in which the rule is expected to be removed, or `null` when the rule is frozen rather than scheduled for removal.
 */

/**
 * Information about a deprecated rule that a config used.
 * @typedef {Object} DeprecatedRuleInfo
 * @property {string} ruleId The rule ID.
 * @property {string[]} replacedBy The rule IDs that replace this deprecated rule.
 * @property {DeprecatedInfo} [info] The raw deprecation info the rule provided. Unset when `meta.deprecated` is a boolean.
 */

//------------------------------------------------------------------------------
// Rules
//------------------------------------------------------------------------------

/**
 * The documentation metadata of a rule.
 * @typedef {Object} RuleMetaDocs
 * @property {string} [description] A short description of what the rule does.
 * @property {boolean} [recommended] `true` when the rule is part of the `recommended` preset.
 * @property {string} [url] The URL of the rule's documentation.
 */

/**
 * The metadata of a rule.
 * @typedef {Object} RuleMetaData
 * @property {LintMessageType} [type] The classification of the problems this rule reports.
 * @property {RuleMetaDocs} [docs] The rule's documentation metadata.
 * @property {"code" | "whitespace"} [fixable] The kind of fix the rule produces. A rule that reports fixes must set this.
 * @property {boolean} [hasSuggestions] `true` when the rule provides suggestions.
 * @property {Record<string, string>} [messages] The rule's messages, keyed by message ID.
 * @property {boolean | DeprecatedInfo} [deprecated] Whether, and how, the rule is deprecated.
 * @property {string[]} [replacedBy] The rule IDs that replace this rule.
 * @property {any} [schema] The JSON Schema for the rule's options, or `false` when the rule takes none.
 * @property {any[]} [defaultOptions] The default options applied before the user's options.
 * @property {string[]} [dialects] The dialects of the rule's language that it is intended to lint.
 * @property {string[]} [language] The language the rule targets.
 * @property {string[]} [languages] The languages the rule is designed to work with, each as `"pluginName/languageName"`, or `"pluginName/*"`, or `"*"`. A rule that omits this works with every language. `lib/config/config.js` rejects a config whose language no entry matches.
 * @property {boolean} [frozen] `true` when the rule will no longer be changed.
 */

/**
 * A fix, or set of fixes, a rule offers for a problem. Returning `null` means
 * the rule declined to fix after all.
 * @typedef {(fixer: RuleFixer) => EditInfo | EditInfo[] | Iterable<EditInfo> | null} ReportFixer
 */

/**
 * A suggestion a rule offers for a problem, for an editor to apply on request.
 * @typedef {Object} SuggestionDescriptor
 * @property {string} [desc] A short description of what the suggestion does. Use this or `messageId`.
 * @property {string} [messageId] The ID of the message in the rule's meta describing the suggestion.
 * @property {Record<string, unknown>} [data] The placeholder values to interpolate into the message.
 * @property {ReportFixer} fix The edit that applies the suggestion. A suggestion must offer one.
 */

/**
 * The descriptor a rule passes to `context.report()`.
 *
 * At least one of `node` and `loc` must be present, and exactly one of
 * `message` and `messageId`; neither constraint is expressible here, so both
 * are enforced at runtime by `lib/linter/file-report.js`.
 * @typedef {Object} ReportDescriptor
 * @property {any} [node] The AST node the problem is at.
 * @property {any} [loc] The source location of the problem, overriding `node`'s.
 * @property {string} [message] The problem message. Prefer `messageId`.
 * @property {string} [messageId] The ID of the message in the rule's meta.
 * @property {Record<string, unknown>} [data] The placeholder values to interpolate into the message.
 * @property {ReportFixer} [fix] The autofix for the problem. The rule's `meta.fixable` must be set to report one.
 * @property {SuggestionDescriptor[]} [suggest] The suggestions for the problem. The rule's `meta.hasSuggestions` must be `true` to report any.
 */

/**
 * The context object passed to a rule's `create()` method.
 *
 * `sourceCode` stays `any` because its type depends on the language the file
 * was linted with, and a `RuleContext` is not parameterized by one. The
 * JavaScript source code object is
 * `lib/languages/js/source-code/source-code.js`; a rule written for it should
 * name that type itself rather than have it assumed here.
 * @typedef {Object} RuleContext
 * @property {string} id The ID of the rule being executed.
 * @property {any[]} options The options configured for this rule.
 * @property {Record<string, any>} settings The shared settings from the config.
 * @property {string} [parserPath] The path to the parser, for configs that specify one by path.
 * @property {Record<string, any>} languageOptions The language options from the config.
 * @property {Record<string, any>} [parserOptions] The parser options from the config.
 * @property {Record<string, any>} [parserServices] The services the parser provides.
 * @property {any} sourceCode The source code object for the file being linted.
 * @property {string} cwd The current working directory of the ESLint instance.
 * @property {string} filename The filename of the file being linted, or `"<text>"` when linting text.
 * @property {string} physicalFilename The path to the file on disk, which differs from `filename` for processed code blocks.
 * @property {() => string} getCwd Returns `cwd`.
 * @property {() => string} getFilename Returns `filename`.
 * @property {() => string} getPhysicalFilename Returns `physicalFilename`.
 * @property {() => any} getSourceCode Returns `sourceCode`.
 * @property {(descriptor: ReportDescriptor) => void} report Reports a problem in the code.
 */

/**
 * The object a rule's `create()` method receives for building fixes. Each method
 * returns an {@link EditInfo} rather than applying the fix immediately.
 * @typedef {Object} RuleFixer
 * @property {(nodeOrToken: any, text: string) => EditInfo} insertTextAfter Inserts text after the given node or token.
 * @property {(range: [number, number], text: string) => EditInfo} insertTextAfterRange Inserts text after the given range.
 * @property {(nodeOrToken: any, text: string) => EditInfo} insertTextBefore Inserts text before the given node or token.
 * @property {(range: [number, number], text: string) => EditInfo} insertTextBeforeRange Inserts text before the given range.
 * @property {(nodeOrToken: any, text: string) => EditInfo} replaceText Replaces the text of the given node or token.
 * @property {(range: [number, number], text: string) => EditInfo} replaceTextRange Replaces the text in the given range.
 * @property {(nodeOrToken: any) => EditInfo} remove Removes the given node or token.
 * @property {(range: [number, number]) => EditInfo} removeRange Removes the text in the given range.
 */

/**
 * The visitor a rule's `create()` method returns. Keys are AST node types (or
 * esquery selectors, or code-path event names) and values are the callbacks
 * ESLint invokes during traversal.
 * @typedef {Record<string, ((...args: any[]) => void) | undefined>} RuleListener
 */

/**
 * The definition of an ESLint rule.
 *
 * Annotate a rule by putting the `@type` tag on a named binding and exporting
 * that binding afterwards:
 *
 * ```js
 * const rule = { meta: { ... }, create(context) { ... } };
 *
 * module.exports = rule;
 * ```
 *
 * A `@type` (or `@satisfies`) tag written directly on `module.exports = {...}`
 * is silently ignored — tsc takes it as a declaration of the module's export
 * type rather than as a constraint on the object literal, so nothing is
 * checked. `tests/lib/shared/types.js` pins both behaviors.
 * @typedef {Object} RuleModule
 * @property {RuleMetaData} [meta] The metadata for the rule.
 * @property {(context: RuleContext) => RuleListener} create Creates the visitor that ESLint uses to apply the rule during traversal.
 */

//------------------------------------------------------------------------------
// Config objects
//------------------------------------------------------------------------------

/*
 * `Language`, `Processor` and `Plugin` below declare the members that
 * `lib/config/` actually reads, not the full public shape of each. The
 * authoritative shapes belong to the beads that annotate their implementations
 * (`lib/languages/` for languages, `lib/linter/` for processors), and guessing
 * at them here would silently mislead every module that reads from them — the
 * same reason `RuleContext.sourceCode` is left as `any` above.
 */

/**
 * The `meta` object a plugin, language, processor or config may carry so that
 * ESLint can name it when serializing a config to JSON.
 * @typedef {Object} ObjectMeta
 * @property {string} [name] The name of the object, usually its npm package name.
 * @property {string} [version] The version of the object.
 * @property {string} [namespace] The alias a plugin may be referred to by, in addition to the key it is registered under.
 */

/**
 * The `languageOptions` key of a config object. Which keys are meaningful is up
 * to the configured language, so this stays open; `lib/languages/js/` validates
 * the JavaScript ones.
 * @typedef {Record<string, any>} LanguageOptions
 */

/**
 * A language implementation, as registered under a plugin's `languages` key.
 * @typedef {Object} Language
 * @property {ObjectMeta} [meta] The language's metadata.
 * @property {string} [name] The language's name, for a language that predates `meta`.
 * @property {string} [version] The language's version, for a language that predates `meta`.
 * @property {LanguageOptions} [defaultLanguageOptions] The language options applied before the user's.
 * @property {(languageOptions: LanguageOptions) => void} validateLanguageOptions Throws if the merged language options are invalid.
 * @property {(languageOptions: LanguageOptions) => LanguageOptions} [normalizeLanguageOptions] Canonicalizes the validated language options.
 */

/**
 * A processor, which extracts lintable code blocks out of a non-JavaScript file
 * and maps the resulting messages back onto it.
 *
 * `preprocess` and `postprocess` are written as methods rather than function
 * properties on purpose: method parameters are bivariant, so a processor
 * written against the narrow case it actually handles stays assignable here.
 * @typedef {{ meta?: ObjectMeta, name?: string, version?: string, supportsAutofix?: boolean, preprocess(text: string, filename: string): any[], postprocess(messages: any[][], filename: string): any[] }} Processor
 */

/**
 * An ESLint plugin, as registered under a config object's `plugins` key.
 * @typedef {Object} Plugin
 * @property {ObjectMeta} [meta] The plugin's metadata.
 * @property {string} [name] The plugin's name, for a plugin that predates `meta`.
 * @property {string} [version] The plugin's version, for a plugin that predates `meta`.
 * @property {Record<string, RuleModule>} [rules] The rules the plugin provides, keyed by rule name.
 * @property {Record<string, any>} [parsers] The parsers the plugin provides, keyed by parser name. Flat config resolves `languageOptions.parser` to an object rather than through a namespace, so nothing under `lib/config/` reads this; `RuleTester` copies it off the built-in `@` plugin.
 * @property {Record<string, Language>} [languages] The languages the plugin provides, keyed by language name.
 * @property {Record<string, Processor>} [processors] The processors the plugin provides, keyed by processor name.
 * @property {Record<string, any>} [configs] The shareable configs the plugin provides, keyed by config name.
 */

/**
 * The `linterOptions` key of a config object.
 * @typedef {Object} LinterOptionsConfig
 * @property {boolean} [noInlineConfig] `true` to ignore inline configuration comments.
 * @property {SeverityConf | boolean} [reportUnusedDisableDirectives] The severity to report an unused `eslint-disable` directive at.
 * @property {SeverityConf} [reportUnusedInlineConfigs] The severity to report an unused inline config comment at.
 */

/**
 * A single config object, as written in an `eslint.config.js` file.
 *
 * Every key is optional: a config object contributes only the keys it sets, and
 * `FlatConfigArray` merges the objects that apply to a file into one.
 * @typedef {Object} ConfigObject
 * @property {string} [name] A name for the config object, used in error messages.
 * @property {string} [basePath] The directory that this object's `files` and `ignores` are relative to.
 * @property {string[]} [files] The glob patterns of the files this object applies to.
 * @property {string[]} [ignores] The glob patterns of the files this object does not apply to. An object with only `ignores` sets global ignores.
 * @property {string} [language] The language to lint with, as `"pluginName/languageName"`.
 * @property {LanguageOptions} [languageOptions] The options for the configured language.
 * @property {LinterOptionsConfig} [linterOptions] The options for the linter itself.
 * @property {string | Processor} [processor] The processor to use, either as `"pluginName/processorName"` or inline.
 * @property {Record<string, Plugin>} [plugins] The plugins to make available, keyed by the namespace they are referred to by.
 * @property {RulesConfig} [rules] The rules to run, keyed by rule ID.
 * @property {Record<string, any>} [settings] Shared settings, passed through to every rule.
 */

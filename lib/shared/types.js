/**
 * @fileoverview Shared type definitions for ESLint.
 *
 * This module is the single hub for the core public shapes used across the
 * codebase. It carries no runtime behavior beyond an empty export, so other
 * modules can refer to the types with
 * `import("../shared/types.js").LintMessage` without requiring any code.
 *
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Primitives
//------------------------------------------------------------------------------

/**
 * A node in an ESTree-compatible abstract syntax tree.
 * @typedef {import("estree").Node} ASTNode
 */

/**
 * A half-open `[start, end)` pair of 0-based character offsets into the source text.
 * @typedef {[number, number]} Range
 */

/**
 * A 1-based line / 0-based column pair.
 * @typedef {Object} Position
 * @property {number} line The 1-based line number.
 * @property {number} column The 0-based column number.
 */

/**
 * A start/end pair of positions describing a region of source text.
 * @typedef {Object} SourceLocation
 * @property {Position} start The start position.
 * @property {Position} end The end position.
 */

/**
 * The numeric severity of a rule: off, warn, or error.
 * @typedef {0 | 1 | 2} Severity
 */

/**
 * The string form of a severity, as accepted in config files.
 * @typedef {"off" | "warn" | "error"} SeverityName
 */

/**
 * The category a reported problem belongs to, mirroring a rule's `meta.type`.
 * @typedef {"problem" | "suggestion" | "layout"} LintMessageType
 */

//------------------------------------------------------------------------------
// Fixes and suggestions
//------------------------------------------------------------------------------

/**
 * A single text edit: replace the characters in `range` with `text`.
 * @typedef {Object} EditInfo
 * @property {Range} range The range of characters to replace.
 * @property {string} text The replacement text.
 */

/**
 * A suggested, non-automatically-applied fix attached to a lint message.
 * @typedef {Object} SuggestionResult
 * @property {string} desc The human-readable description of the suggestion.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {EditInfo} fix The edit that applies the suggestion.
 */

/**
 * The reason a lint message was suppressed rather than reported.
 * @typedef {Object} LintSuppression
 * @property {"directive" | "file"} kind Where the suppression came from.
 * @property {string} [justification] The explanation given alongside the suppression.
 */

//------------------------------------------------------------------------------
// Messages and results
//------------------------------------------------------------------------------

/**
 * A single problem reported while linting a file.
 * @typedef {Object} LintMessage
 * @property {string | null} ruleId The ID of the rule that reported the problem, or `null` for fatal errors.
 * @property {Severity} severity The severity the problem was reported at.
 * @property {string} message The human-readable description of the problem.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {number} line The 1-based line number the problem starts on.
 * @property {number} column The 1-based column number the problem starts on.
 * @property {number} [endLine] The 1-based line number the problem ends on.
 * @property {number} [endColumn] The 1-based column number the problem ends on.
 * @property {boolean} [fatal] `true` when the problem is a parse error rather than a rule violation.
 * @property {EditInfo} [fix] The automatically applicable fix, when the rule provides one.
 * @property {Array<SuggestionResult>} [suggestions] The suggested fixes, when the rule provides any.
 */

/**
 * A lint message that was matched by a suppression and therefore not reported.
 * @typedef {LintMessage & { suppressions: Array<LintSuppression> }} SuppressedLintMessage
 */

/**
 * The counts of problems produced for a single file.
 * @typedef {Object} LintMessageCounts
 * @property {number} errorCount The number of errors.
 * @property {number} fatalErrorCount The number of fatal (parse) errors.
 * @property {number} warningCount The number of warnings.
 * @property {number} fixableErrorCount The number of errors that can be fixed automatically.
 * @property {number} fixableWarningCount The number of warnings that can be fixed automatically.
 */

/**
 * The timing information collected when the `stats` option is enabled.
 * @typedef {Object} LintStats
 * @property {Array<{ total: number }>} [times] The time spent in each linting pass.
 * @property {number} [fixPasses] The number of autofix passes performed.
 */

/**
 * The result of linting a single file.
 * @typedef {Object} LintResult
 * @property {string} filePath The absolute path of the linted file, or `"<text>"` for linted text.
 * @property {Array<LintMessage>} messages The problems reported for the file.
 * @property {Array<SuppressedLintMessage>} suppressedMessages The problems that were suppressed.
 * @property {number} errorCount The number of errors.
 * @property {number} fatalErrorCount The number of fatal (parse) errors.
 * @property {number} warningCount The number of warnings.
 * @property {number} fixableErrorCount The number of errors that can be fixed automatically.
 * @property {number} fixableWarningCount The number of warnings that can be fixed automatically.
 * @property {string} [output] The fixed source text, present only when fixes were applied.
 * @property {string} [source] The original source text, present only when problems were reported.
 * @property {Array<DeprecatedRuleInfo>} [usedDeprecatedRules] The deprecated rules that were enabled for the file.
 * @property {LintStats} [stats] The timing information, present only when the `stats` option is enabled.
 */

//------------------------------------------------------------------------------
// Rules
//------------------------------------------------------------------------------

/**
 * The object form of a rule's `meta.deprecated`.
 * @typedef {Object} DeprecatedInfo
 * @property {string} [message] The reason the rule was deprecated.
 * @property {string} [url] A URL with more information about the deprecation.
 * @property {Array<Object>} [replacedBy] The rules that replace the deprecated rule.
 * @property {string} [deprecatedSince] The version the rule was deprecated in.
 * @property {string} [availableUntil] The version the rule will be removed in.
 */

/**
 * A deprecated rule that was enabled during a lint run.
 * @typedef {Object} DeprecatedRuleInfo
 * @property {string} ruleId The ID of the deprecated rule.
 * @property {Array<string>} replacedBy The IDs of the rules that replace it, which may be empty.
 * @property {DeprecatedInfo} [info] The structured deprecation metadata, when the rule uses the object form.
 */

/**
 * The metadata a rule exposes about itself.
 * @typedef {Object} RuleMeta
 * @property {LintMessageType} [type] The category the rule belongs to.
 * @property {Object} [docs] The documentation metadata for the rule.
 * @property {boolean | DeprecatedInfo} [deprecated] Whether the rule is deprecated, optionally with details.
 * @property {Array<string>} [replacedBy] The IDs of the rules that replace this one.
 * @property {"code" | "whitespace"} [fixable] The kind of fix the rule produces, if it is fixable.
 * @property {boolean} [hasSuggestions] Whether the rule provides suggestions.
 * @property {Object | Array<Object> | false} [schema] The JSON schema for the rule's options.
 * @property {Array<unknown>} [defaultOptions] The default options for the rule.
 * @property {Record<string, string>} [messages] The message templates keyed by message ID.
 * @property {string} [language] The ID of the language the rule applies to.
 * @property {Array<string>} [languages] The IDs of the languages the rule supports, where an entry may be `"*"` or `"plugin/*"`.
 * @property {Array<string>} [dialects] The dialects of the language the rule applies to.
 */

/**
 * A problem passed to `context.report()`.
 * @typedef {Object} ReportDescriptor
 * @property {ASTNode} [node] The node the problem relates to.
 * @property {SourceLocation | Position} [loc] The explicit location of the problem.
 * @property {string} [message] The message to report.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {Record<string, string>} [data] The values to interpolate into the message.
 * @property {Function} [fix] A function that produces the fix for the problem.
 * @property {Array<Object>} [suggest] The suggestions to attach to the problem.
 */

/**
 * The object rules use to build fixes. Every method returns an {@link EditInfo}
 * describing the edit rather than applying it directly.
 * @typedef {Object} RuleFixer
 * @property {(nodeOrToken: Object, text: string) => EditInfo} insertTextAfter Inserts text after the given node or token.
 * @property {(range: Range, text: string) => EditInfo} insertTextAfterRange Inserts text after the given range.
 * @property {(nodeOrToken: Object, text: string) => EditInfo} insertTextBefore Inserts text before the given node or token.
 * @property {(range: Range, text: string) => EditInfo} insertTextBeforeRange Inserts text before the given range.
 * @property {(nodeOrToken: Object, text: string) => EditInfo} replaceText Replaces the given node or token.
 * @property {(range: Range, text: string) => EditInfo} replaceTextRange Replaces the given range.
 * @property {(nodeOrToken: Object) => EditInfo} remove Removes the given node or token.
 * @property {(range: Range) => EditInfo} removeRange Removes the given range.
 */

/**
 * The context object passed to a rule's `create()` method.
 * @typedef {Object} RuleContext
 * @property {string} id The ID the rule was configured under.
 * @property {Array<unknown>} options The options the rule was configured with.
 * @property {Record<string, unknown>} settings The shared settings from the config.
 * @property {string} cwd The current working directory.
 * @property {string} filename The name of the file being linted.
 * @property {string} physicalFilename The name of the file on disk, which differs from `filename` for processed files.
 * @property {Object} sourceCode The source code object for the file being linted.
 * @property {Object} languageOptions The language options the file was parsed with.
 * @property {Object} [parserOptions] The parser options the file was parsed with.
 * @property {(descriptor: ReportDescriptor) => void} report Reports a problem in the code.
 * @property {() => Object} [getSourceCode] Returns the source code object.
 * @property {() => string} [getFilename] Returns the name of the file being linted.
 * @property {() => string} [getCwd] Returns the current working directory.
 */

/**
 * A rule definition: the metadata plus the factory that produces its visitor.
 * @typedef {Object} RuleModule
 * @property {RuleMeta} [meta] The rule's metadata.
 * @property {(context: RuleContext) => Record<string, Function>} create Creates the visitor object the linter runs.
 */

module.exports = {};

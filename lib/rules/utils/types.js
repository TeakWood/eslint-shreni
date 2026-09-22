/**
 * @fileoverview Type vocabulary shared by the rule files.
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/** @typedef {import("./ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./ast-utils.js").Token} Token */
/** @typedef {import("./ast-utils.js").Comment} Comment */
/** @typedef {import("../../shared/types.js").RuleFixer} RuleFixer */
/** @typedef {import("../../shared/types.js").EditInfo} EditInfo */
/** @typedef {import("../../shared/types.js").SourceLocation} SourceLocation */
/** @typedef {import("../../shared/types.js").Position} Position */
/** @typedef {import("../../languages/js/source-code/source-code.js")} SourceCode */
/** @typedef {import("../../linter/code-path-analysis/code-path.js")} CodePath */
/** @typedef {import("../../linter/code-path-analysis/code-path-segment.js")} CodePathSegment */

/**
 * The fix a rule attaches to a problem. A rule may return a single edit, a
 * list of them, or a generator that yields them, and may decide at the last
 * moment that there is nothing safe to fix and return `null`.
 * @typedef {(fixer: RuleFixer) => EditInfo | Array<EditInfo> | Iterable<EditInfo> | null} FixFunction
 */

/**
 * A suggestion attached to a problem.
 * @typedef {Object} SuggestionDescriptor
 * @property {string} [desc] The description shown for the suggestion.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {Record<string, any>} [data] The values to interpolate into the message.
 * @property {FixFunction} fix Produces the edits the suggestion applies.
 */

/**
 * A problem passed to `context.report()`.
 *
 * This is the rules-layer counterpart to `lib/shared/types.js`'s
 * `ReportDescriptor`, and differs from it in two places where that one is
 * narrower than what the linter actually accepts. `node` is `Object` because
 * rules report against whatever carries the location they mean — an `ASTNode`,
 * a `Token`, or an `eslint-scope` identifier, which is a bare ESTree node with
 * no `parent`. `data` holds `any` because `interpolate()` stringifies whatever
 * it is given, and rules routinely pass numbers (line and column counts) and
 * booleans straight through.
 * @typedef {Object} ReportDescriptor
 * @property {Object} [node] The node or token the problem relates to.
 * @property {SourceLocation | Position} [loc] The explicit location of the problem.
 * @property {string} [message] The message to report.
 * @property {string} [messageId] The ID of the message in the rule's `meta.messages`.
 * @property {Record<string, any>} [data] The values to interpolate into the message.
 * @property {FixFunction | null} [fix] Produces the edits that fix the problem. `null` is accepted and means the same as omitting it.
 * @property {Array<SuggestionDescriptor> | null} [suggest] The suggestions to attach to the problem. `null` is accepted and means the same as omitting it.
 */

/**
 * The context object a rule's `create()` method receives.
 *
 * This is deliberately sharper than `lib/shared/types.js`'s `RuleContext`, and
 * the two are not interchangeable. That one models the *linter's* side of the
 * contract, where `sourceCode` is whatever the configured language produced and
 * `options` are whatever the user wrote in their config — so it types them as
 * `Object` and `Array<unknown>`, which is honest there and unusable here: every
 * `sourceCode.getText()` becomes a `TS2339` and every `options[0].foo` a
 * `TS18046`.
 *
 * A rule in this tree knows more than the linter does. It is a JavaScript rule,
 * so `sourceCode` is the `SourceCode` class rather than an opaque bag, and its
 * own `meta.schema` is what validated the options before `create()` ever ran.
 * `options` stays `any` for that reason: the schema is the check, and restating
 * it in JSDoc would duplicate it in a form nothing keeps in sync.
 * @typedef {Object} RuleContext
 * @property {string} id The ID the rule was configured under.
 * @property {Array<any>} options The options the rule was configured with, already validated against `meta.schema`.
 * @property {Record<string, any>} settings The shared settings from the config.
 * @property {string} cwd The current working directory.
 * @property {string} filename The name of the file being linted.
 * @property {string} physicalFilename The name of the file on disk, which differs from `filename` for processed files.
 * @property {SourceCode} sourceCode The source code object for the file being linted.
 * @property {Record<string, any>} languageOptions The language options the file was parsed with.
 * @property {Record<string, any>} [parserOptions] The parser options the file was parsed with.
 * @property {(descriptor: ReportDescriptor) => void} report Reports a problem in the code.
 * @property {() => SourceCode} [getSourceCode] Returns the source code object.
 * @property {() => string} [getFilename] Returns the name of the file being linted.
 * @property {() => string} [getCwd] Returns the current working directory.
 */

/**
 * The visitor object a rule's `create()` method returns. Keys are AST node
 * types, selectors, or code path events; the linter calls the matching handler
 * as it walks the tree.
 * @typedef {Record<string, (...args: Array<any>) => void>} RuleVisitor
 */

module.exports = {};

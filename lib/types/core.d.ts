/**
 * @fileoverview The shared type vocabulary for ESLint.
 *
 * This is the ONLY hand-authored type file in the repository. Everything else
 * is generated from JSDoc annotations in the JavaScript sources by
 * `tsc --declaration --emitDeclarationOnly` (see `tsconfig.types.json`), so
 * public declarations cannot drift from the implementation.
 *
 * What belongs here: types that cross module boundaries and therefore have no
 * single owning module — the vocabulary that `lib/` speaks. What does NOT
 * belong here: shapes owned by exactly one module. Those are declared with
 * `@typedef` in that module's own `.js` file and flow outward through
 * declaration emit.
 *
 * Every type below is grounded in the implementation that produces or consumes
 * it; the grounding site is named in the doc comment so the shape can be
 * re-verified against the code.
 *
 * `@eslint/core` is deliberately not adopted — this vocabulary is owned
 * in-repo so that the declaration pipeline has no external dependency that can
 * change shape out from under it.
 */

// -----------------------------------------------------------------------------
// Source positions
// -----------------------------------------------------------------------------

/**
 * A `[start, end)` pair of zero-based character offsets into the source text.
 */
export type SourceRange = [number, number];

/**
 * A one-based line / zero-based column position in the source text.
 */
export interface Position {
	/** One-based line number. */
	line: number;

	/** Zero-based column number. */
	column: number;
}

/**
 * A start/end position pair. Produced by espree for every AST node.
 */
export interface SourceLocation {
	start: Position;
	end: Position;
}

// -----------------------------------------------------------------------------
// Severity
// -----------------------------------------------------------------------------

/**
 * The numeric severity of a rule: `0` off, `1` warn, `2` error.
 */
export type SeverityLevel = 0 | 1 | 2;

/**
 * The human-readable severity of a rule.
 */
export type SeverityName = "off" | "warn" | "error";

/**
 * The numeric severity of a rule written as a string, which configuration
 * files accept as an alias for the numeric form.
 */
export type SeverityString = "0" | "1" | "2";

/**
 * Any of the three forms a configured severity can take.
 *
 * Grounding: `lib/shared/severity.js` normalizes exactly this union.
 */
export type Severity = SeverityLevel | SeverityName | SeverityString;

// -----------------------------------------------------------------------------
// ECMAScript versions
// -----------------------------------------------------------------------------

/**
 * A year-based ECMAScript version, as accepted by `languageOptions.ecmaVersion`.
 *
 * Grounding: `conf/ecma-version.js` (`LATEST_ECMA_VERSION`) and
 * `lib/languages/js/validate-language-options.js`.
 */
export type EcmaVersion = number;

// -----------------------------------------------------------------------------
// Fixes and suggestions
// -----------------------------------------------------------------------------

/**
 * A single text replacement produced by a rule's `fix` function.
 *
 * Grounding: `lib/linter/rule-fixer.js` builds objects of exactly this shape.
 */
export interface Fix {
	/** The range of the original text to replace. */
	range: SourceRange;

	/** The text to insert in place of `range`. */
	text: string;
}

/**
 * A suggested — but not automatically applied — fix.
 *
 * Grounding: `lib/linter/file-report.js` (`mapSuggestions`).
 */
export interface LintSuggestion {
	/** Human-readable description of the suggestion. */
	desc: string;

	/** The fix the suggestion would apply. */
	fix: Fix;

	/** The message ID the description was built from, if any. */
	messageId?: string;
}

// -----------------------------------------------------------------------------
// Lint messages
// -----------------------------------------------------------------------------

/**
 * A single problem reported for a file.
 *
 * Grounding: `createProblem` in `lib/linter/file-report.js` builds this object.
 * The optional properties are exactly the ones `createProblem` adds
 * conditionally, which is why they are optional rather than nullable.
 */
export interface LintMessage {
	/** The rule that reported the problem, or `null` for parsing/config errors. */
	ruleId: string | null;

	/** The severity the rule was configured at. */
	severity: SeverityLevel;

	/** The human-readable problem description. */
	message: string;

	/** One-based line the problem starts on. */
	line: number;

	/** One-based column the problem starts on. */
	column: number;

	/** One-based line the problem ends on, when the rule reported a range. */
	endLine?: number;

	/** One-based column the problem ends on, when the rule reported a range. */
	endColumn?: number;

	/** The `meta.messages` key the message was built from, when one was used. */
	messageId?: string;

	/** The autofix, when the rule provided one. */
	fix?: Fix;

	/** Suggestions, when the rule provided any. Never present but empty. */
	suggestions?: LintSuggestion[];

	/** `true` when the problem is a parsing error rather than a rule report. */
	fatal?: boolean;

	/** The AST node type the problem was reported on, when known. */
	nodeType?: string | null;
}

/**
 * Why a message was suppressed.
 *
 * Grounding: `lib/linter/apply-disable-directives.js`.
 */
export interface LintSuppression {
	/** The suppression mechanism, e.g. `"directive"`. */
	kind: string;

	/** The justification comment attached to the suppression, if any. */
	justification: string;
}

/**
 * A message that a rule reported but a suppression removed from the results.
 */
export interface SuppressedLintMessage extends LintMessage {
	/** Every suppression that applied to this message. */
	suppressions: LintSuppression[];
}

// -----------------------------------------------------------------------------
// Result counts
// -----------------------------------------------------------------------------

/**
 * The problem counts for a single file.
 *
 * Grounding: `calculateStatsPerFile` in `lib/shared/message-counts.js` returns
 * exactly this object.
 */
export interface MessageCounts {
	/** Number of messages with `severity` 2, including fatal errors. */
	errorCount: number;

	/** Number of messages with `fatal: true`. A subset of `errorCount`. */
	fatalErrorCount: number;

	/** Number of messages with `severity` 1. */
	warningCount: number;

	/** Number of errors that carry a fix. */
	fixableErrorCount: number;

	/** Number of warnings that carry a fix. */
	fixableWarningCount: number;
}

/**
 * Time spent in each phase of linting one file, in milliseconds.
 *
 * Grounding: `lib/linter/linter.js` populates this when the `stats` option is
 * enabled; the values come from `lib/shared/stats.js`.
 */
export interface LintTimes {
	passes: {
		parse: { total: number };
		rules?: Record<string, { total: number }>;
		fix: { total: number };
		total: number;
	}[];
}

/**
 * Performance statistics collected when the `stats` option is enabled.
 */
export interface LintStats {
	/** Number of autofix passes performed. */
	fixPasses: number;

	/** Timing breakdown per pass. */
	times: LintTimes;
}

/**
 * Structured metadata for a deprecated rule.
 *
 * Grounding: `meta.deprecated` on core rules in `lib/rules/`.
 */
export interface DeprecatedInfo {
	/** Why the rule was deprecated. */
	message?: string;

	/** URL with more detail. */
	url?: string;

	/** The rules that supersede this one. */
	replacedBy?: {
		message?: string;
		url?: string;
		plugin?: { name?: string; url?: string };
		rule?: { name?: string; url?: string };
	}[];

	/** The version the rule was deprecated in. */
	deprecatedSince?: string;

	/** The major version the rule is scheduled for removal in. */
	availableUntil?: string | null;
}

/**
 * A deprecated rule that a lint run actually used.
 */
export interface DeprecatedRuleUse {
	/** The deprecated rule's ID. */
	ruleId: string;

	/** IDs of the rules that replace it. Empty when there is no replacement. */
	replacedBy: string[];

	/** The raw `meta.deprecated` object, when the rule provided one. */
	info?: DeprecatedInfo;
}

/**
 * The result of linting a single file.
 *
 * Grounding: `lib/eslint/eslint.js` and `lib/cli-engine/lint-result-cache.js`,
 * which both construct and consume this shape.
 */
export interface LintResult extends MessageCounts {
	/** Absolute path to the linted file. */
	filePath: string;

	/** Every problem reported for the file. */
	messages: LintMessage[];

	/** Every problem that a suppression removed from `messages`. */
	suppressedMessages: SuppressedLintMessage[];

	/** The fixed source, present only when fixes were applied. */
	output?: string;

	/** The original source, present only when the file had problems. */
	source?: string;

	/** Performance statistics, present only when the `stats` option is on. */
	stats?: LintStats;

	/** Deprecated rules the run used. */
	usedDeprecatedRules: DeprecatedRuleUse[];
}

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

// -----------------------------------------------------------------------------
// AST nodes, comments and tokens
// -----------------------------------------------------------------------------

/**
 * A node in a parsed syntax tree.
 *
 * INTERIM SHAPE, deliberately. The phase-0 spike (`y6r.15`, recorded in the AST
 * section of `.shreni/design/typescript-types-from-jsdoc.md`) settled on a
 * hand-authored, CLOSED union of roughly 89 node interfaces, each with a
 * string-literal `type`. That union is large enough that the spike explicitly
 * recommended splitting it out of this bead; until it lands, `ASTNode` is the
 * union's agreed BASE — the four guarantees every ESLint node carries — so the
 * rule and config vocabulary below can name nodes without inventing a second,
 * inconsistent shape.
 *
 * The three fields beyond `type` are the spike's divergences #1, #2 and #3, and
 * they are the whole reason `@types/estree` was rejected as the vocabulary:
 * estree declares `range` and `loc` optional and has no `parent` at all, while
 * ESLint forces `range: true` / `loc: true` on every parse
 * (`lib/languages/js/index.js:242-245`) and assigns `parent` during traversal
 * (`lib/languages/js/source-code/source-code.js:1140`).
 *
 * `type` is a bare `string` here ONLY because a single interim member cannot be
 * a discriminant. Do NOT add a member with an open `type` to the eventual
 * union: the spike compiled that exact fallback and found it collapses
 * narrowing on every sibling member.
 */
export interface ASTNode {
	/** The node's kind. Becomes a string-literal discriminant in the union. */
	type: string;

	/** Always present — ESLint forces `range: true`. */
	range: SourceRange;

	/** Always present — ESLint forces `loc: true`. */
	loc: SourceLocation;

	/** Assigned during traversal. `null` only for the `Program` root. */
	parent: ASTNode | null;
}

/**
 * The root node of a parsed file.
 *
 * `tokens` and `comments` are non-optional because
 * `lib/languages/js/index.js:242-245` forces `tokens: true` and `comment: true`
 * on every parse, and `SourceCode`'s constructor dereferences both
 * unconditionally (`source-code.js:289`, `:356`).
 */
export interface Program extends ASTNode {
	type: "Program";

	/** The root has no parent. */
	parent: null;

	/** The top-level statements. */
	body: ASTNode[];

	/**
	 * How the file was parsed. `"commonjs"` is espree's third value and is
	 * accepted by `validate-language-options.js:83`; `@types/estree` declares
	 * only the first two, which is the spike's divergence #9.
	 */
	sourceType: "script" | "module" | "commonjs";

	/** Every token in the file, in source order. */
	tokens: Token[];

	/** Every comment in the file, in source order. */
	comments: Comment[];
}

/**
 * The kinds of comment ESLint sees.
 *
 * `"Hashbang"` is what espree emits for a leading `#!` line;
 * `source-code.js:359-361` rewrites that node's `type` in place to
 * `"Shebang"` before any rule runs, so both values occur and both are
 * observable — `getInlineConfigNodes` (`source-code.js:817`) tests for
 * `"Shebang"`. `@types/estree` declares neither (divergence #8).
 */
export type CommentType = "Line" | "Block" | "Hashbang" | "Shebang";

/**
 * A comment attached to the source, as `Program.comments` holds it.
 */
export interface Comment {
	type: CommentType;

	/** The comment body, without its delimiters. */
	value: string;

	range: SourceRange;
	loc: SourceLocation;
}

/**
 * The `type` values espree puts on tokens.
 *
 * Grounding: espree's own token conversion (`espree/dist/espree.cjs:170-235`)
 * assigns exactly these names.
 */
export type TokenType =
	| "Boolean"
	| "Identifier"
	| "JSXIdentifier"
	| "JSXText"
	| "Keyword"
	| "Null"
	| "Numeric"
	| "Punctuator"
	| "PrivateIdentifier"
	| "RegularExpression"
	| "String"
	| "Template";

/**
 * A token, as `Program.tokens` holds it.
 *
 * Tokens carry their own discriminant and are deliberately NOT members of the
 * node union: `ast-utils.js` has 28 single-argument token predicates against 22
 * node predicates, so this is a first-class sub-vocabulary rather than a corner
 * of the node one.
 */
export interface Token {
	type: TokenType;

	/** The token's source text. */
	value: string;

	range: SourceRange;
	loc: SourceLocation;
}

/**
 * Anything with a `range` and a `loc`, which is what the fixer and the token
 * store actually require of their arguments.
 *
 * Grounding: `RuleFixer` reaches its arguments only through
 * `sourceCode.getRange()` (`lib/linter/rule-fixer.js:81`), and the token store
 * compares `range`s (`token-store/index.js`).
 */
export type NodeOrToken = ASTNode | Token | Comment;

/**
 * The child-property names to visit for each node type.
 *
 * Grounding: `eslint-visitor-keys`' `KEYS`, used as the default at
 * `lib/languages/js/index.js:106` and `source-code.js:350`.
 */
export type VisitorKeys = Record<string, readonly string[]>;

// -----------------------------------------------------------------------------
// Scope analysis
// -----------------------------------------------------------------------------

/*
 * These four are aliases into `eslint-scope`'s own declarations rather than
 * re-declarations. `eslint-scope` is a runtime dependency that ships types, and
 * the epic's stated position is that ESLint depends on a package's types AT A
 * BOUNDARY while owning its own vocabulary internally — scope analysis is such
 * a boundary, and re-declaring it here would be the "second, inconsistent
 * vocabulary" the spike warns against.
 *
 * Inline `import(...)` rather than a top-level import is required: a top-level
 * import would make this file a module and silently turn `vendor.d.ts`-style
 * ambient blocks elsewhere into augmentations. It is also verified to resolve
 * under the declaration-emit gate's standalone recompile (`types: []`,
 * `skipLibCheck: false`).
 */

/** The result of scope-analysing a `Program`. */
export type ScopeManager = import("eslint-scope").ScopeManager;

/** A single lexical scope. */
export type Scope = import("eslint-scope").Scope;

/** A variable declared in a scope. */
export type Variable = import("eslint-scope").Variable;

/** A read or write of a variable. */
export type Reference = import("eslint-scope").Reference;

// -----------------------------------------------------------------------------
// Source code
// -----------------------------------------------------------------------------

/**
 * Arbitrary values a parser exposes to rules through `context.sourceCode.parserServices`.
 *
 * Deliberately open and `unknown`-valued: the contents are whatever the
 * configured parser chose to return (`languages/js/index.js:269`), so anything
 * narrower would be a claim ESLint cannot make.
 */
export type ParserServices = Record<string, unknown>;

/**
 * Selects tokens or comments during a token-store query.
 */
export type TokenFilter = (tokenOrComment: Token | Comment) => boolean;

/**
 * Options for the token-store getters that skip forwards or backwards.
 *
 * The scalar forms are shorthands the implementation accepts directly: a number
 * is `skip`, a function is `filter` (`token-store/index.js:101-106`).
 */
export type SkipOptions =
	| number
	| TokenFilter
	| {
			/** Iterate comments as well as tokens. */
			includeComments?: boolean;

			/** Keep only the tokens this returns `true` for. */
			filter?: TokenFilter;

			/** How many matching tokens to skip. */
			skip?: number;
	  };

/**
 * Options for the token-store getters that return several tokens.
 *
 * A number is `count` and a function is `filter`
 * (`token-store/index.js:155-163`).
 */
export type CountOptions =
	| number
	| TokenFilter
	| {
			/** Iterate comments as well as tokens. */
			includeComments?: boolean;

			/** Keep only the tokens this returns `true` for. */
			filter?: TokenFilter;

			/** The maximum number of tokens to return. */
			count?: number;
	  };

/**
 * A parsed inline `eslint-disable` / `eslint-enable` comment.
 *
 * Aliased from `@eslint/plugin-kit`, which is where `source-code.js:898`
 * constructs them — the same boundary argument as the scope types above.
 */
export type DisableDirective = import("@eslint/plugin-kit").Directive;

/**
 * The problems and directives `SourceCode#getDisableDirectives()` returns.
 *
 * Grounding: `source-code.js:906` builds `{ problems, directives }`, and
 * `problems` entries are the partial messages pushed at `:879-883`.
 */
export interface DisableDirectivesResult {
	/** Directives that parsed successfully. */
	directives: DisableDirective[];

	/** Problems found while parsing the directive comments. */
	problems: InlineConfigProblem[];
}

/**
 * A problem found while parsing an inline configuration comment.
 *
 * Not a `LintMessage`: these are partial, carrying a raw `loc` rather than the
 * `line`/`column` pair a `LintMessage` has, and the linter finishes them.
 * Grounding: pushed at `source-code.js:879-883`, `:984-988` and `:1019-1023`.
 */
export interface InlineConfigProblem {
	/** Always `null` — no rule reported these. */
	ruleId: null;

	/** The human-readable problem description. */
	message: string;

	/** The location of the offending comment. */
	loc: SourceLocation;
}

/**
 * A step produced by traversing the source code, consumed by the linter's
 * visitor. Aliased from `@eslint/plugin-kit`, whose `VisitNodeStep` and
 * `CallMethodStep` are what `source-code.js` pushes.
 */
export type TraversalStep = import("@eslint/plugin-kit").TraversalStep;

/**
 * The parsed representation of one file, and the object every rule reaches
 * through `context.sourceCode`.
 *
 * Grounding: `lib/languages/js/source-code/source-code.js` for the properties
 * and the node-oriented methods, and
 * `lib/languages/js/source-code/token-store/index.js` (which `SourceCode`
 * extends, `source-code.js:254`) for the token getters. Every member below
 * exists on one of those two classes; nothing is anticipated.
 */
export interface SourceCode {
	/** The source text, with any BOM stripped. */
	readonly text: string;

	/** The parsed tree. */
	readonly ast: Program;

	/** Whether the original text began with a Unicode BOM. */
	readonly hasBOM: boolean;

	/** Whether the tree is ESTree-shaped, i.e. rooted at a `Program`. */
	readonly isESTree: boolean;

	/** Whatever the configured parser exposed to rules. */
	readonly parserServices: ParserServices;

	/** The scope analysis, or `null` when none was produced. */
	readonly scopeManager: ScopeManager | null;

	/** The child keys used to traverse the tree. */
	readonly visitorKeys: VisitorKeys;

	/** The source split into lines per ECMA-262. Frozen. */
	readonly lines: readonly string[];

	/** The character offset each line starts at. */
	readonly lineStartIndices: readonly number[];

	/** Tokens and comments merged into one source-ordered array. */
	readonly tokensAndComments: readonly (Token | Comment)[];

	/**
	 * The source text of a node, optionally with surrounding characters.
	 * With no argument, the whole file.
	 */
	getText(
		node?: NodeOrToken,
		beforeCount?: number,
		afterCount?: number,
	): string;

	/** The source split into lines. */
	getLines(): string[];

	/** Every comment in the file. */
	getAllComments(): Comment[];

	/** The innermost node containing a character offset, or `null`. */
	getNodeByRangeIndex(index: number): ASTNode | null;

	/** Whether only whitespace separates two nodes or tokens. */
	isSpaceBetween(first: NodeOrToken, second: NodeOrToken): boolean;

	/** The line/column for a character offset. */
	getLocFromIndex(index: number): Position;

	/** The character offset for a line/column. */
	getIndexFromLoc(loc: Position): number;

	/** The innermost scope for a node. */
	getScope(currentNode: ASTNode): Scope;

	/** The variables a declaration node introduces. */
	getDeclaredVariables(node: ASTNode): Variable[];

	/** A node's ancestors, outermost first. */
	getAncestors(node: ASTNode): ASTNode[];

	/** Whether an identifier resolves to an unshadowed global. */
	isGlobalReference(node: ASTNode): boolean;

	/** A node's or token's location. */
	getLoc(nodeOrToken: NodeOrToken): SourceLocation;

	/** A node's or token's range. */
	getRange(nodeOrToken: NodeOrToken): SourceRange;

	/** Marks a variable as used, so `no-unused-vars` ignores it. */
	markVariableAsUsed(name: string, refNode?: ASTNode): boolean;

	/** The comments that carry inline configuration. */
	getInlineConfigNodes(): Comment[];

	/** The inline enable/disable directives, and any problems parsing them. */
	getDisableDirectives(): DisableDirectivesResult;

	/** Applies the run's language options. Mutates the scope analysis. */
	applyLanguageOptions(languageOptions: LanguageOptions): void;

	/**
	 * Collects the rule configuration from inline `eslint` comments.
	 *
	 * Grounding: `source-code.js:1044-1047` returns exactly this pair, and the
	 * `configs` entries are built at `:1009-1015`.
	 */
	applyInlineConfig(): {
		configs: { config: { rules: RulesRecord }; loc: SourceLocation }[];
		problems: InlineConfigProblem[];
	};

	/** Runs the checks that must happen after inline config is applied. */
	finalize(): void;

	/** The traversal steps for this file, computed once and cached. */
	traverse(): Iterable<TraversalStep>;

	// --- token store ---------------------------------------------------------

	/** The token starting at an offset, or `null`. */
	getTokenByRangeStart(
		offset: number,
		options?: { includeComments?: boolean },
	): Token | Comment | null;

	getFirstToken(
		node: NodeOrToken,
		options?: SkipOptions,
	): Token | Comment | null;
	getLastToken(
		node: NodeOrToken,
		options?: SkipOptions,
	): Token | Comment | null;
	getTokenBefore(
		node: NodeOrToken,
		options?: SkipOptions,
	): Token | Comment | null;
	getTokenAfter(
		node: NodeOrToken,
		options?: SkipOptions,
	): Token | Comment | null;

	getFirstTokenBetween(
		left: NodeOrToken,
		right: NodeOrToken,
		options?: SkipOptions,
	): Token | Comment | null;
	getLastTokenBetween(
		left: NodeOrToken,
		right: NodeOrToken,
		options?: SkipOptions,
	): Token | Comment | null;

	getFirstTokens(
		node: NodeOrToken,
		options?: CountOptions,
	): (Token | Comment)[];
	getLastTokens(
		node: NodeOrToken,
		options?: CountOptions,
	): (Token | Comment)[];
	getTokensBefore(
		node: NodeOrToken,
		options?: CountOptions,
	): (Token | Comment)[];
	getTokensAfter(
		node: NodeOrToken,
		options?: CountOptions,
	): (Token | Comment)[];

	getFirstTokensBetween(
		left: NodeOrToken,
		right: NodeOrToken,
		options?: CountOptions,
	): (Token | Comment)[];
	getLastTokensBetween(
		left: NodeOrToken,
		right: NodeOrToken,
		options?: CountOptions,
	): (Token | Comment)[];

	/**
	 * Every token in a node. The numeric second and third arguments are the
	 * deprecated padding form the implementation still accepts
	 * (`token-store/index.js:586`).
	 */
	getTokens(
		node: NodeOrToken,
		beforeCount?: CountOptions,
		afterCount?: number,
	): (Token | Comment)[];

	getTokensBetween(
		left: NodeOrToken,
		right: NodeOrToken,
		padding?: CountOptions,
	): (Token | Comment)[];

	/** Whether any comment sits between two nodes or tokens. */
	commentsExistBetween(left: NodeOrToken, right: NodeOrToken): boolean;

	getCommentsBefore(nodeOrToken: NodeOrToken): Comment[];
	getCommentsAfter(nodeOrToken: NodeOrToken): Comment[];
	getCommentsInside(node: ASTNode): Comment[];
}

// -----------------------------------------------------------------------------
// Rules — fixes and reports
// -----------------------------------------------------------------------------

/**
 * A fix as a rule's `fix` function returns it.
 *
 * The same `{ range, text }` shape as `Fix`, which is what survives onto the
 * `LintMessage`: `cloneFix` (`lib/linter/file-report.js:172-181`) copies those
 * two fields and nothing else. The alias exists because the two ends of that
 * pipeline are named separately everywhere else in ESLint's surface.
 */
export type RuleFix = Fix;

/**
 * The object a rule's `fix` function is handed.
 *
 * Grounding: `lib/linter/rule-fixer.js`, which is the complete surface — every
 * method there is listed here and nothing else is.
 */
export interface RuleFixer {
	/** Inserts text after a node or token. */
	insertTextAfter(nodeOrToken: NodeOrToken, text: string): RuleFix;

	/** Inserts text after a range. */
	insertTextAfterRange(range: SourceRange, text: string): RuleFix;

	/** Inserts text before a node or token. */
	insertTextBefore(nodeOrToken: NodeOrToken, text: string): RuleFix;

	/** Inserts text before a range. */
	insertTextBeforeRange(range: SourceRange, text: string): RuleFix;

	/** Replaces a node or token with text. */
	replaceText(nodeOrToken: NodeOrToken, text: string): RuleFix;

	/** Replaces a range with text. */
	replaceTextRange(range: SourceRange, text: string): RuleFix;

	/** Removes a node or token. */
	remove(nodeOrToken: NodeOrToken): RuleFix;

	/** Removes a range. */
	removeRange(range: SourceRange): RuleFix;
}

/**
 * The `fix` callback on a report descriptor.
 *
 * The iterable return is real rather than defensive: `normalizeFixes`
 * (`file-report.js:262-278`) tests `Symbol.iterator in fix` and merges, so
 * arrays and generator functions are both supported. Returning a falsy value
 * means "no fix" and is how a fixer declines after inspecting the source.
 */
export type ReportFixer = (
	fixer: RuleFixer,
) => RuleFix | Iterable<RuleFix> | null | undefined;

/**
 * Data interpolated into a message template.
 *
 * Grounding: `lib/linter/interpolate.js` stringifies whatever it is given, so
 * the values are deliberately `unknown` rather than `string`.
 */
export type ReportData = Record<string, unknown>;

/**
 * One entry in a report's `suggest` array.
 *
 * `desc` and `messageId` are mutually exclusive and one is required:
 * `validateSuggestions` (`file-report.js:367-403`) throws for both and for
 * neither. `fix` is required there too — a suggestion without one throws rather
 * than being dropped.
 */
export type SuggestionDescriptor = {
	/** Values to interpolate into the description. */
	data?: ReportData;

	/** The edit this suggestion would apply. Required. */
	fix: ReportFixer;
} & ({ desc: string; messageId?: never } | { messageId: string; desc?: never });

/**
 * The message half of a report descriptor: exactly one of `message` or
 * `messageId`.
 *
 * Grounding: `computeMessageFromDescriptor` (`file-report.js:412-441`) throws
 * when both are present and throws when neither is.
 */
export type ReportMessage =
	| { message: string; messageId?: never }
	| { messageId: string; message?: never };

/**
 * The target half of a report descriptor: at least one of `node` or `loc`.
 *
 * Grounding: `assertValidNodeInfo` (`file-report.js:143-152`) requires a `loc`
 * when there is no `node`. `loc` may be a bare `Position`, which
 * `normalizeReportLoc` (`:160-165`) widens to `{ start: loc, end: null }`.
 */
export type ReportTarget =
	| { node: ASTNode; loc?: SourceLocation | Position }
	| { node?: ASTNode; loc: SourceLocation | Position };

/** The optional parts of a report descriptor. */
export interface ReportOptions {
	/** Values to interpolate into the message. */
	data?: ReportData;

	/** Produces the autofix. */
	fix?: ReportFixer | null;

	/** Produces the suggestions. */
	suggest?: SuggestionDescriptor[] | null;
}

/**
 * The single argument form of `context.report()`.
 */
export type ReportDescriptor = ReportMessage & ReportTarget & ReportOptions;

// -----------------------------------------------------------------------------
// Rules — definition and context
// -----------------------------------------------------------------------------

/**
 * A JSON Schema fragment, as `meta.schema` holds it.
 *
 * Deliberately open: `Config.getRuleOptionsSchema` (`lib/config/config.js:170`)
 * hands the value straight to Ajv, so ESLint itself never constrains its shape
 * beyond the array / object / `false` distinction below.
 */
export type JSONSchema = Record<string, unknown>;

/**
 * The `meta.schema` value.
 *
 * An array is positional per-option schemas, an object is a whole-options
 * schema, and `false` opts out of validation entirely — an explicit, supported
 * value, not an omission (`config.js:181-184`).
 */
export type RuleOptionsSchema = JSONSchema | JSONSchema[] | false;

/**
 * A rule's documentation metadata.
 *
 * Grounding: `lib/rules/*.js` `meta.docs` blocks, plus `linter.js:513-521`,
 * which reads `meta.docs.suggestion` only to produce a migration error.
 */
export interface RuleDocs {
	/** One-line description of what the rule enforces. */
	description?: string;

	/** Whether the rule is in the `recommended` config. */
	recommended?: boolean;

	/** Link to the rule's documentation page. */
	url?: string;

	/** The former name of `meta.hasSuggestions`. Ignored, and an error to set. */
	suggestion?: boolean;

	/** Rules may carry extra documentation keys. */
	[key: string]: unknown;
}

/**
 * A rule's metadata.
 *
 * Every property is optional because `meta` itself is optional — `config.js:171`
 * and `linter.js:502` both guard for its absence.
 */
export interface RuleMeta {
	/** The category of problem the rule reports. */
	type?: "problem" | "suggestion" | "layout";

	/** Documentation metadata. */
	docs?: RuleDocs;

	/**
	 * What the rule's autofix changes. A rule that reports a `fix` without
	 * setting this throws (`linter.js:502-506`).
	 */
	fixable?: "code" | "whitespace" | null;

	/**
	 * Whether the rule provides suggestions. A rule that reports `suggestions`
	 * without setting this to `true` throws (`linter.js:508-525`).
	 */
	hasSuggestions?: boolean;

	/** The schema for the rule's options. */
	schema?: RuleOptionsSchema;

	/** Message templates, keyed by `messageId`. */
	messages?: Record<string, string>;

	/**
	 * Option values merged under the configured ones.
	 * Grounding: `getRuleOptions` (`linter.js:359-364`) via `deepMergeArrays`.
	 */
	defaultOptions?: readonly unknown[];

	/**
	 * The languages the rule supports, as `plugin/language` identifiers with
	 * `*` wildcards. Absent means "all languages".
	 * Grounding: `doesRuleSupportLanguage` (`config.js:243-292`) and the
	 * structural validation at `config.js:682-694`.
	 */
	languages?: string[];

	/** Deprecation metadata, or `true` for the bare legacy form. */
	deprecated?: boolean | DeprecatedInfo;

	/** The legacy replacement list, superseded by `deprecated.replacedBy`. */
	replacedBy?: string[];

	/** Rules may carry extra metadata keys. */
	[key: string]: unknown;
}

/**
 * The listener map a rule's `create()` returns.
 *
 * Keys are esquery selectors — node types, `":exit"` suffixes, and full
 * selector syntax — so the index signature is `string` rather than a union of
 * node types. The handler is parameterised as `any[]` because the arguments
 * differ by listener family: node listeners receive a node, while the code-path
 * listeners (`onCodePathStart` and friends) receive a code path plus a node.
 * Narrowing that here would reject correct rules.
 */
export interface RuleListener {
	[selector: string]: ((...args: any[]) => void) | undefined;
}

/**
 * The object passed to a rule's `create()`.
 *
 * Grounding: `lib/linter/file-context.js` supplies the six shared properties,
 * and `linter.js:489-527` extends it per rule with `id`, `options` and
 * `report`. Everything is `readonly` because `FileContext` freezes itself
 * (`file-context.js:67`) and each rule's context is a frozen object with it as
 * prototype (`:78`).
 */
export interface RuleContext<
	Options extends readonly unknown[] = readonly unknown[],
> {
	/** The rule's ID, as configured. */
	readonly id: string;

	/** The configured options, with `meta.defaultOptions` merged under them. */
	readonly options: Options;

	/** The current working directory. */
	readonly cwd: string;

	/** The reported filename, which may be a virtual path for a code block. */
	readonly filename: string;

	/** The path of the file on disk, without any code-block suffix. */
	readonly physicalFilename: string;

	/** The parsed file. */
	readonly sourceCode: SourceCode;

	/** The language options this file was parsed with. */
	readonly languageOptions: LanguageOptions;

	/** The shared `settings` from the config. */
	readonly settings: SettingsRecord;

	/** Reports a problem. */
	report(descriptor: ReportDescriptor): void;

	/**
	 * Reports a problem, legacy positional form.
	 * Grounding: `normalizeMultiArgReportCall` (`file-report.js:111-136`)
	 * interprets `[node, message, data, fix]` when the second argument is a
	 * string.
	 */
	report(
		node: ASTNode,
		message: string,
		data?: ReportData,
		fix?: ReportFixer,
	): void;

	/**
	 * Reports a problem, legacy positional form with an explicit location.
	 * Grounding: the `[node, loc, message, data, fix]` branch of
	 * `normalizeMultiArgReportCall` (`file-report.js:129-135`).
	 */
	report(
		node: ASTNode,
		loc: SourceLocation | Position,
		message: string,
		data?: ReportData,
		fix?: ReportFixer,
	): void;
}

/**
 * A rule, in the only form ESLint accepts.
 *
 * `createRuleListeners` (`linter.js:399-407`) throws unless the value is an
 * object with a `create` method, so the historical bare-function form is NOT
 * modelled here — declaring it would describe a rule the linter rejects.
 */
export interface RuleDefinition<
	Options extends readonly unknown[] = readonly unknown[],
> {
	/** The rule's metadata. Optional; `config.js:171` guards for its absence. */
	meta?: RuleMeta;

	/** Builds the rule's listeners for one file. */
	create(context: RuleContext<Options>): RuleListener;
}

/**
 * A rule, under the name plugin authors know it by.
 *
 * ESLint's public documentation and most plugin ecosystems call this shape a
 * "rule module"; it is the same object `RuleDefinition` describes, and the
 * alias exists so consumers can use either name.
 */
export type RuleModule<
	Options extends readonly unknown[] = readonly unknown[],
> = RuleDefinition<Options>;

/**
 * Looks a rule up by ID. `undefined` when the rule is not configured.
 *
 * Grounding: the `ruleMapper` argument threaded through `runRules`
 * (`linter.js:439`, called at `:482`) and `FileReport` (`file-report.js:499`).
 */
export type RuleMapper = (ruleId: string) => RuleDefinition | undefined;

// -----------------------------------------------------------------------------
// Language options, parsers and processors
// -----------------------------------------------------------------------------

/**
 * How a global variable may be used.
 *
 * Grounding: `globalVariablesValues` in
 * `lib/languages/js/validate-language-options.js:12-23` is the complete set of
 * accepted values, aliases included.
 */
export type GlobalAccess =
	| "readonly"
	| "readable"
	| "writable"
	| "writeable"
	| "off"
	| true
	| "true"
	| false
	| "false"
	| null;

/** The `globals` map from a config's `languageOptions`. */
export type GlobalsRecord = Record<string, GlobalAccess>;

/**
 * The `ecmaVersion` a config may set, before normalization.
 *
 * `"latest"` is accepted alongside the numeric form
 * (`validate-language-options.js:70-73`) and is resolved to
 * `LATEST_ECMA_VERSION` by `normalizeEcmaVersionForLanguageOptions`
 * (`languages/js/index.js:72-95`), which is why `EcmaVersion` above stays
 * numeric.
 */
export type EcmaVersionOption = EcmaVersion | "latest";

/**
 * Optional syntax espree can be asked to accept.
 *
 * Grounding: read at `languages/js/index.js:42` and `:136-139`, and threaded
 * into `eslint-scope` at `:47-53`.
 */
export interface EcmaFeatures {
	/** Allow `return` at the top level. Forced off for `sourceType: "module"`. */
	globalReturn?: boolean;

	/** Parse as if `"use strict"` were present. */
	impliedStrict?: boolean;

	/** Parse JSX. */
	jsx?: boolean;

	/** Parsers may accept further feature flags. */
	[key: string]: unknown;
}

/**
 * The options handed to the parser.
 *
 * The four `loc` / `range` / `tokens` / `comment` flags are listed as
 * non-optional `true` because `languages/js/index.js:241-249` overrides
 * whatever the config said — a config cannot turn them off, and the whole node
 * vocabulary above depends on that.
 */
export interface ParserOptions {
	/** Always `true`: ESLint forces it. */
	loc: true;

	/** Always `true`: ESLint forces it. */
	range: true;

	/** Always `true`: ESLint forces it. */
	tokens: true;

	/** Always `true`: ESLint forces it. */
	comment: true;

	/** The ECMAScript version to parse. */
	ecmaVersion?: EcmaVersionOption;

	/** How to treat the file's top level. */
	sourceType?: SourceType;

	/** Optional syntax to accept. */
	ecmaFeatures?: EcmaFeatures;

	/** The path of the file being parsed. */
	filePath?: string;

	/** Parsers accept their own options. */
	[key: string]: unknown;
}

/**
 * How a file's top level is treated.
 *
 * Grounding: `validate-language-options.js:83` accepts exactly these three.
 */
export type SourceType = "script" | "module" | "commonjs";

/**
 * What a parser's `parseForESLint()` returns.
 *
 * Only `ast` is required: `languages/js/index.js:267-272` defaults
 * `services` to `{}` and `visitorKeys` to `evk.KEYS`, and treats a missing
 * `scopeManager` as "analyse the scope yourself" (`:313-315`).
 */
export interface ParserParseResult {
	/** The parsed tree. */
	ast: Program;

	/** Values to expose on `sourceCode.parserServices`. */
	services?: ParserServices;

	/** The child keys for traversing this tree. */
	visitorKeys?: VisitorKeys;

	/** A pre-computed scope analysis. */
	scopeManager?: ScopeManager;
}

/**
 * A parser.
 *
 * Both methods are optional but at least one must be present:
 * `validateParser` (`validate-language-options.js:125-131`) rejects a parser
 * with neither, and `languages/js/index.js:261-263` prefers `parseForESLint`.
 */
export interface Parser {
	/** Parses text into a tree. */
	parse?(text: string, options: ParserOptions): Program;

	/** Parses text and returns the tree plus extras. */
	parseForESLint?(text: string, options: ParserOptions): ParserParseResult;

	/** Identifies the parser when a config is serialized. */
	meta?: ObjectMeta;
}

/**
 * The `languageOptions` of a resolved config.
 *
 * Grounding: `validate-language-options.js` validates exactly these five keys,
 * and `Config`'s constructor (`config.js:483-506`) merges, validates and
 * normalizes the object.
 */
export interface LanguageOptions {
	/** The ECMAScript version. */
	ecmaVersion?: EcmaVersionOption;

	/** How the file's top level is treated. */
	sourceType?: SourceType;

	/** Predefined global variables. */
	globals?: GlobalsRecord;

	/** The parser to use. */
	parser?: Parser;

	/** Options forwarded to the parser. */
	parserOptions?: Record<string, unknown>;

	/** Non-JS languages define their own option keys. */
	[key: string]: unknown;
}

/**
 * The `meta` block by which ESLint identifies a plugin, processor, parser or
 * language when serializing a config.
 *
 * Grounding: `getObjectId` (`config.js:300-330`) reads `name`/`version` from
 * the object itself first and falls back to `meta.name`/`meta.version`.
 */
export interface ObjectMeta {
	/** The object's name. */
	name?: string;

	/** The object's version. */
	version?: string;

	/** The default namespace a plugin's rules are addressed under. */
	namespace?: string;
}

/**
 * A processor, which extracts lintable blocks out of a non-JS file and maps
 * the resulting messages back.
 *
 * Grounding: destructured at `linter.js:1307` and defaulted at `:805-807`,
 * which is why both callbacks are optional — a processor that supplies neither
 * is legal and behaves as a passthrough.
 */
export interface Processor {
	/** Splits a file into lintable blocks. */
	preprocess?(
		text: string,
		filename: string,
	): (string | { text: string; filename: string })[];

	/** Merges the per-block messages back into one list. */
	postprocess?(messages: LintMessage[][], filename: string): LintMessage[];

	/**
	 * Whether fixes may be applied to the extracted blocks. When falsy the
	 * linter disables fixes for the file (`linter.js:1309`).
	 */
	supportsAutofix?: boolean;

	/** Identifies the processor when a config is serialized. */
	meta?: ObjectMeta;
}

// -----------------------------------------------------------------------------
// Languages
// -----------------------------------------------------------------------------

/**
 * A file as the language layer sees it.
 *
 * Grounding: `lib/linter/vfile.js:100-104`.
 */
export interface VirtualFile {
	/** The reported path. */
	path: string;

	/** The path on disk. */
	physicalPath: string;

	/** The source text with any BOM stripped. */
	body: string;

	/** The source text as read. */
	rawBody: string;

	/** Whether the source began with a Unicode BOM. */
	bom: boolean;
}

/**
 * What a language's `parse()` returns.
 *
 * Discriminated on `ok`, matching `languages/js/index.js:274-297`. A parse
 * failure is a value here rather than an exception — the linter turns it into a
 * fatal `LintMessage`.
 */
export type LanguageParseResult =
	| {
			ok: true;
			ast: Program;
			parserServices: ParserServices;
			visitorKeys: VisitorKeys;
			scopeManager?: ScopeManager;
	  }
	| {
			ok: false;
			errors: {
				message: string;
				line?: number;
				column?: number;
			}[];
	  };

/**
 * A language plugin: everything ESLint needs to lint one kind of file.
 *
 * Grounding: `lib/languages/js/index.js` is the reference implementation and
 * defines every member below. `columnStart` and `lineStart` are read by
 * `file-report.js:47-48` and `:327-328` to normalize a language's own indexing
 * onto ESLint's one-based reporting.
 */
export interface Language {
	/** Whether the language is text- or binary-shaped. */
	fileType: "text" | "binary";

	/** The index the language numbers lines from. */
	lineStart: 0 | 1;

	/** The index the language numbers columns from. */
	columnStart: 0 | 1;

	/** The node property that holds the node's kind. */
	nodeTypeKey: string;

	/** The child keys for traversing this language's trees. */
	visitorKeys?: VisitorKeys;

	/** The language options applied before the config's own. */
	defaultLanguageOptions?: LanguageOptions;

	/** Rejects invalid language options. Throws rather than returning. */
	validateLanguageOptions(languageOptions: LanguageOptions): void;

	/** Canonicalizes the merged language options. */
	normalizeLanguageOptions?(
		languageOptions: LanguageOptions,
	): LanguageOptions;

	/**
	 * Whether a node belongs to an esquery selector class such as
	 * `:statement`. Throws for an unknown class name
	 * (`languages/js/index.js:218-219`).
	 */
	matchesSelectorClass?(
		className: string,
		node: ASTNode,
		ancestry: ASTNode[],
	): boolean;

	/** Parses a file. */
	parse(
		file: VirtualFile,
		context: { languageOptions: LanguageOptions },
	): LanguageParseResult;

	/** Builds the `SourceCode` for a successful parse. */
	createSourceCode(
		file: VirtualFile,
		parseResult: LanguageParseResult,
		context: { languageOptions: LanguageOptions },
	): SourceCode;

	/** Identifies the language when a config is serialized. */
	meta?: ObjectMeta;
}

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/**
 * A rule's configuration: a severity, optionally followed by its options.
 */
export type RuleEntry = Severity | [Severity, ...unknown[]];

/** The `rules` block of a config. */
export type RulesRecord = Record<string, RuleEntry>;

/**
 * The `settings` block, shared verbatim with every rule.
 *
 * Merged by `deepObjectAssignSchema`
 * (`lib/config/flat-config-schema.js:319-328`), which never inspects the
 * values, so they stay `unknown`.
 */
export type SettingsRecord = Record<string, unknown>;

/**
 * A plugin.
 *
 * Grounding: `config.js` looks up `plugins[name].rules`
 * (`getRuleFromConfig`, `:161`), `.languages` (`:472-473`) and `.processors`
 * (`:521-522`); `getObjectId` reads `meta` (`:305`). All four are optional
 * because a plugin may contribute only one of them.
 */
export interface Plugin {
	/** Identifies the plugin, and supplies its default namespace. */
	meta?: ObjectMeta;

	/** The rules the plugin contributes, keyed by their bare names. */
	rules?: Record<string, RuleDefinition>;

	/** The processors the plugin contributes. */
	processors?: Record<string, Processor>;

	/** The languages the plugin contributes. */
	languages?: Record<string, Language>;

	/** The shareable configs the plugin exports. */
	configs?: Record<string, ConfigArrayEntry>;
}

/**
 * The `linterOptions` block.
 *
 * Grounding: `flatConfigSchema.linterOptions`
 * (`lib/config/flat-config-schema.js:558-564`) declares exactly these three.
 */
export interface LinterOptions {
	/** Whether to ignore inline configuration comments. */
	noInlineConfig?: boolean;

	/** How to report `eslint-disable` comments that suppressed nothing. */
	reportUnusedDisableDirectives?: Severity | boolean;

	/** How to report inline configs that changed nothing. */
	reportUnusedInlineConfigs?: Severity;
}

/**
 * A `files` or `ignores` entry: a glob, or a predicate over the path.
 *
 * Structurally identical to `@eslint/config-array`'s own `FileMatcher`, which
 * is the boundary `FlatConfigArray` (`lib/config/flat-config-array.js:78`)
 * inherits its matching from.
 */
export type FileMatcher = string | ((filePath: string) => boolean);

/**
 * One entry of a config's `files` array. A nested array means every matcher in
 * it must match.
 */
export type FilesMatcher = FileMatcher | FileMatcher[];

/**
 * A single configuration object, as it appears in `eslint.config.js`.
 *
 * The index signature is not laziness — it is what the implementation does.
 * `Config`'s constructor copies every unrecognised key onto itself
 * (`config.js:441-450`), and `@eslint/config-array`'s own `ConfigObject`
 * carries the same signature. Without it this type would not be assignable at
 * the `@eslint/config-array` boundary, because TypeScript does not give an
 * interface an implicit index signature.
 */
export interface ConfigObject {
	/** A label for the config object, used in error messages. */
	name?: string;

	/** The directory `files` and `ignores` are resolved against. */
	basePath?: string;

	/** Which files this config applies to. */
	files?: FilesMatcher[];

	/** Which files this config does not apply to. */
	ignores?: FileMatcher[];

	/** The language to lint matching files with, as `plugin/language`. */
	language?: string;

	/** Options for the language. */
	languageOptions?: LanguageOptions;

	/** Options for the linter itself. */
	linterOptions?: LinterOptions;

	/** The processor to run over matching files. */
	processor?: string | Processor;

	/** The plugins whose rules, languages and processors are in scope. */
	plugins?: Record<string, Plugin>;

	/** The rules to run, and at what severity. */
	rules?: RulesRecord;

	/** Arbitrary data shared with every rule. */
	settings?: SettingsRecord;

	/** Configs may carry keys ESLint does not know about. */
	[key: string]: unknown;
}

/**
 * An entry of the array a config file exports.
 *
 * Nested arrays and functions are both real: `FlatConfigArray` passes
 * `extraConfigTypes: ["array", "function"]` to `@eslint/config-array`
 * (`lib/config/flat-config-array.js`), which flattens the first and calls the
 * second during `normalize()`.
 */
export type ConfigArrayEntry =
	| ConfigObject
	| ConfigArrayEntry[]
	| ((
			context: Record<string, unknown>,
	  ) => ConfigArrayEntry | Promise<ConfigArrayEntry>);

/**
 * A config after `@eslint/config-array` has merged every matching
 * `ConfigObject` and `Config`'s constructor has resolved it.
 *
 * The differences from `ConfigObject` are all resolutions, and each is grounded
 * in the constructor (`lib/config/config.js:440-546`): `language` and
 * `processor` become the objects the plugin supplied rather than the
 * identifiers that named them (`:480-481`, `:529-533`), `languageOptions` is
 * merged with the language's defaults and normalized (`:483-506`), and `rules`
 * has been severity-normalized and validated (`:542-545`).
 *
 * The carried-over members are spelled out rather than derived with
 * `Omit<ConfigObject, …>`. That derivation looks tidier and is wrong here:
 * `keyof ConfigObject` is `string | number` because of the index signature, so
 * `Exclude` removes nothing and `Omit` collapses the whole type to bare index
 * signatures — `config.name` would silently be `unknown`. Verified with the
 * compiler; a test pins it.
 */
export interface Config {
	/** A label for the config object, used in error messages. */
	name?: string;

	/** The directory `files` and `ignores` are resolved against. */
	basePath?: string;

	/** Which files this config applies to. */
	files?: FilesMatcher[];

	/** Which files this config does not apply to. */
	ignores?: FileMatcher[];

	/** The plugins whose rules, languages and processors are in scope. */
	plugins?: Record<string, Plugin>;

	/** Options for the linter itself. */
	linterOptions?: LinterOptions;

	/** Arbitrary data shared with every rule. */
	settings?: SettingsRecord;

	/** The resolved language object. */
	language: Language;

	/** The merged, validated and normalized language options. */
	languageOptions: LanguageOptions;

	/** The resolved processor, when the config named one. */
	processor?: Processor;

	/** The normalized rules configuration. */
	rules?: RulesRecord;

	/** Looks up a rule definition through this config's plugins. */
	getRuleDefinition(ruleId: string): RuleDefinition | undefined;

	/** Rejects an invalid rules block. Throws rather than returning. */
	validateRulesConfig(rulesConfig: RulesRecord): void;

	/** The JSON-serializable form, used for config hashing and `--print-config`. */
	toJSON(): Record<string, unknown>;

	/**
	 * Unrecognised config keys are copied onto the instance verbatim
	 * (`config.js:450`), so the index signature is part of the contract.
	 */
	[key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------------

/**
 * The rule metadata a formatter can reach, keyed by rule ID.
 *
 * Grounding: `createRulesMeta` (`lib/eslint/eslint.js:90-95`) builds exactly
 * this map from the rules a run used.
 */
export type RulesMetaRecord = Record<string, RuleMeta | undefined>;

/**
 * The second argument every formatter receives.
 *
 * Grounding: assembled at `lib/eslint/eslint.js:1282-1292` by spreading the
 * `resultsMeta` the CLI built (`lib/cli.js:451-469`) and adding `cwd` and a
 * lazy `rulesMeta` getter. `color` and `maxWarningsExceeded` are optional
 * because the CLI only sets them conditionally.
 */
export interface FormatterContext {
	/** The current working directory. */
	cwd: string;

	/**
	 * Metadata for every rule the run used. Computed on first access — reading
	 * it is not free.
	 */
	readonly rulesMeta: RulesMetaRecord;

	/** Whether to colorize output. Absent when neither flag was passed. */
	color?: boolean;

	/** Present only when `--max-warnings` was exceeded. */
	maxWarningsExceeded?: {
		maxWarnings: number;
		foundWarnings: number;
	};
}

/**
 * A formatter.
 *
 * Formatters are loaded by name at runtime and their contract exists only as
 * the shape `loadFormatter` calls (`lib/eslint/eslint.js:1262-1292`): the
 * module's default export must be a function — `loadFormatter` throws a
 * `TypeError` otherwise — and it is called with the sorted results and the
 * context above. It may be async, since the CLI awaits its return
 * (`lib/cli.js:114`).
 *
 * The built-in formatters demonstrate both arities: `json.js` takes only
 * `results`, while `stylish.js` and `json-with-metadata.js` take both.
 */
export type Formatter = (
	results: LintResult[],
	context: FormatterContext,
) => string | Promise<string>;

/**
 * The object `ESLint#loadFormatter()` resolves to.
 *
 * Grounding: `lib/eslint/eslint.js:1270-1294` returns exactly this wrapper,
 * which sorts the results by path before delegating to the loaded formatter.
 */
export interface LoadedFormatter {
	/** Formats the results. */
	format(
		results: LintResult[],
		resultsMeta?: Partial<FormatterContext>,
	): string | Promise<string>;
}

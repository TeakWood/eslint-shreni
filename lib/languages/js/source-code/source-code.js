// @ts-check
/**
 * @fileoverview Abstraction of JavaScript source code.
 * @author Nicholas C. Zakas
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const TokenStore = require("./token-store"),
	astUtils = require("../../../shared/ast-utils"),
	Traverser = require("../../../shared/traverser"),
	globals = require("../../../../conf/globals"),
	{ directivesPattern } = require("../../../shared/directives"),
	CodePathAnalyzer = require("../../../linter/code-path-analysis/code-path-analyzer"),
	{
		ConfigCommentParser,
		VisitNodeStep,
		CallMethodStep,
		Directive,
	} = require("@eslint/plugin-kit");

//------------------------------------------------------------------------------
// Type Definitions
//------------------------------------------------------------------------------

/** @typedef {import("./token-store/utils.js").Token} Token */
/** @typedef {import("../../../shared/traverser.js").TraversableNode} TraversableNode */
/** @typedef {import("eslint-scope").ScopeManager} ScopeManager */
/** @typedef {import("eslint-scope").Scope} Scope */
/** @typedef {import("eslint-visitor-keys").VisitorKeys} VisitorKeys */
/** @typedef {import("@eslint/plugin-kit").SourceLocation} SourceLocation */
/** @typedef {import("@eslint/plugin-kit").TraversalStep} TraversalStep */
/** @typedef {import("../../../shared/types.js").GlobalConf} GlobalConf */
/** @typedef {import("../../../shared/types.js").RulesConfig} RulesConfig */
/** @typedef {import("../index.js").NormalizedJSLanguageOptions} NormalizedJSLanguageOptions */

/**
 * An AST node or token.
 *
 * `SourceCode` locates everything by `range`, and a custom parser may return
 * any AST, so this is the open shape the token store already works with — the
 * same reasoning as `TraversableNode` in `lib/shared/traverser.js`.
 * @typedef {Token} ASTNode
 */

/**
 * The root of the AST, carrying the members `validate()` requires.
 * @typedef {ASTNode & { tokens: Token[], comments: Token[], loc: SourceLocation }} ProgramNode
 */

/**
 * An `eslint-scope` variable with the extra flags ESLint assigns to it.
 *
 * `eslint-scope` declares none of these: ESLint sets them on the variables the
 * analyzer produced and rules such as `no-unused-vars` read them back, so the
 * declared `Variable` is only ever seen through this view here.
 * @typedef {import("eslint-scope").Variable & { eslintUsed?: boolean, eslintExported?: boolean, eslintExplicitGlobal?: boolean, eslintImplicitGlobalSetting?: GlobalConf, eslintExplicitGlobalComments?: Token[], writeable?: boolean }} ESLintVariable
 */

/**
 * A directive comment that `ConfigCommentParser` successfully parsed.
 * `@eslint/plugin-kit` does not export the class, so the type is read off the
 * method that returns it.
 * @typedef {NonNullable<ReturnType<import("@eslint/plugin-kit").ConfigCommentParser["parseDirective"]>>} ParsedDirective
 */

/**
 * A problem found while reading the inline configuration, reported as a
 * message with no rule behind it.
 * @typedef {{ ruleId: null, message: string, loc: SourceLocation }} InlineConfigProblem
 */

/**
 * A rules configuration found in an `/* eslint *\/` comment.
 * @typedef {{ config: { rules: RulesConfig }, loc: SourceLocation }} InlineConfigElement
 */

/**
 * A global declared by a `/* globals *\/` comment, and the comments that
 * declared it.
 * @typedef {{ comments: Token[], value: GlobalConf }} InlineGlobal
 */

/**
 * The object `traverse()` feeds nodes and code-path events to: either the step
 * collector it builds inline or a `CodePathAnalyzer` wrapping that collector.
 * @typedef {Object} TraversalAnalyzer
 * @property {(node: TraversableNode) => void} enterNode Called on entering a node.
 * @property {(node: TraversableNode) => void} leaveNode Called on leaving a node.
 * @property {(eventName: string, args: any[]) => void} emit Called for a code-path event.
 */

/**
 * The object form of the `SourceCode` constructor's first argument.
 * @typedef {Object} SourceCodeConfig
 * @property {string} text The source code text.
 * @property {ProgramNode} ast The Program node of the AST representing the code. This AST should be created from the text that BOM was stripped.
 * @property {boolean} [hasBOM] Indicates if the text has a Unicode BOM.
 * @property {Record<string, any>} [parserServices] The parser services.
 * @property {ScopeManager} [scopeManager] The scope of this source code.
 * @property {VisitorKeys} [visitorKeys] The visitor keys to traverse AST.
 */

//------------------------------------------------------------------------------
// Private
//------------------------------------------------------------------------------

const commentParser = new ConfigCommentParser();

/**
 * Validates that the given AST has the required information.
 * @param {ProgramNode | undefined} ast The Program node of the AST to check.
 * @returns {asserts ast is ProgramNode} Nothing; returning at all asserts that the AST is a usable program node.
 * @throws If the AST doesn't contain the correct information.
 * @private
 */
function validate(ast) {
	if (!ast) {
		throw new TypeError(`Unexpected empty AST. (${ast})`);
	}

	if (!ast.tokens) {
		throw new TypeError("AST is missing the tokens array.");
	}

	if (!ast.comments) {
		throw new TypeError("AST is missing the comments array.");
	}

	if (!ast.loc) {
		throw new TypeError("AST is missing location information.");
	}

	if (!ast.range) {
		throw new TypeError("AST is missing range information");
	}
}

/**
 * Retrieves globals for the given ecmaVersion.
 * @param {number} ecmaVersion The version to retrieve globals for.
 * @returns {Record<string, GlobalConf>} The globals for the given ecmaVersion.
 */
function getGlobalsForEcmaVersion(ecmaVersion) {
	/*
	 * `conf/globals.js` exports one set of globals per ECMAScript year under an
	 * `es<year>` key. The module's own type names those keys individually, so
	 * the computed lookups below need the view.
	 */
	const globalsByYear =
		/** @type {Record<string, Record<string, GlobalConf>>} */ (globals);

	switch (ecmaVersion) {
		case 3:
			return globals.es3;

		case 5:
			return globals.es5;

		default:
			if (ecmaVersion < 2015) {
				return globalsByYear[`es${ecmaVersion + 2009}`];
			}

			return globalsByYear[`es${ecmaVersion}`];
	}
}

/**
 * Merges two sorted lists into a larger sorted list in O(n) time.
 * @param {Token[]} tokens The list of tokens.
 * @param {Token[]} comments The list of comments.
 * @returns {Token[]} A sorted list of tokens and comments.
 * @private
 */
function sortedMerge(tokens, comments) {
	/** @type {Token[]} */
	const result = [];
	let tokenIndex = 0;
	let commentIndex = 0;

	while (tokenIndex < tokens.length || commentIndex < comments.length) {
		if (
			commentIndex >= comments.length ||
			(tokenIndex < tokens.length &&
				tokens[tokenIndex].range[0] < comments[commentIndex].range[0])
		) {
			result.push(tokens[tokenIndex++]);
		} else {
			result.push(comments[commentIndex++]);
		}
	}

	return result;
}

/**
 * Normalizes a value for a global in a config
 * @param {unknown} configuredValue The value given for a global in configuration or in
 * a global directive comment
 * @returns {"off" | "readonly" | "writable"} The value normalized as a string
 * @throws if global value is invalid
 */
function normalizeConfigGlobal(configuredValue) {
	switch (configuredValue) {
		case "off":
			return "off";

		case true:
		case "true":
		case "writeable":
		case "writable":
			return "writable";

		case null:
		case false:
		case "false":
		case "readable":
		case "readonly":
			return "readonly";

		default:
			throw new Error(
				`'${configuredValue}' is not a valid configuration for a global (use 'readonly', 'writable', or 'off')`,
			);
	}
}

/**
 * Determines if two nodes or tokens overlap.
 * @param {ASTNode} first The first node or token to check.
 * @param {ASTNode} second The second node or token to check.
 * @returns {boolean} True if the two nodes or tokens overlap.
 * @private
 */
function nodesOrTokensOverlap(first, second) {
	return (
		(first.range[0] <= second.range[0] &&
			first.range[1] >= second.range[0]) ||
		(second.range[0] <= first.range[0] && second.range[1] >= first.range[0])
	);
}

/**
 * Performs binary search to find the line number containing a given character index.
 * Returns the lower bound - the index of the first element greater than the target.
 * **Please note that the `lineStartIndices` should be sorted in ascending order**.
 * - Time Complexity: O(log n) - Significantly faster than linear search for large files.
 * @param {number[]} lineStartIndices Sorted array of line start indices.
 * @param {number} target The character index to find the line number for.
 * @returns {number} The 1-based line number for the target index.
 * @private
 */
function findLineNumberBinarySearch(lineStartIndices, target) {
	let low = 0;
	let high = lineStartIndices.length;

	while (low < high) {
		const mid = ((low + high) / 2) | 0; // Use bitwise OR to floor the division

		if (target < lineStartIndices[mid]) {
			high = mid;
		} else {
			low = mid + 1;
		}
	}

	return low;
}

//-----------------------------------------------------------------------------
// Directive Comments
//-----------------------------------------------------------------------------

/**
 * Ensures that variables representing built-in properties of the Global Object,
 * and any globals declared by special block comments, are present in the global
 * scope.
 * @param {ScopeManager} scopeManager Scope manager.
 * @param {Record<string, GlobalConf>} [configGlobals] The globals declared in configuration
 * @param {Record<string, InlineGlobal>} [inlineGlobals] The globals declared in the source code
 * @returns {void}
 */
function addDeclaredGlobals(
	scopeManager,
	configGlobals = Object.create(null),
	inlineGlobals = Object.create(null),
) {
	/*
	 * `__proto__: null` keeps inherited keys out of the map, but it also makes
	 * tsc type the literal as having only that one member — an object literal
	 * does not carry over the index signature of what is spread into it — so
	 * the keyed reads below go through a view.
	 */
	const finalGlobals = /** @type {Record<string, GlobalConf>} */ (
		/** @type {unknown} */ ({ __proto__: null, ...configGlobals })
	);

	for (const [name, data] of Object.entries(inlineGlobals)) {
		finalGlobals[name] = data.value;
	}

	const names = Object.keys(finalGlobals).filter(
		name => finalGlobals[name] !== "off",
	);

	scopeManager.addGlobals(names);

	const globalScope = scopeManager.scopes[0];

	for (const name of names) {
		/*
		 * `addGlobals()` above defined every one of these names in the global
		 * scope, so the lookup cannot miss.
		 */
		const variable = /** @type {ESLintVariable} */ (
			globalScope.set.get(name)
		);

		variable.eslintImplicitGlobalSetting = configGlobals[name];
		variable.eslintExplicitGlobal = !!inlineGlobals[name];
		variable.eslintExplicitGlobalComments = inlineGlobals[name]?.comments;
		variable.writeable = finalGlobals[name] === "writable";
	}
}

/**
 * Sets the given variable names as exported so they won't be triggered by
 * the `no-unused-vars` rule.
 * @param {Scope} globalScope The global scope to define exports in.
 * @param {Record<string, unknown>} variables An object whose keys are the variable
 *      names to export.
 * @returns {void}
 */
function markExportedVariables(globalScope, variables) {
	Object.keys(variables).forEach(name => {
		const variable = /** @type {ESLintVariable | undefined} */ (
			globalScope.set.get(name)
		);

		if (variable) {
			variable.eslintUsed = true;
			variable.eslintExported = true;
		}
	});
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

const caches = Symbol("caches");

/*
 * The `@implements` tag that used to sit on the doc comment below carried no
 * type, which tsc reads as an unresolved heritage clause rather than as
 * documentation. Naming `@eslint/core`'s `TextSourceCode` there is separate
 * work: it would commit this class to a shape neither the linter nor the rules
 * are annotated against yet.
 */

/**
 * Represents parsed source code.
 */
class SourceCode extends TokenStore {
	/**
	 * The cache of steps that were taken while traversing the source code.
	 * @type {TraversalStep[] | undefined}
	 */
	#steps;

	/**
	 * Creates a new instance.
	 * @param {string | SourceCodeConfig} textOrConfig The source code text, or the config object carrying it.
	 * @param {ProgramNode} [astIfNoConfig] The Program node of the AST representing the code, when the first argument is the text. This AST should be created from the text that BOM was stripped.
	 */
	constructor(textOrConfig, astIfNoConfig) {
		/** @type {string | undefined} */
		let text;

		/** @type {boolean | undefined} */
		let hasBOM;

		/** @type {ProgramNode | undefined} */
		let ast;

		/** @type {Record<string, any> | undefined} */
		let parserServices;

		/** @type {ScopeManager | undefined} */
		let scopeManager;

		/** @type {VisitorKeys | undefined} */
		let visitorKeys;

		// Process overloading of arguments
		if (typeof textOrConfig === "string") {
			text = textOrConfig;
			ast = astIfNoConfig;
			hasBOM = false;
		} else if (typeof textOrConfig === "object" && textOrConfig !== null) {
			text = textOrConfig.text;
			ast = textOrConfig.ast;
			hasBOM = textOrConfig.hasBOM;
			parserServices = textOrConfig.parserServices;
			scopeManager = textOrConfig.scopeManager;
			visitorKeys = textOrConfig.visitorKeys;
		}

		validate(ast);
		super(ast.tokens, ast.comments);

		/**
		 * General purpose caching for the class.
		 */
		this[caches] = /** @type {Map<string, any>} */ (
			new Map([
				["scopes", new WeakMap()],
				["vars", new Map()],
				["configNodes", void 0],
				["isGlobalReference", new WeakMap()],
			])
		);

		/**
		 * Indicates if the AST is ESTree compatible.
		 */
		this.isESTree = ast.type === "Program";

		/*
		 * Backwards compatibility for BOM handling.
		 *
		 * The `hasBOM` property has been available on the `SourceCode` object
		 * for a long time and is used to indicate if the source contains a BOM.
		 * The linter strips the BOM and just passes the `hasBOM` property to the
		 * `SourceCode` constructor to make it easier for languages to not deal with
		 * the BOM.
		 *
		 * However, the text passed in to the `SourceCode` constructor might still
		 * have a BOM if the constructor is called outside of the linter, so we still
		 * need to check for the BOM in the text.
		 */
		/*
		 * The string overload sets `text` directly and `SourceCodeConfig.text`
		 * is required, so the declared contract always supplies it.
		 */
		const sourceText = /** @type {string} */ (text);

		const textHasBOM = sourceText.charCodeAt(0) === 0xfeff;

		/**
		 * The flag to indicate that the source code has Unicode BOM.
		 */
		this.hasBOM = textHasBOM || !!hasBOM;

		/**
		 * The original text source code.
		 * BOM was stripped from this text.
		 */
		this.text = textHasBOM ? sourceText.slice(1) : sourceText;

		/**
		 * The parsed AST for the source code.
		 */
		this.ast = ast;

		/**
		 * The parser services of this source code.
		 */
		this.parserServices = parserServices || {};

		/**
		 * The scope of this source code. `null` until scope analysis has run;
		 * `lib/linter/linter.js` checks for exactly that and rebuilds the
		 * instance with a scope manager.
		 * @type {ScopeManager | null}
		 */
		this.scopeManager = scopeManager || null;

		/**
		 * The visitor keys to traverse AST.
		 */
		this.visitorKeys = visitorKeys || Traverser.DEFAULT_VISITOR_KEYS;

		// Check the source text for the presence of a shebang since it is parsed as a standard line comment.
		const shebangMatched = this.text.match(astUtils.shebangPattern);
		const hasShebang =
			shebangMatched &&
			ast.comments.length &&
			ast.comments[0].value === shebangMatched[1];

		if (hasShebang) {
			ast.comments[0].type = "Shebang";
		}

		this.tokensAndComments = sortedMerge(ast.tokens, ast.comments);

		/**
		 * The source code split into lines according to ECMA-262 specification.
		 * This is done to avoid each rule needing to do so separately.
		 */
		/** @type {string[]} */
		this.lines = [];

		/** @type {number[]} */
		this.lineStartIndices = [0];

		const lineEndingPattern = astUtils.createGlobalLinebreakMatcher();
		let match;

		/*
		 * Previously, this was implemented using a regex that
		 * matched a sequence of non-linebreak characters followed by a
		 * linebreak, then adding the lengths of the matches. However,
		 * this caused a catastrophic backtracking issue when the end
		 * of a file contained a large number of non-newline characters.
		 * To avoid this, the current implementation just matches newlines
		 * and uses match.index to get the correct line start indices.
		 */
		while ((match = lineEndingPattern.exec(this.text))) {
			this.lines.push(
				this.text.slice(this.lineStartIndices.at(-1), match.index),
			);
			this.lineStartIndices.push(match.index + match[0].length);
		}
		this.lines.push(this.text.slice(this.lineStartIndices.at(-1)));

		// don't allow further modification of this object
		Object.freeze(this);
		Object.freeze(this.lines);
	}

	/**
	 * Split the source code into multiple lines based on the line delimiters.
	 * @param {string} text Source code as a string.
	 * @returns {string[]} Array of source code lines.
	 * @public
	 */
	static splitLines(text) {
		return text.split(astUtils.createGlobalLinebreakMatcher());
	}

	/**
	 * Gets the source code for the given node.
	 * @param {ASTNode} [node] The AST node to get the text for.
	 * @param {number} [beforeCount] The number of characters before the node to retrieve.
	 * @param {number} [afterCount] The number of characters after the node to retrieve.
	 * @returns {string} The text representing the AST node.
	 * @public
	 */
	getText(node, beforeCount, afterCount) {
		if (node) {
			return this.text.slice(
				Math.max(node.range[0] - (beforeCount || 0), 0),
				node.range[1] + (afterCount || 0),
			);
		}
		return this.text;
	}

	/**
	 * Gets the entire source text split into an array of lines.
	 * @returns {string[]} The source text as an array of lines.
	 * @public
	 */
	getLines() {
		return this.lines;
	}

	/**
	 * Retrieves an array containing all comments in the source code.
	 * @returns {Token[]} An array of comment nodes.
	 * @public
	 */
	getAllComments() {
		return this.ast.comments;
	}

	/**
	 * Gets the deepest node containing a range index.
	 * @param {number} index Range index of the desired node.
	 * @returns {ASTNode | null} The node if found or null if not found.
	 * @public
	 */
	getNodeByRangeIndex(index) {
		/** @type {ASTNode | null} */
		let result = null;

		Traverser.traverse(this.ast, {
			visitorKeys: this.visitorKeys,
			enter(node) {
				// The traverser is agnostic about AST shape; this one is not.
				const astNode = /** @type {ASTNode} */ (node);

				if (astNode.range[0] <= index && index < astNode.range[1]) {
					result = astNode;
				} else {
					this.skip();
				}
			},
			leave(node) {
				if (node === result) {
					this.break();
				}
			},
		});

		return result;
	}

	/**
	 * Determines if two nodes or tokens have at least one whitespace character
	 * between them. Order does not matter. Returns false if the given nodes or
	 * tokens overlap.
	 * @param {ASTNode} first The first node or token to check between.
	 * @param {ASTNode} second The second node or token to check between.
	 * @returns {boolean} True if there is a whitespace character between
	 * any of the tokens found between the two given nodes or tokens.
	 * @public
	 */
	isSpaceBetween(first, second) {
		if (nodesOrTokensOverlap(first, second)) {
			return false;
		}

		const [startingNodeOrToken, endingNodeOrToken] =
			first.range[1] <= second.range[0]
				? [first, second]
				: [second, first];
		const firstToken =
			this.getLastToken(startingNodeOrToken) || startingNodeOrToken;
		const finalToken =
			this.getFirstToken(endingNodeOrToken) || endingNodeOrToken;
		let currentToken = firstToken;

		while (currentToken !== finalToken) {
			/*
			 * The loop stops when `currentToken` reaches `finalToken`, so
			 * while it has not, a token always follows.
			 */
			const nextToken = /** @type {Token} */ (
				this.getTokenAfter(currentToken, {
					includeComments: true,
				})
			);

			if (currentToken.range[1] !== nextToken.range[0]) {
				return true;
			}

			currentToken = nextToken;
		}

		return false;
	}

	/**
	 * Converts a source text index into a (line, column) pair.
	 * @param {number} index The index of a character in a file.
	 * @throws If non-numeric index or index out of range.
	 * @returns {{ line: number, column: number }} A {line, column} location object with 1-indexed line and 0-indexed column.
	 * @public
	 */
	getLocFromIndex(index) {
		if (typeof index !== "number") {
			throw new TypeError("Expected `index` to be a number.");
		}

		if (index < 0 || index > this.text.length) {
			throw new RangeError(
				`Index out of range (requested index ${index}, but source text has length ${this.text.length}).`,
			);
		}

		/*
		 * For an argument of this.text.length, return the location one "spot" past the last character
		 * of the file. If the last character is a linebreak, the location will be column 0 of the next
		 * line; otherwise, the location will be in the next column on the same line.
		 *
		 * See getIndexFromLoc for the motivation for this special case.
		 */
		if (index === this.text.length) {
			return {
				line: this.lines.length,

				// The constructor always pushes at least one line.
				column: /** @type {string} */ (this.lines.at(-1)).length,
			};
		}

		/*
		 * To figure out which line index is on, determine the last place at which index could
		 * be inserted into lineStartIndices to keep the list sorted.
		 */
		const lineNumber =
			// The constructor always pushes at least one line start index.
			index >= /** @type {number} */ (this.lineStartIndices.at(-1))
				? this.lineStartIndices.length
				: findLineNumberBinarySearch(this.lineStartIndices, index);

		return {
			line: lineNumber,
			column: index - this.lineStartIndices[lineNumber - 1],
		};
	}

	/**
	 * Converts a (line, column) pair into a range index.
	 * @param {{ line: number, column: number }} loc A line/column location, whose `line` is 1-indexed and whose `column` is 0-indexed.
	 * @throws If `loc` is not an object with a numeric
	 *   `line` and `column`, if the `line` is less than or equal to zero or
	 *   the line or column is out of the expected range.
	 * @returns {number} The range index of the location in the file.
	 * @public
	 */
	getIndexFromLoc(loc) {
		if (
			loc === null ||
			typeof loc !== "object" ||
			typeof loc.line !== "number" ||
			typeof loc.column !== "number"
		) {
			throw new TypeError(
				"Expected `loc` to be an object with numeric `line` and `column` properties.",
			);
		}

		if (loc.line <= 0) {
			throw new RangeError(
				`Line number out of range (line ${loc.line} requested). Line numbers should be 1-based.`,
			);
		}

		if (loc.line > this.lineStartIndices.length) {
			throw new RangeError(
				`Line number out of range (line ${loc.line} requested, but only ${this.lineStartIndices.length} lines present).`,
			);
		}

		if (loc.column < 0) {
			throw new RangeError(
				`Invalid column number (column ${loc.column} requested).`,
			);
		}

		const lineStartIndex = this.lineStartIndices[loc.line - 1];
		const lineEndIndex =
			loc.line === this.lineStartIndices.length
				? this.text.length
				: this.lineStartIndices[loc.line];
		const positionIndex = lineStartIndex + loc.column;

		/*
		 * By design, getIndexFromLoc({ line: lineNum, column: 0 }) should return the start index of
		 * the given line, provided that the line number is valid element of this.lines. Since the
		 * last element of this.lines is an empty string for files with trailing newlines, add a
		 * special case where getting the index for the first location after the end of the file
		 * will return the length of the file, rather than throwing an error. This allows rules to
		 * use getIndexFromLoc consistently without worrying about edge cases at the end of a file.
		 */
		if (
			(loc.line === this.lineStartIndices.length &&
				positionIndex > lineEndIndex) ||
			(loc.line < this.lineStartIndices.length &&
				positionIndex >= lineEndIndex)
		) {
			throw new RangeError(
				`Column number out of range (column ${loc.column} requested, but the length of line ${loc.line} is ${lineEndIndex - lineStartIndex}).`,
			);
		}

		return positionIndex;
	}

	/**
	 * Gets the scope for the given node
	 * @param {ASTNode} currentNode The node to get the scope of
	 * @returns {Scope} The scope information for this node
	 * @throws If the `currentNode` argument is missing.
	 */
	getScope(currentNode) {
		if (!currentNode) {
			throw new TypeError("Missing required argument: node.");
		}

		/*
		 * `scopeManager` is `null` only until scope analysis has run; see the
		 * field's declaration in the constructor.
		 */
		const scopeManager = /** @type {ScopeManager} */ (this.scopeManager);

		// check cache first
		const cache = this[caches].get("scopes");
		const cachedScope = cache.get(currentNode);

		if (cachedScope) {
			return cachedScope;
		}

		// On Program node, get the outermost scope to avoid return Node.js special function scope or ES modules scope.
		const inner = currentNode.type !== "Program";

		for (let node = currentNode; node; node = node.parent) {
			const scope = scopeManager.acquire(
				/*
				 * `eslint-scope` declares these against ESTree's node union, which
				 * a custom parser's AST is not (see `ASTNode`).
				 */
				/** @type {import("estree").Node} */ (node),
				inner,
			);

			if (scope) {
				if (scope.type === "function-expression-name") {
					cache.set(currentNode, scope.childScopes[0]);
					return scope.childScopes[0];
				}

				cache.set(currentNode, scope);
				return scope;
			}
		}

		cache.set(currentNode, scopeManager.scopes[0]);
		return scopeManager.scopes[0];
	}

	/**
	 * Get the variables that `node` defines.
	 * This is a convenience method that passes through
	 * to the same method on the `scopeManager`.
	 * @param {ASTNode} node The node for which the variables are obtained.
	 * @returns {ESLintVariable[]} An array of variable nodes representing
	 *      the variables that `node` defines.
	 */
	getDeclaredVariables(node) {
		/*
		 * `scopeManager` is `null` only until scope analysis has run; see the
		 * field's declaration in the constructor.
		 */
		const scopeManager = /** @type {ScopeManager} */ (this.scopeManager);

		return scopeManager.getDeclaredVariables(
			/*
			 * `eslint-scope` declares these against ESTree's node union, which
			 * a custom parser's AST is not (see `ASTNode`).
			 */
			/** @type {import("estree").Node} */ (node),
		);
	}

	/* eslint-disable class-methods-use-this -- node is owned by SourceCode */
	/**
	 * Gets all the ancestors of a given node
	 * @param {ASTNode} node The node
	 * @returns {ASTNode[]} All the ancestor nodes in the AST, not including the provided node, starting
	 * from the root node at index 0 and going inwards to the parent node.
	 * @throws When `node` is missing.
	 */
	getAncestors(node) {
		if (!node) {
			throw new TypeError("Missing required argument: node.");
		}

		/** @type {ASTNode[]} */
		const ancestorsStartingAtParent = [];

		for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
			ancestorsStartingAtParent.push(ancestor);
		}

		return ancestorsStartingAtParent.reverse();
	}

	/**
	 * Determines whether the given identifier node is a reference to a global variable.
	 * @param {ASTNode} node `Identifier` node to check.
	 * @returns {boolean} True if the identifier is a reference to a global variable.
	 * @throws When `node` is missing.
	 */
	isGlobalReference(node) {
		if (!node) {
			throw new TypeError("Missing required argument: node.");
		}

		/*
		 * `scopeManager` is `null` only until scope analysis has run; see the
		 * field's declaration in the constructor.
		 */
		const scopeManager = /** @type {ScopeManager} */ (this.scopeManager);

		const cache = this[caches].get("isGlobalReference");

		if (cache.has(node)) {
			return cache.get(node);
		}

		if (node.type !== "Identifier") {
			cache.set(node, false);
			return false;
		}

		const variable = scopeManager.scopes[0].set.get(node.name);

		if (!variable || variable.defs.length > 0) {
			cache.set(node, false);
			return false;
		}

		const result = variable.references.some(
			({ identifier }) => /** @type {unknown} */ (identifier) === node,
		);
		cache.set(node, result);
		return result;
	}

	/**
	 * Returns the location of the given node or token.
	 * @param {ASTNode} nodeOrToken The node or token to get the location of.
	 * @returns {SourceLocation} The location of the node or token.
	 */
	getLoc(nodeOrToken) {
		return nodeOrToken.loc;
	}

	/**
	 * Returns the range of the given node or token.
	 * @param {ASTNode} nodeOrToken The node or token to get the range of.
	 * @returns {[number, number]} The range of the node or token.
	 */
	getRange(nodeOrToken) {
		return nodeOrToken.range;
	}

	/* eslint-enable class-methods-use-this -- node is owned by SourceCode */

	/**
	 * Marks a variable as used in the current scope
	 * @param {string} name The name of the variable to mark as used.
	 * @param {ASTNode} [refNode] The closest node to the variable reference.
	 * @returns {boolean} True if the variable was found and marked as used, false if not.
	 */
	markVariableAsUsed(name, refNode = this.ast) {
		const currentScope = this.getScope(refNode);

		/** @type {Scope | null} */
		let initialScope = currentScope;

		/*
		 * When we are in an ESM or CommonJS module, we need to start searching
		 * from the top-level scope, not the global scope. For ESM the top-level
		 * scope is the module scope; for CommonJS the top-level scope is the
		 * outer function scope.
		 *
		 * Without this check, we might miss a variable declared with `var` at
		 * the top-level because it won't exist in the global scope.
		 */
		if (
			currentScope.type === "global" &&
			currentScope.childScopes.length > 0 &&
			// top-level scopes refer to a `Program` node
			currentScope.childScopes[0].block === this.ast
		) {
			initialScope = currentScope.childScopes[0];
		}

		for (
			/*
			 * `initialScope` is narrowed to non-null by the assignment above,
			 * so the loop variable has to be widened back to walk `upper` up
			 * to the global scope.
			 */
			let scope = /** @type {Scope | null} */ (initialScope);
			scope;
			scope = scope.upper
		) {
			const variable = /** @type {ESLintVariable | undefined} */ (
				scope.variables.find(scopeVar => scopeVar.name === name)
			);

			if (variable) {
				variable.eslintUsed = true;
				return true;
			}
		}

		return false;
	}

	/**
	 * Returns an array of all inline configuration nodes found in the
	 * source code.
	 * @returns {Token[]} An array of all inline configuration nodes.
	 */
	getInlineConfigNodes() {
		// check the cache first
		let configNodes = this[caches].get("configNodes");

		if (configNodes) {
			return configNodes;
		}

		// calculate fresh config nodes
		configNodes = this.ast.comments.filter(comment => {
			// shebang comments are never directives
			if (comment.type === "Shebang") {
				return false;
			}

			const directive = commentParser.parseDirective(comment.value);

			if (!directive) {
				return false;
			}

			if (!directivesPattern.test(directive.label)) {
				return false;
			}

			// only certain comment types are supported as line comments
			return (
				comment.type !== "Line" ||
				!!/^eslint-disable-(?:next-)?line$/u.test(directive.label)
			);
		});

		this[caches].set("configNodes", configNodes);

		return configNodes;
	}

	/**
	 * Returns an all directive nodes that enable or disable rules along with any problems
	 * encountered while parsing the directives.
	 * @returns {{ problems: InlineConfigProblem[], directives: Directive[] }} Information
	 *      that ESLint needs to further process the directives.
	 */
	getDisableDirectives() {
		// check the cache first
		const cachedDirectives = this[caches].get("disableDirectives");

		if (cachedDirectives) {
			return cachedDirectives;
		}

		/** @type {InlineConfigProblem[]} */
		const problems = [];

		/** @type {Directive[]} */
		const directives = [];

		this.getInlineConfigNodes().forEach(comment => {
			/*
			 * Step 1: Parse the directive. `getInlineConfigNodes()` only
			 * returns comments whose directive already parsed, so this cannot
			 * come back `undefined`.
			 */
			const {
				label,
				value,
				justification: justificationPart,
			} = /** @type {ParsedDirective} */ (
				commentParser.parseDirective(comment.value)
			);

			// Step 2: Extract the directive value
			const lineCommentSupported =
				/^eslint-disable-(?:next-)?line$/u.test(label);

			if (comment.type === "Line" && !lineCommentSupported) {
				return;
			}

			// Step 3: Validate the directive does not span multiple lines
			if (
				label === "eslint-disable-line" &&
				comment.loc.start.line !== comment.loc.end.line
			) {
				const message = `${label} comment should not span multiple lines.`;

				problems.push({
					ruleId: null,
					message,
					loc: comment.loc,
				});
				return;
			}

			// Step 4: Extract the directive value and create the Directive object
			switch (label) {
				case "eslint-disable":
				case "eslint-enable":
				case "eslint-disable-next-line":
				case "eslint-disable-line": {
					const directiveType =
						/** @type {"disable" | "enable" | "disable-next-line" | "disable-line"} */ (
							label.slice("eslint-".length)
						);

					directives.push(
						new Directive({
							type: directiveType,
							node: comment,
							value,
							justification: justificationPart,
						}),
					);
				}

				// no default
			}
		});

		const result = { problems, directives };

		this[caches].set("disableDirectives", result);

		return result;
	}

	/**
	 * Applies language options sent in from the core.
	 * @param {NormalizedJSLanguageOptions} languageOptions The language options for this run.
	 * @returns {void}
	 */
	applyLanguageOptions(languageOptions) {
		/*
		 * Add configured globals and language globals
		 *
		 * Using Object.assign instead of object spread for performance reasons
		 * https://github.com/eslint/eslint/issues/16302
		 */
		const configGlobals = Object.assign(
			Object.create(null), // https://github.com/eslint/eslint/issues/18363
			getGlobalsForEcmaVersion(languageOptions.ecmaVersion),
			languageOptions.sourceType === "commonjs"
				? globals.commonjs
				: void 0,
			languageOptions.globals,
		);

		/*
		 * `normalizeConfigGlobal` will throw an error if a configured global value is invalid. However, these errors would
		 * typically be caught when validating a config anyway (validity for inline global comments is checked separately).
		 */
		for (const [name, value] of Object.entries(configGlobals)) {
			configGlobals[name] = normalizeConfigGlobal(value);
		}

		const varsCache = this[caches].get("vars");

		varsCache.set("configGlobals", configGlobals);
	}

	/**
	 * Applies configuration found inside of the source code. This method is only
	 * called when ESLint is running with inline configuration allowed.
	 * @returns {{ configs: InlineConfigElement[], problems: InlineConfigProblem[] }} Information
	 *      that ESLint needs to further process the inline configuration.
	 */
	applyInlineConfig() {
		/** @type {InlineConfigProblem[]} */
		const problems = [];

		/** @type {InlineConfigElement[]} */
		const configs = [];

		/** @type {Record<string, unknown>} */
		const exportedVariables = {};

		/** @type {Record<string, InlineGlobal>} */
		const inlineGlobals = Object.create(null);

		this.getInlineConfigNodes().forEach(comment => {
			// See the note in `getDisableDirectives()` above.
			const { label, value } = /** @type {ParsedDirective} */ (
				commentParser.parseDirective(comment.value)
			);

			switch (label) {
				case "exported":
					Object.assign(
						exportedVariables,
						commentParser.parseListConfig(value),
					);
					break;

				case "globals":
				case "global":
					for (const [id, idSetting] of Object.entries(
						commentParser.parseStringConfig(value),
					)) {
						let normalizedValue;

						try {
							normalizedValue = normalizeConfigGlobal(idSetting);
						} catch (err) {
							/*
							 * `normalizeConfigGlobal()` only ever throws an
							 * `Error`, but a `catch` binding is `unknown`.
							 */
							const invalidGlobal = /** @type {Error} */ (err);

							problems.push({
								ruleId: null,
								loc: comment.loc,
								message: invalidGlobal.message,
							});
							continue;
						}

						if (inlineGlobals[id]) {
							inlineGlobals[id].comments.push(comment);
							inlineGlobals[id].value = normalizedValue;
						} else {
							inlineGlobals[id] = {
								comments: [comment],
								value: normalizedValue,
							};
						}
					}
					break;

				case "eslint": {
					const parseResult =
						commentParser.parseJSONLikeConfig(value);

					if (parseResult.ok) {
						configs.push({
							config: {
								rules: parseResult.config,
							},
							loc: comment.loc,
						});
					} else {
						problems.push({
							ruleId: null,
							loc: comment.loc,
							message: parseResult.error.message,
						});
					}

					break;
				}
				case "eslint-env": {
					problems.push({
						ruleId: null,
						loc: comment.loc,
						message:
							"/* eslint-env */ comments are no longer supported.",
					});
					break;
				}

				// no default
			}
		});

		// save all the new variables for later
		const varsCache = this[caches].get("vars");

		varsCache.set("inlineGlobals", inlineGlobals);
		varsCache.set("exportedVariables", exportedVariables);

		return {
			configs,
			problems,
		};
	}

	/**
	 * Called by ESLint core to indicate that it has finished providing
	 * information. We now add in all the missing variables and ensure that
	 * state-changing methods cannot be called by rules.
	 * @returns {void}
	 */
	finalize() {
		/*
		 * `scopeManager` is `null` only until scope analysis has run; see the
		 * field's declaration in the constructor.
		 */
		const scopeManager = /** @type {ScopeManager} */ (this.scopeManager);

		const varsCache = this[caches].get("vars");
		const configGlobals = varsCache.get("configGlobals");
		const inlineGlobals = varsCache.get("inlineGlobals");
		const exportedVariables = varsCache.get("exportedVariables");
		const globalScope = scopeManager.scopes[0];

		addDeclaredGlobals(scopeManager, configGlobals, inlineGlobals);

		if (exportedVariables) {
			markExportedVariables(globalScope, exportedVariables);
		}
	}

	/**
	 * Traverse the source code and return the steps that were taken.
	 * @returns {TraversalStep[]} The steps that were taken while traversing the source code.
	 */
	traverse() {
		// Because the AST doesn't mutate, we can cache the steps
		if (this.#steps) {
			return this.#steps;
		}

		/** @type {TraversalStep[]} */
		const steps = (this.#steps = []);

		/*
		 * This logic works for any AST, not just ESTree. Because ESLint has allowed
		 * custom parsers to return any AST, we need to ensure that the traversal
		 * logic works for any AST.
		 */
		/** @type {TraversalAnalyzer} */
		let analyzer = {
			enterNode(node) {
				steps.push(
					new VisitNodeStep({
						target: node,
						phase: 1,
						args: [node],
					}),
				);
			},
			leaveNode(node) {
				steps.push(
					new VisitNodeStep({
						target: node,
						phase: 2,
						args: [node],
					}),
				);
			},
			emit(eventName, args) {
				steps.push(
					new CallMethodStep({
						target: eventName,
						args,
					}),
				);
			},
		};

		/*
		 * We do code path analysis for ESTree only. Code path analysis is not
		 * necessary for other ASTs, and it's also not possible to do for other
		 * ASTs because the necessary information is not available.
		 *
		 * Generally speaking, we can tell that the AST is an ESTree if it has a
		 * Program node at the top level. This is not a perfect heuristic, but it
		 * is good enough for now.
		 */
		if (this.isESTree) {
			analyzer = new CodePathAnalyzer(analyzer);
		}

		/*
		 * The actual AST traversal is done by the `Traverser` class. This class
		 * is responsible for walking the AST and calling the appropriate methods
		 * on the `analyzer` object, which is appropriate for the given AST.
		 */
		Traverser.traverse(this.ast, {
			enter(node, parent) {
				// save the parent node on a property for backwards compatibility
				node.parent = parent;

				analyzer.enterNode(node);
			},
			leave(node) {
				analyzer.leaveNode(node);
			},
			visitorKeys: this.visitorKeys,
		});

		return steps;
	}
}

module.exports = SourceCode;

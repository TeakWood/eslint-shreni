// @ts-check
/**
 * @fileoverview ESQuery wrapper for ESLint.
 * @author Nicholas C. Zakas
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const esquery = require("esquery");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/**
 * A parsed `esquery` selector, as the package's own declarations describe it.
 * @typedef {import("esquery").Selector} Selector
 */

/**
 * An AST node of whatever language the file is being linted with.
 *
 * Left open for the same reason as `RuleContext.sourceCode` in
 * `lib/shared/types.js`: `@types/esquery` describes only estree nodes, while
 * the linter runs selectors against any language's AST.
 * @typedef {any} ASTNode
 */

/**
 * The `esquery` options the linter passes through so that selectors can match
 * nodes of a non-estree language.
 * @typedef {Object} ESQueryOptions
 * @property {string} [nodeTypeKey] The node property holding its type, when the language does not use `type`.
 * @property {Record<string, readonly string[]>} [visitorKeys] The traversable keys of each node type.
 * @property {(node: ASTNode) => readonly string[]} [fallback] Returns the keys to traverse for a node type `visitorKeys` does not cover.
 * @property {(className: string, node: ASTNode, ancestry: ASTNode[]) => boolean} [matchClass] Decides whether a node belongs to a selector class such as `:function`.
 */

//------------------------------------------------------------------------------
// Classes
//------------------------------------------------------------------------------

/**
 * The result of parsing and analyzing an ESQuery selector.
 */
class ESQueryParsedSelector {
	/**
	 * The raw selector string that was parsed
	 * @type {string}
	 */
	source;

	/**
	 * Whether this selector is an exit selector
	 * @type {boolean}
	 */
	isExit;

	/**
	 * An object (from esquery) describing the matching behavior of the selector
	 * @type {Selector}
	 */
	root;

	/**
	 * The node types that could possibly trigger this selector, or `null` if all node types could trigger it
	 * @type {string[] | null}
	 */
	nodeTypes;

	/**
	 * The number of class, pseudo-class, and attribute queries in this selector
	 * @type {number}
	 */
	attributeCount;

	/**
	 * The number of identifier queries in this selector
	 * @type {number}
	 */
	identifierCount;

	/**
	 * Creates a new parsed selector.
	 * @param {string} source The raw selector string that was parsed
	 * @param {boolean} isExit Whether this selector is an exit selector
	 * @param {Selector} root An object (from esquery) describing the matching behavior of the selector
	 * @param {string[] | null} nodeTypes The node types that could possibly trigger this selector, or `null` if all node types could trigger it
	 * @param {number} attributeCount The number of class, pseudo-class, and attribute queries in this selector
	 * @param {number} identifierCount The number of identifier queries in this selector
	 */
	constructor(
		source,
		isExit,
		root,
		nodeTypes,
		attributeCount,
		identifierCount,
	) {
		this.source = source;
		this.isExit = isExit;
		this.root = root;
		this.nodeTypes = nodeTypes;
		this.attributeCount = attributeCount;
		this.identifierCount = identifierCount;
	}

	/**
	 * Compares this selector's specificity to another selector for sorting purposes.
	 * @param {ESQueryParsedSelector} otherSelector The selector to compare against
	 * @returns {number} The sort order of the two selectors:
	 * a value less than 0 if this selector is less specific than otherSelector
	 * a value greater than 0 if this selector is more specific than otherSelector
	 * a value less than 0 if this selector and otherSelector have the same specificity, and this selector <= otherSelector alphabetically
	 * a value greater than 0 if this selector and otherSelector have the same specificity, and this selector > otherSelector alphabetically
	 */
	compare(otherSelector) {
		return (
			this.attributeCount - otherSelector.attributeCount ||
			this.identifierCount - otherSelector.identifierCount ||
			(this.source <= otherSelector.source ? -1 : 1)
		);
	}
}

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/** @type {Map<string, ESQueryParsedSelector>} */
const selectorCache = new Map();

/**
 * Computes the union of one or more arrays
 * @param {...string[]} arrays One or more arrays to union
 * @returns {string[]} The union of the input arrays
 */
function union(...arrays) {
	return [...new Set(arrays.flat())];
}

/**
 * Computes the intersection of one or more arrays
 * @param {...string[]} arrays One or more arrays to intersect
 * @returns {string[]} The intersection of the input arrays
 */
function intersection(...arrays) {
	if (arrays.length === 0) {
		return [];
	}

	let result = [...new Set(arrays[0])];

	for (const array of arrays.slice(1)) {
		result = result.filter(x => array.includes(x));
	}
	return result;
}

/**
 * Analyzes a parsed selector and returns combined data about it
 * @param {Selector} parsedSelector An object (from esquery) describing the matching behavior of the selector
 * @returns {{ nodeTypes: string[] | null, attributeCount: number, identifierCount: number }}
 * Object containing selector data.
 */
function analyzeParsedSelector(parsedSelector) {
	let attributeCount = 0;
	let identifierCount = 0;

	/**
	 * Analyzes a selector and returns the node types that could possibly trigger it.
	 * @param {Selector} selector The selector to analyze.
	 * @returns {string[] | null} The node types that could possibly trigger this selector, or `null` if all node types could trigger it
	 */
	function analyzeSelector(selector) {
		switch (selector.type) {
			case "identifier":
				identifierCount++;
				return [selector.value];

			case "not":
				selector.selectors.map(analyzeSelector);
				return null;

			case "matches": {
				const typesForComponents =
					selector.selectors.map(analyzeSelector);

				if (typesForComponents.every(types => types !== null)) {
					return union(...typesForComponents);
				}
				return null;
			}

			case "compound": {
				const typesForComponents = selector.selectors
					.map(analyzeSelector)
					.filter(typesForComponent => typesForComponent !== null);

				// If all of the components could match any type, then the compound could also match any type.
				if (!typesForComponents.length) {
					return null;
				}

				/*
				 * If at least one of the components could only match a particular type, the compound could only match
				 * the intersection of those types.
				 */
				return intersection(...typesForComponents);
			}

			case "attribute":
			case "field":
			case "nth-child":
			case "nth-last-child":
				attributeCount++;
				return null;

			case "child":
			case "descendant":
			case "sibling":
			case "adjacent":
				analyzeSelector(selector.left);
				return analyzeSelector(selector.right);

			case "class":
				// TODO: abstract into JSLanguage somehow
				if (selector.name === "function") {
					return [
						"FunctionDeclaration",
						"FunctionExpression",
						"ArrowFunctionExpression",
					];
				}
				return null;

			default:
				return null;
		}
	}

	const nodeTypes = analyzeSelector(parsedSelector);

	return {
		nodeTypes,
		attributeCount,
		identifierCount,
	};
}

/**
 * Tries to parse a simple selector string, such as a single identifier or wildcard.
 * This saves time by avoiding the overhead of esquery parsing for simple cases.
 * @param {string} selector The selector string to parse.
 * @returns {Selector | null} An object describing the selector if it is simple, or `null` if it is not.
 */
function trySimpleParseSelector(selector) {
	if (selector === "*") {
		return {
			type: "wildcard",
			value: "*",
		};
	}

	if (/^[a-z]+$/iu.test(selector)) {
		return {
			type: "identifier",
			value: selector,
		};
	}

	return null;
}

/**
 * Parses a raw selector string, and throws a useful error if parsing fails.
 * @param {string} selector The selector string to parse.
 * @returns {Selector} An object (from esquery) describing the matching behavior of this selector
 * @throws {SyntaxError} An error if the selector is invalid
 */
function tryParseSelector(selector) {
	try {
		return esquery.parse(selector);
	} catch (err) {
		/*
		 * `esquery` throws a PEG.js error carrying the offset of the syntax
		 * error, which is not an `Error` subclass we can name. The original
		 * binding stays the one rethrown and the one set as `cause`.
		 */
		const parseError =
			/** @type {{ location?: { start?: { offset?: unknown } }, message?: string }} */ (
				err
			);

		if (
			parseError.location &&
			parseError.location.start &&
			typeof parseError.location.start.offset === "number"
		) {
			throw new SyntaxError(
				`Syntax error in selector "${selector}" at position ${parseError.location.start.offset}: ${parseError.message}`,
				{
					cause: err,
				},
			);
		}
		throw err;
	}
}

/**
 * Parses a raw selector string, and returns the parsed selector along with specificity and type information.
 * @param {string} source A raw AST selector
 * @returns {ESQueryParsedSelector} A selector descriptor
 */
function parse(source) {
	if (selectorCache.has(source)) {
		// Guarded by `has()`, which `Map#get`'s type cannot express.
		return /** @type {ESQueryParsedSelector} */ (selectorCache.get(source));
	}

	const cleanSource = source.replace(/:exit$/u, "");
	const parsedSelector =
		trySimpleParseSelector(cleanSource) ?? tryParseSelector(cleanSource);
	const { nodeTypes, attributeCount, identifierCount } =
		analyzeParsedSelector(parsedSelector);

	const result = new ESQueryParsedSelector(
		source,
		source.endsWith(":exit"),
		parsedSelector,
		nodeTypes,
		attributeCount,
		identifierCount,
	);

	selectorCache.set(source, result);
	return result;
}

/**
 * Checks if a node matches a given selector.
 * @param {ASTNode} node The node to check against the selector.
 * @param {Selector} root The root of the selector to match against.
 * @param {ASTNode[]} ancestry The ancestry of the node being checked, which is an array of nodes from the current node to the root.
 * @param {ESQueryOptions} [options] The options to use for matching.
 * @returns {boolean} `true` if the node matches the selector, `false` otherwise.
 */
function matches(node, root, ancestry, options) {
	/*
	 * `@types/esquery` declares `fallback` as returning a mutable `string[]`,
	 * which `eslint-visitor-keys`' `getKeys()` — the fallback every caller
	 * passes — does not satisfy. `esquery` only iterates the result.
	 */
	return esquery.matches(
		node,
		root,
		ancestry,
		/** @type {import("esquery").ESQueryOptions} */ (options),
	);
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

module.exports = {
	parse,
	matches,
	ESQueryParsedSelector,
};

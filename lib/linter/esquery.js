/**
 * @fileoverview ESQuery wrapper for ESLint.
 * @author Nicholas C. Zakas
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const esquery = require("esquery");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/** @typedef {import("esquery").ESQueryOptions} ESQueryOptions */
/** @typedef {import("esquery").Selector} Selector */

/**
 * The loose node shape the linter hands around, shared with the rules layer.
 * @typedef {import("../rules/utils/ast-utils.js").ASTNode} ASTNode
 */

/**
 * The specificity and type information {@linkcode analyzeParsedSelector}
 * derives from a parsed selector.
 * @typedef {Object} ParsedSelectorAnalysis
 * @property {Array<string> | null} nodeTypes The node types that could possibly trigger the selector, or `null` if all node types could.
 * @property {number} attributeCount The number of class, pseudo-class, and attribute queries.
 * @property {number} identifierCount The number of identifier queries.
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
	 * @type {Array<string> | null}
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
	 * @param {Array<string> | null} nodeTypes The node types that could possibly trigger this selector, or `null` if all node types could trigger it
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
	 * @returns {number} The relative ordering of the two selectors:
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
 * @param {...Array<string>} arrays One or more arrays to union
 * @returns {Array<string>} The union of the input arrays
 */
function union(...arrays) {
	return [...new Set(arrays.flat())];
}

/**
 * Computes the intersection of one or more arrays
 * @param {...Array<string>} arrays One or more arrays to intersect
 * @returns {Array<string>} The intersection of the input arrays
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
 * @returns {ParsedSelectorAnalysis} Object containing selector data.
 */
function analyzeParsedSelector(parsedSelector) {
	let attributeCount = 0;
	let identifierCount = 0;

	/**
	 * Analyzes a selector and returns the node types that could possibly trigger it.
	 * @param {Selector} selector The selector to analyze.
	 * @returns {Array<string> | null} The node types that could possibly trigger this selector, or `null` if all node types could trigger it
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

				/*
				 * `every(Boolean)` does not narrow the element type, so the
				 * assertion restates the check it guards.
				 */
				if (typesForComponents.every(Boolean)) {
					return union(
						.../** @type {Array<Array<string>>} */ (
							typesForComponents
						),
					);
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
		 * A `catch` binding is `unknown` under `strict`. esquery's parser
		 * attaches a peg.js `location`, which is what the friendlier message
		 * below reads; the property checks are what make the assertion sound.
		 */
		const parseError =
			/** @type {{ location?: { start?: { offset?: number } }, message: string }} */ (
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
		// Sound: guarded by the `has()` check on the line above.
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
 * @param {Array<ASTNode>} ancestry The ancestry of the node being checked, which is an array of nodes from the current node to the root.
 * @param {ESQueryOptions} options The options to use for matching.
 * @returns {boolean} `true` if the node matches the selector, `false` otherwise.
 */
function matches(node, root, ancestry, options) {
	/*
	 * esquery is typed against the ESTree node union, while the linter passes
	 * the looser shape every language shares. The runtime contract is the same:
	 * esquery only reads `type` and the keys `options.visitorKeys` names.
	 */
	return esquery.matches(
		/** @type {import("estree").Node} */ (node),
		root,
		/** @type {Array<import("estree").Node>} */ (ancestry),
		options,
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

/**
 * @fileoverview Rule to require or disallow line breaks inside braces.
 * @author Toru Nagashima
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */

/**
 * The line break requirements for one node type, with the three forms an
 * option can take (`"always"`, `"never"`, and the object form) collapsed into
 * a single shape.
 * @typedef {Object} NormalizedOptionValue
 * @property {boolean} multiline Whether a multiline value requires line breaks.
 * @property {number} minProperties The property count at which line breaks become required.
 * @property {boolean} consistent Whether both braces must agree about line breaks.
 */

/**
 * The line break requirements of every node type this rule checks.
 * @typedef {Object} NormalizedOptions
 * @property {NormalizedOptionValue} ObjectExpression The requirements for object expressions.
 * @property {NormalizedOptionValue} ObjectPattern The requirements for object patterns.
 * @property {NormalizedOptionValue} ImportDeclaration The requirements for import declarations.
 * @property {NormalizedOptionValue} ExportNamedDeclaration The requirements for named export declarations.
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

// Schema objects.
const OPTION_VALUE = {
	oneOf: [
		{
			enum: ["always", "never"],
		},
		{
			type: "object",
			properties: {
				multiline: {
					type: "boolean",
				},
				minProperties: {
					type: "integer",
					minimum: 0,
				},
				consistent: {
					type: "boolean",
				},
			},
			additionalProperties: false,
			minProperties: 1,
		},
	],
};

/**
 * Normalizes a given option value.
 * @param {any} value An option value to parse.
 * @returns {NormalizedOptionValue} Normalized option object.
 */
function normalizeOptionValue(value) {
	let multiline = false;
	let minProperties = Number.POSITIVE_INFINITY;
	let consistent = false;

	if (value) {
		if (value === "always") {
			minProperties = 0;
		} else if (value === "never") {
			minProperties = Number.POSITIVE_INFINITY;
		} else {
			multiline = Boolean(value.multiline);
			minProperties = value.minProperties || Number.POSITIVE_INFINITY;
			consistent = Boolean(value.consistent);
		}
	} else {
		consistent = true;
	}

	return { multiline, minProperties, consistent };
}

/**
 * Checks if a value is an object.
 * @param {any} value The value to check
 * @returns {boolean} `true` if the value is an object, otherwise `false`
 */
function isObject(value) {
	return typeof value === "object" && value !== null;
}

/**
 * Checks if an option is a node-specific option
 * @param {any} option The option to check
 * @returns {boolean} `true` if the option is node-specific, otherwise `false`
 */
function isNodeSpecificOption(option) {
	return isObject(option) || typeof option === "string";
}

/**
 * Normalizes a given option value.
 * @param {any} options An option value to parse.
 * @returns {NormalizedOptions} Normalized option object.
 */
function normalizeOptions(options) {
	if (
		isObject(options) &&
		Object.values(options).some(isNodeSpecificOption)
	) {
		return {
			ObjectExpression: normalizeOptionValue(options.ObjectExpression),
			ObjectPattern: normalizeOptionValue(options.ObjectPattern),
			ImportDeclaration: normalizeOptionValue(options.ImportDeclaration),
			ExportNamedDeclaration: normalizeOptionValue(
				options.ExportDeclaration,
			),
		};
	}

	const value = normalizeOptionValue(options);

	return {
		ObjectExpression: value,
		ObjectPattern: value,
		ImportDeclaration: value,
		ExportNamedDeclaration: value,
	};
}

/**
 * Determines if ObjectExpression, ObjectPattern, ImportDeclaration or ExportNamedDeclaration
 * node needs to be checked for missing line breaks
 * @param {ASTNode} node Node under inspection
 * @param {NormalizedOptionValue} options option specific to node type
 * @param {Token} first First object property
 * @param {Token} last Last object property
 * @returns {boolean} `true` if node needs to be checked for missing line breaks
 */
function areLineBreaksRequired(node, options, first, last) {
	let objectProperties;

	if (node.type === "ObjectExpression" || node.type === "ObjectPattern") {
		objectProperties = node.properties;
	} else {
		// is ImportDeclaration or ExportNamedDeclaration
		objectProperties = node.specifiers.filter(
			(/** @type {ASTNode} */ s) =>
				s.type === "ImportSpecifier" || s.type === "ExportSpecifier",
		);
	}

	return (
		objectProperties.length >= options.minProperties ||
		(options.multiline &&
			objectProperties.length > 0 &&
			first.loc.start.line !== last.loc.end.line)
	);
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		deprecated: {
			message: "Formatting rules are being moved out of ESLint core.",
			url: "https://eslint.org/blog/2023/10/deprecating-formatting-rules/",
			deprecatedSince: "8.53.0",
			availableUntil: "11.0.0",
			replacedBy: [
				{
					message:
						"ESLint Stylistic now maintains deprecated stylistic core rules.",
					url: "https://eslint.style/guide/migration",
					plugin: {
						name: "@stylistic/eslint-plugin",
						url: "https://eslint.style",
					},
					rule: {
						name: "object-curly-newline",
						url: "https://eslint.style/rules/object-curly-newline",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent line breaks after opening and before closing braces",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/object-curly-newline",
		},

		fixable: "whitespace",

		schema: [
			{
				oneOf: [
					OPTION_VALUE,
					{
						type: "object",
						properties: {
							ObjectExpression: OPTION_VALUE,
							ObjectPattern: OPTION_VALUE,
							ImportDeclaration: OPTION_VALUE,
							ExportDeclaration: OPTION_VALUE,
						},
						additionalProperties: false,
						minProperties: 1,
					},
				],
			},
		],

		messages: {
			unexpectedLinebreakBeforeClosingBrace:
				"Unexpected line break before this closing brace.",
			unexpectedLinebreakAfterOpeningBrace:
				"Unexpected line break after this opening brace.",
			expectedLinebreakBeforeClosingBrace:
				"Expected a line break before this closing brace.",
			expectedLinebreakAfterOpeningBrace:
				"Expected a line break after this opening brace.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		const sourceCode = context.sourceCode;
		const normalizedOptions = normalizeOptions(context.options[0]);

		/*
		 * The visitor registers `check` only for the four node types
		 * `normalizeOptions` produces a key for, but it looks the options up by
		 * a computed `node.type`.
		 */
		const optionsByNodeType =
			/** @type {Record<string, NormalizedOptionValue>} */ (
				normalizedOptions
			);

		/**
		 * Reports a given node if it violated this rule.
		 * @param {ASTNode} node A node to check. This is an ObjectExpression, ObjectPattern, ImportDeclaration or ExportNamedDeclaration node.
		 * @returns {void}
		 */
		function check(node) {
			const options = optionsByNodeType[node.type];

			if (
				(node.type === "ImportDeclaration" &&
					!node.specifiers.some(
						(/** @type {ASTNode} */ specifier) =>
							specifier.type === "ImportSpecifier",
					)) ||
				(node.type === "ExportNamedDeclaration" &&
					!node.specifiers.some(
						(/** @type {ASTNode} */ specifier) =>
							specifier.type === "ExportSpecifier",
					))
			) {
				return;
			}

			/*
			 * Grammar guarantee: each of the four node types this is registered
			 * for is delimited by a `{`/`}` pair — the braces of an object
			 * literal or pattern, or of the named specifier list of an import
			 * or export declaration — and that pair encloses at least the one
			 * specifier the check above required. So the opening and closing
			 * braces both exist, and so do the tokens just inside them.
			 */
			const openBrace = /** @type {Token} */ (
				sourceCode.getFirstToken(node, token => token.value === "{")
			);

			let closeBrace;

			if (node.typeAnnotation) {
				closeBrace = /** @type {Token} */ (
					sourceCode.getTokenBefore(node.typeAnnotation)
				);
			} else {
				closeBrace = /** @type {Token} */ (
					sourceCode.getLastToken(node, token => token.value === "}")
				);
			}

			let first = /** @type {Token} */ (
				sourceCode.getTokenAfter(openBrace, {
					includeComments: true,
				})
			);
			let last = /** @type {Token} */ (
				sourceCode.getTokenBefore(closeBrace, {
					includeComments: true,
				})
			);

			const needsLineBreaks = areLineBreaksRequired(
				node,
				options,
				first,
				last,
			);

			const hasCommentsFirstToken = astUtils.isCommentToken(first);
			const hasCommentsLastToken = astUtils.isCommentToken(last);

			/*
			 * Use tokens or comments to check multiline or not.
			 * But use only tokens to check whether line breaks are needed.
			 * This allows:
			 *     var obj = { // eslint-disable-line foo
			 *         a: 1
			 *     }
			 */
			first = /** @type {Token} */ (sourceCode.getTokenAfter(openBrace));
			last = /** @type {Token} */ (sourceCode.getTokenBefore(closeBrace));

			if (needsLineBreaks) {
				if (astUtils.isTokenOnSameLine(openBrace, first)) {
					context.report({
						messageId: "expectedLinebreakAfterOpeningBrace",
						node,
						loc: openBrace.loc,
						/**
						 * Inserts the missing line break after the opening brace.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo|Array<EditInfo>|null} The fix, or `null` if a comment makes it unsafe.
						 */
						fix(fixer) {
							if (hasCommentsFirstToken) {
								return null;
							}

							return fixer.insertTextAfter(openBrace, "\n");
						},
					});
				}
				if (astUtils.isTokenOnSameLine(last, closeBrace)) {
					context.report({
						messageId: "expectedLinebreakBeforeClosingBrace",
						node,
						loc: closeBrace.loc,
						/**
						 * Inserts the missing line break before the closing brace.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo|Array<EditInfo>|null} The fix, or `null` if a comment makes it unsafe.
						 */
						fix(fixer) {
							if (hasCommentsLastToken) {
								return null;
							}

							return fixer.insertTextBefore(closeBrace, "\n");
						},
					});
				}
			} else {
				const consistent = options.consistent;
				const hasLineBreakBetweenOpenBraceAndFirst =
					!astUtils.isTokenOnSameLine(openBrace, first);
				const hasLineBreakBetweenCloseBraceAndLast =
					!astUtils.isTokenOnSameLine(last, closeBrace);

				if (
					(!consistent && hasLineBreakBetweenOpenBraceAndFirst) ||
					(consistent &&
						hasLineBreakBetweenOpenBraceAndFirst &&
						!hasLineBreakBetweenCloseBraceAndLast)
				) {
					context.report({
						messageId: "unexpectedLinebreakAfterOpeningBrace",
						node,
						loc: openBrace.loc,
						/**
						 * Removes the unexpected line break after the opening brace.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo|Array<EditInfo>|null} The fix, or `null` if a comment makes it unsafe.
						 */
						fix(fixer) {
							if (hasCommentsFirstToken) {
								return null;
							}

							return fixer.removeRange([
								openBrace.range[1],
								first.range[0],
							]);
						},
					});
				}
				if (
					(!consistent && hasLineBreakBetweenCloseBraceAndLast) ||
					(consistent &&
						!hasLineBreakBetweenOpenBraceAndFirst &&
						hasLineBreakBetweenCloseBraceAndLast)
				) {
					context.report({
						messageId: "unexpectedLinebreakBeforeClosingBrace",
						node,
						loc: closeBrace.loc,
						/**
						 * Removes the unexpected line break before the closing brace.
						 * @param {RuleFixer} fixer The fixer object.
						 * @returns {EditInfo|Array<EditInfo>|null} The fix, or `null` if a comment makes it unsafe.
						 */
						fix(fixer) {
							if (hasCommentsLastToken) {
								return null;
							}

							return fixer.removeRange([
								last.range[1],
								closeBrace.range[0],
							]);
						},
					});
				}
			}
		}

		return {
			ObjectExpression: check,
			ObjectPattern: check,
			ImportDeclaration: check,
			ExportNamedDeclaration: check,
		};
	},
};

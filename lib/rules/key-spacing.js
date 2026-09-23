/**
 * @fileoverview Rule to specify spacing of object literal keys and values
 * @author Brandon Mills
 * @deprecated in ESLint v8.53.0
 */

// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const astUtils = require("./utils/ast-utils");
const { getGraphemeCount } = require("../shared/string-utils");

//------------------------------------------------------------------------------
// Types
//------------------------------------------------------------------------------

/** @typedef {import("./utils/ast-utils.js").ASTNode} ASTNode */
/** @typedef {import("./utils/ast-utils.js").Token} Token */
/** @typedef {import("./utils/types.js").RuleContext} RuleContext */
/** @typedef {import("./utils/types.js").RuleVisitor} RuleVisitor */
/** @typedef {import("./utils/types.js").RuleFixer} RuleFixer */
/** @typedef {import("./utils/types.js").EditInfo} EditInfo */
/** @typedef {import("../shared/types.js").Range} Range */

/**
 * How much space the rule wants on either side of a colon, and how strictly.
 * `"strict"` means exactly that many spaces, `"minimum"` means at least that
 * many. `align` is only ever present on the `multiLine` options, where the
 * top-level form of the config leaves the alignment settings.
 * @typedef {Object} SpacingOptions
 * @property {"strict" | "minimum"} mode Whether the counts below are exact or a floor.
 * @property {number} beforeColon The number of spaces wanted before the colon.
 * @property {number} afterColon The number of spaces wanted after the colon.
 * @property {AlignOptions} [align] The alignment settings, when the user wrote them inside `multiLine`.
 */

/**
 * The settings for vertically aligning a group of properties: the same spacing
 * settings, plus what the properties line up on. `on` is optional only because
 * `initOptions()` fills it in a step after the rest of the object.
 * @typedef {SpacingOptions & { on?: "colon" | "value" }} AlignOptions
 */

/**
 * The rule's options once `initOptions()` has folded the several accepted
 * config shapes into a single one. `align` is absent unless the user asked for
 * alignment at all.
 * @typedef {Object} KeySpacingOptions
 * @property {SpacingOptions} singleLine The spacing wanted inside single-line objects.
 * @property {SpacingOptions} multiLine The spacing wanted inside multi-line objects.
 * @property {AlignOptions} [align] The alignment settings, when the user configured alignment.
 */

/**
 * Checks whether a string contains a line terminator as defined in
 * https://262.ecma-international.org/5.1/#sec-7.3
 * @param {string} str String to test.
 * @returns {boolean} True if str contains a line terminator.
 */
function containsLineTerminator(str) {
	return astUtils.LINEBREAK_MATCHER.test(str);
}

/**
 * Gets the last element of an array.
 * @template T The type of the array's elements.
 * @param {Array<T>} arr An array.
 * @returns {T} Last element of arr.
 */
function last(arr) {
	// Every caller either passes a non-empty array or checks for `undefined`.
	return /** @type {T} */ (arr.at(-1));
}

/**
 * Checks whether a node is contained on a single line.
 * @param {ASTNode} node AST Node being evaluated.
 * @returns {boolean} True if the node is a single line.
 */
function isSingleLine(node) {
	return node.loc.end.line === node.loc.start.line;
}

/**
 * Checks whether the properties on a single line.
 * @param {Array<ASTNode>} properties List of Property AST nodes.
 * @returns {boolean} True if all properties is on a single line.
 */
function isSingleLineProperties(properties) {
	const [firstProp] = properties,
		lastProp = last(properties);

	return firstProp.loc.start.line === lastProp.loc.end.line;
}

/**
 * Initializes a single option property from the configuration with defaults for undefined values
 * @param {Partial<SpacingOptions>} toOptions Object to be initialized
 * @param {Record<string, any>} fromOptions Object to be initialized from. Its values are the raw config, which `meta.schema` is what validates.
 * @returns {SpacingOptions} The object with correctly initialized options and values
 */
function initOptionProperty(toOptions, fromOptions) {
	toOptions.mode = fromOptions.mode || "strict";

	// Set value of beforeColon
	if (typeof fromOptions.beforeColon !== "undefined") {
		toOptions.beforeColon = +fromOptions.beforeColon;
	} else {
		toOptions.beforeColon = 0;
	}

	// Set value of afterColon
	if (typeof fromOptions.afterColon !== "undefined") {
		toOptions.afterColon = +fromOptions.afterColon;
	} else {
		toOptions.afterColon = 1;
	}

	// Set align if exists
	if (typeof fromOptions.align !== "undefined") {
		if (typeof fromOptions.align === "object") {
			toOptions.align = fromOptions.align;
		} else {
			// "string"
			toOptions.align = {
				on: fromOptions.align,

				// The first statement of this function assigns `mode`.
				mode: /** @type {"strict" | "minimum"} */ (toOptions.mode),
				beforeColon: toOptions.beforeColon,
				afterColon: toOptions.afterColon,
			};
		}
	}

	return /** @type {SpacingOptions} */ (toOptions);
}

/**
 * Initializes all the option values (singleLine, multiLine and align) from the configuration with defaults for undefined values
 * @param {Partial<KeySpacingOptions>} toOptions Object to be initialized
 * @param {Record<string, any>} fromOptions Object to be initialized from. Its values are the raw config, which `meta.schema` is what validates.
 * @returns {KeySpacingOptions} The object with correctly initialized options and values
 */
function initOptions(toOptions, fromOptions) {
	if (typeof fromOptions.align === "object") {
		// Initialize the alignment configuration
		toOptions.align = initOptionProperty({}, fromOptions.align);
		toOptions.align.on = fromOptions.align.on || "colon";
		toOptions.align.mode = fromOptions.align.mode || "strict";

		toOptions.multiLine = initOptionProperty(
			{},
			fromOptions.multiLine || fromOptions,
		);
		toOptions.singleLine = initOptionProperty(
			{},
			fromOptions.singleLine || fromOptions,
		);
	} else {
		// string or undefined
		toOptions.multiLine = initOptionProperty(
			{},
			fromOptions.multiLine || fromOptions,
		);
		toOptions.singleLine = initOptionProperty(
			{},
			fromOptions.singleLine || fromOptions,
		);

		// If alignment options are defined in multiLine, pull them out into the general align configuration
		if (toOptions.multiLine.align) {
			toOptions.align = {
				on: toOptions.multiLine.align.on,
				mode:
					toOptions.multiLine.align.mode || toOptions.multiLine.mode,
				beforeColon: toOptions.multiLine.align.beforeColon,
				afterColon: toOptions.multiLine.align.afterColon,
			};
		}
	}

	return /** @type {KeySpacingOptions} */ (toOptions);
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
						name: "key-spacing",
						url: "https://eslint.style/rules/key-spacing",
					},
				},
			],
		},
		type: "layout",

		docs: {
			description:
				"Enforce consistent spacing between keys and values in object literal properties",
			recommended: false,
			url: "https://eslint.org/docs/latest/rules/key-spacing",
		},

		fixable: "whitespace",

		schema: [
			{
				anyOf: [
					{
						type: "object",
						properties: {
							align: {
								anyOf: [
									{
										enum: ["colon", "value"],
									},
									{
										type: "object",
										properties: {
											mode: {
												enum: ["strict", "minimum"],
											},
											on: {
												enum: ["colon", "value"],
											},
											beforeColon: {
												type: "boolean",
											},
											afterColon: {
												type: "boolean",
											},
										},
										additionalProperties: false,
									},
								],
							},
							mode: {
								enum: ["strict", "minimum"],
							},
							beforeColon: {
								type: "boolean",
							},
							afterColon: {
								type: "boolean",
							},
						},
						additionalProperties: false,
					},
					{
						type: "object",
						properties: {
							singleLine: {
								type: "object",
								properties: {
									mode: {
										enum: ["strict", "minimum"],
									},
									beforeColon: {
										type: "boolean",
									},
									afterColon: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
							multiLine: {
								type: "object",
								properties: {
									align: {
										anyOf: [
											{
												enum: ["colon", "value"],
											},
											{
												type: "object",
												properties: {
													mode: {
														enum: [
															"strict",
															"minimum",
														],
													},
													on: {
														enum: [
															"colon",
															"value",
														],
													},
													beforeColon: {
														type: "boolean",
													},
													afterColon: {
														type: "boolean",
													},
												},
												additionalProperties: false,
											},
										],
									},
									mode: {
										enum: ["strict", "minimum"],
									},
									beforeColon: {
										type: "boolean",
									},
									afterColon: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
						},
						additionalProperties: false,
					},
					{
						type: "object",
						properties: {
							singleLine: {
								type: "object",
								properties: {
									mode: {
										enum: ["strict", "minimum"],
									},
									beforeColon: {
										type: "boolean",
									},
									afterColon: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
							multiLine: {
								type: "object",
								properties: {
									mode: {
										enum: ["strict", "minimum"],
									},
									beforeColon: {
										type: "boolean",
									},
									afterColon: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
							align: {
								type: "object",
								properties: {
									mode: {
										enum: ["strict", "minimum"],
									},
									on: {
										enum: ["colon", "value"],
									},
									beforeColon: {
										type: "boolean",
									},
									afterColon: {
										type: "boolean",
									},
								},
								additionalProperties: false,
							},
						},
						additionalProperties: false,
					},
				],
			},
		],
		messages: {
			extraKey: "Extra space after {{computed}}key '{{key}}'.",
			extraValue:
				"Extra space before value for {{computed}}key '{{key}}'.",
			missingKey: "Missing space after {{computed}}key '{{key}}'.",
			missingValue:
				"Missing space before value for {{computed}}key '{{key}}'.",
		},
	},

	/**
	 * Creates the rule's visitor.
	 * @param {RuleContext} context The rule context.
	 * @returns {RuleVisitor} The visitor.
	 */
	create(context) {
		/**
		 * OPTIONS
		 * "key-spacing": [2, {
		 *     beforeColon: false,
		 *     afterColon: true,
		 *     align: "colon" // Optional, or "value"
		 * }
		 */
		const options = context.options[0] || {},
			ruleOptions = initOptions({}, options),
			multiLineOptions = ruleOptions.multiLine,
			singleLineOptions = ruleOptions.singleLine,
			alignmentOptions = ruleOptions.align || null;

		const sourceCode = context.sourceCode;

		/**
		 * Determines if the given property is key-value property.
		 * @param {ASTNode} property Property node to check.
		 * @returns {boolean} Whether the property is a key-value property.
		 */
		function isKeyValueProperty(property) {
			return !(
				property.method ||
				property.shorthand ||
				property.kind !== "init" ||
				property.type !== "Property" // Could be "ExperimentalSpreadProperty" or "SpreadElement"
			);
		}

		/**
		 * Starting from the given node (a property.key node here) looks forward
		 * until it finds the colon punctuator and returns it.
		 * @param {ASTNode} node The node to start looking from.
		 * @returns {Token} The colon punctuator.
		 */
		function getNextColon(node) {
			/*
			 * This helper and the two below it only ever run on the key of a
			 * key-value property, which the grammar guarantees is surrounded
			 * by the property's own tokens, so none of the three lookups can
			 * come back `null`.
			 */
			return /** @type {Token} */ (
				sourceCode.getTokenAfter(node, astUtils.isColonToken)
			);
		}

		/**
		 * Starting from the given node (a property.key node here) looks forward
		 * until it finds the last token before a colon punctuator and returns it.
		 * @param {ASTNode} node The node to start looking from.
		 * @returns {Token} The last token before a colon punctuator.
		 */
		function getLastTokenBeforeColon(node) {
			const colonToken = getNextColon(node);

			return /** @type {Token} */ (sourceCode.getTokenBefore(colonToken));
		}

		/**
		 * Starting from the given node (a property.key node here) looks forward
		 * until it finds the first token after a colon punctuator and returns it.
		 * @param {ASTNode} node The node to start looking from.
		 * @returns {Token} The first token after a colon punctuator.
		 */
		function getFirstTokenAfterColon(node) {
			const colonToken = getNextColon(node);

			return /** @type {Token} */ (sourceCode.getTokenAfter(colonToken));
		}

		/**
		 * Checks whether a property is a member of the property group it follows.
		 * @param {ASTNode} lastMember The last Property known to be in the group.
		 * @param {ASTNode} candidate The next Property that might be in the group.
		 * @returns {boolean} True if the candidate property is part of the group.
		 */
		function continuesPropertyGroup(lastMember, candidate) {
			const groupEndLine = lastMember.loc.start.line,
				candidateValueStartLine = (
					isKeyValueProperty(candidate)
						? getFirstTokenAfterColon(candidate.key)
						: candidate
				).loc.start.line;

			if (candidateValueStartLine - groupEndLine <= 1) {
				return true;
			}

			/*
			 * Check that the first comment is adjacent to the end of the group, the
			 * last comment is adjacent to the candidate property, and that successive
			 * comments are adjacent to each other.
			 */
			const leadingComments = sourceCode.getCommentsBefore(candidate);

			if (
				leadingComments.length &&
				leadingComments[0].loc.start.line - groupEndLine <= 1 &&
				candidateValueStartLine - last(leadingComments).loc.end.line <=
					1
			) {
				for (let i = 1; i < leadingComments.length; i++) {
					if (
						leadingComments[i].loc.start.line -
							leadingComments[i - 1].loc.end.line >
						1
					) {
						return false;
					}
				}
				return true;
			}

			return false;
		}

		/**
		 * Gets an object literal property's key as the identifier name or string value.
		 * @param {ASTNode} property Property node whose key to retrieve.
		 * @returns {string | null} The property's key, or `null` if it is computed from something dynamic.
		 */
		function getKey(property) {
			const key = property.key;

			if (property.computed) {
				return sourceCode.getText().slice(key.range[0], key.range[1]);
			}
			return astUtils.getStaticPropertyName(property);
		}

		/**
		 * Reports an appropriately-formatted error if spacing is incorrect on one
		 * side of the colon.
		 * @param {ASTNode} property Key-value pair in an object literal.
		 * @param {"key" | "value"} side Side being verified - either "key" or "value".
		 * @param {string} whitespace Actual whitespace string.
		 * @param {number} expected Expected whitespace length.
		 * @param {"strict" | "minimum"} mode Value of the mode as "strict" or "minimum"
		 * @returns {void} No return value.
		 */
		function report(property, side, whitespace, expected, mode) {
			const diff = whitespace.length - expected;

			if (
				((diff && mode === "strict") ||
					(diff < 0 && mode === "minimum") ||
					(diff > 0 && !expected && mode === "minimum")) &&
				!(expected && containsLineTerminator(whitespace))
			) {
				/*
				 * A colon inside a key-value property always has something on
				 * either side of it, so neither lookup can return `null`. A
				 * comment can come back instead of a token, and only `loc` and
				 * `range` are read of either.
				 */
				const nextColon = getNextColon(property.key),
					tokenBeforeColon = /** @type {Token} */ (
						sourceCode.getTokenBefore(nextColon, {
							includeComments: true,
						})
					),
					tokenAfterColon = /** @type {Token} */ (
						sourceCode.getTokenAfter(nextColon, {
							includeComments: true,
						})
					),
					isKeySide = side === "key",
					isExtra = diff > 0,
					diffAbs = Math.abs(diff),
					spaces = Array(diffAbs + 1).join(" ");

				const locStart = isKeySide
					? tokenBeforeColon.loc.end
					: nextColon.loc.start;
				const locEnd = isKeySide
					? nextColon.loc.start
					: tokenAfterColon.loc.start;
				const missingLoc = isKeySide
					? tokenBeforeColon.loc
					: tokenAfterColon.loc;
				const loc = isExtra
					? { start: locStart, end: locEnd }
					: missingLoc;

				let fix;

				if (isExtra) {
					/** @type {Range} */
					let range;

					// Remove whitespace
					if (isKeySide) {
						range = [
							tokenBeforeColon.range[1],
							tokenBeforeColon.range[1] + diffAbs,
						];
					} else {
						range = [
							tokenAfterColon.range[0] - diffAbs,
							tokenAfterColon.range[0],
						];
					}
					/**
					 * Removes the extra whitespace.
					 * @param {RuleFixer} fixer The fixer to apply.
					 * @returns {EditInfo} The edit removing the whitespace.
					 */
					fix = function (fixer) {
						return fixer.removeRange(range);
					};
				} else {
					// Add whitespace
					if (isKeySide) {
						/**
						 * Adds the missing whitespace after the key.
						 * @param {RuleFixer} fixer The fixer to apply.
						 * @returns {EditInfo} The edit adding the whitespace.
						 */
						fix = function (fixer) {
							return fixer.insertTextAfter(
								tokenBeforeColon,
								spaces,
							);
						};
					} else {
						/**
						 * Adds the missing whitespace before the value.
						 * @param {RuleFixer} fixer The fixer to apply.
						 * @returns {EditInfo} The edit adding the whitespace.
						 */
						fix = function (fixer) {
							return fixer.insertTextBefore(
								tokenAfterColon,
								spaces,
							);
						};
					}
				}

				let messageId;

				if (isExtra) {
					messageId = side === "key" ? "extraKey" : "extraValue";
				} else {
					messageId = side === "key" ? "missingKey" : "missingValue";
				}

				context.report({
					node: property[side],
					loc,
					messageId,
					data: {
						computed: property.computed ? "computed " : "",
						key: getKey(property),
					},
					fix,
				});
			}
		}

		/**
		 * Gets the number of characters in a key, including quotes around string
		 * keys and braces around computed property keys.
		 * @param {ASTNode} property Property of on object literal.
		 * @returns {number} Width of the key.
		 */
		function getKeyWidth(property) {
			// A property always begins with at least one token.
			const startToken = /** @type {Token} */ (
				sourceCode.getFirstToken(property)
			);
			const endToken = getLastTokenBeforeColon(property.key);

			return getGraphemeCount(
				sourceCode
					.getText()
					.slice(startToken.range[0], endToken.range[1]),
			);
		}

		/**
		 * Gets the whitespace around the colon in an object literal property.
		 * @param {ASTNode} property Property node from an object literal.
		 * @returns {{ beforeColon: string, afterColon: string } | null} Whitespace before and after the property's colon, or `null` if the property has no colon.
		 */
		function getPropertyWhitespace(property) {
			const whitespace = /(\s*):(\s*)/u.exec(
				sourceCode
					.getText()
					.slice(property.key.range[1], property.value.range[0]),
			);

			if (whitespace) {
				return {
					beforeColon: whitespace[1],
					afterColon: whitespace[2],
				};
			}
			return null;
		}

		/**
		 * Creates groups of properties.
		 * @param {ASTNode} node ObjectExpression node being evaluated.
		 * @returns {Array<Array<ASTNode>>} Groups of property AST node lists.
		 */
		function createGroups(node) {
			if (node.properties.length === 1) {
				return [node.properties];
			}

			return node.properties.reduce(
				/**
				 * Adds the property to the group being built, or starts a new one.
				 * @param {Array<Array<ASTNode>>} groups The groups built so far.
				 * @param {ASTNode} property The property being placed.
				 * @returns {Array<Array<ASTNode>>} The groups, with the property placed.
				 */
				(groups, property) => {
					const currentGroup = last(groups),
						prev = last(currentGroup);

					if (!prev || continuesPropertyGroup(prev, property)) {
						currentGroup.push(property);
					} else {
						groups.push([property]);
					}

					return groups;
				},
				[[]],
			);
		}

		/**
		 * Verifies correct vertical alignment of a group of properties.
		 * @param {Array<ASTNode>} properties List of Property AST nodes.
		 * @returns {void} No return value.
		 */
		function verifyGroupAlignment(properties) {
			/*
			 * This function only runs from the alignment branch of the visitor
			 * below, so `alignmentOptions` is non-null at the two reads of it
			 * that the checker cannot see are guarded.
			 */
			const length = properties.length,
				widths = properties.map(getKeyWidth), // Width of keys, including quotes
				align = /** @type {AlignOptions} */ (alignmentOptions).on; // "value" or "colon"
			let targetWidth = Math.max(...widths),
				beforeColon,
				afterColon,
				mode;

			if (alignmentOptions && length > 1) {
				// When aligning values within a group, use the alignment configuration.
				beforeColon = alignmentOptions.beforeColon;
				afterColon = alignmentOptions.afterColon;
				mode = alignmentOptions.mode;
			} else {
				beforeColon = multiLineOptions.beforeColon;
				afterColon = multiLineOptions.afterColon;
				mode = /** @type {AlignOptions} */ (alignmentOptions).mode;
			}

			// Conditionally include one space before or after colon
			targetWidth += align === "colon" ? beforeColon : afterColon;

			for (let i = 0; i < length; i++) {
				const property = properties[i];
				const whitespace = getPropertyWhitespace(property);

				if (whitespace) {
					// Object literal getters/setters lack a colon
					const width = widths[i];

					if (align === "value") {
						report(
							property,
							"key",
							whitespace.beforeColon,
							beforeColon,
							mode,
						);
						report(
							property,
							"value",
							whitespace.afterColon,
							targetWidth - width,
							mode,
						);
					} else {
						// align = "colon"
						report(
							property,
							"key",
							whitespace.beforeColon,
							targetWidth - width,
							mode,
						);
						report(
							property,
							"value",
							whitespace.afterColon,
							afterColon,
							mode,
						);
					}
				}
			}
		}

		/**
		 * Verifies spacing of property conforms to specified options.
		 * @param {ASTNode} node Property node being evaluated.
		 * @param {SpacingOptions} lineOptions Configured singleLine or multiLine options
		 * @returns {void} No return value.
		 */
		function verifySpacing(node, lineOptions) {
			const actual = getPropertyWhitespace(node);

			if (actual) {
				// Object literal getters/setters lack colons
				report(
					node,
					"key",
					actual.beforeColon,
					lineOptions.beforeColon,
					lineOptions.mode,
				);
				report(
					node,
					"value",
					actual.afterColon,
					lineOptions.afterColon,
					lineOptions.mode,
				);
			}
		}

		/**
		 * Verifies spacing of each property in a list.
		 * @param {Array<ASTNode>} properties List of Property AST nodes.
		 * @param {SpacingOptions} lineOptions Configured singleLine or multiLine options
		 * @returns {void} No return value.
		 */
		function verifyListSpacing(properties, lineOptions) {
			const length = properties.length;

			for (let i = 0; i < length; i++) {
				verifySpacing(properties[i], lineOptions);
			}
		}

		/**
		 * Verifies vertical alignment, taking into account groups of properties.
		 * @param {ASTNode} node ObjectExpression node being evaluated.
		 * @returns {void} No return value.
		 */
		function verifyAlignment(node) {
			createGroups(node).forEach(group => {
				const properties = group.filter(isKeyValueProperty);

				if (
					properties.length > 0 &&
					isSingleLineProperties(properties)
				) {
					verifyListSpacing(properties, multiLineOptions);
				} else {
					verifyGroupAlignment(properties);
				}
			});
		}

		//--------------------------------------------------------------------------
		// Public API
		//--------------------------------------------------------------------------

		if (alignmentOptions) {
			// Verify vertical alignment

			return {
				/**
				 * Checks the spacing of every key-value property in the object.
				 * @param {ASTNode} node The ObjectExpression node to check.
				 * @returns {void} No return value.
				 */
				ObjectExpression(node) {
					if (isSingleLine(node)) {
						verifyListSpacing(
							node.properties.filter(isKeyValueProperty),
							singleLineOptions,
						);
					} else {
						verifyAlignment(node);
					}
				},
			};
		}

		// Obey beforeColon and afterColon in each property as configured
		return {
			/**
			 * Checks the spacing around the property's colon.
			 * @param {ASTNode} node The Property node to check.
			 * @returns {void} No return value.
			 */
			Property(node) {
				verifySpacing(
					node,
					isSingleLine(node.parent)
						? singleLineOptions
						: multiLineOptions,
				);
			},
		};
	},
};

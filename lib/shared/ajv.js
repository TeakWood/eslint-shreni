/**
 * @fileoverview The instance of Ajv validator.
 * @author Evgeny Poberezkin
 */
// @ts-check

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const Ajv = require("ajv"),
	metaSchema = require("ajv/lib/refs/json-schema-draft-04.json");

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Creates an Ajv instance configured the way ESLint validates schemas.
 * @param {import("ajv").Options} [additionalOptions] Extra options for the Ajv constructor.
 * @returns {import("ajv").Ajv} The configured Ajv instance.
 */
module.exports = (additionalOptions = {}) => {
	const ajv = new Ajv({
		meta: false,
		useDefaults: true,
		validateSchema: false,
		missingRefs: "ignore",
		verbose: true,
		schemaId: "auto",
		...additionalOptions,
	});

	ajv.addMetaSchema(metaSchema);

	/*
	 * Ajv's published `Options` type does not declare `defaultMeta`, even though
	 * Ajv itself reads it, so the internal options bag is widened to set it.
	 */
	const internalOptions = /** @type {Record<string, unknown>} */ (
		// eslint-disable-next-line no-underscore-dangle -- Ajv's API
		ajv._opts
	);

	internalOptions.defaultMeta = metaSchema.id;

	return ajv;
};

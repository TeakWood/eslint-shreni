// @ts-check
/**
 * @fileoverview The instance of Ajv validator.
 * @author Evgeny Poberezkin
 */
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
 * @param {import("ajv").Options} [additionalOptions] Options merged over the defaults.
 * @returns {import("ajv").Ajv} The configured validator.
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
	 * `defaultMeta` is a real Ajv option that is missing from Ajv 6's
	 * `Options` declaration, so the internal options bag has to be widened
	 * before it can be set.
	 */
	// eslint-disable-next-line no-underscore-dangle -- Ajv's API
	/** @type {Record<string, unknown>} */ (ajv._opts).defaultMeta =
		metaSchema.id;

	return ajv;
};

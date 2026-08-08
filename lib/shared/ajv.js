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
// Types
//------------------------------------------------------------------------------

/**
 * `ajv@6` ships its own declarations (`lib/ajv.d.ts`) and exports them with
 * `export =`, so the constructor options and the instance are named through
 * the module rather than re-declared here.
 * @import { Options, Ajv as AjvInstance } from "ajv"
 */

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Creates the Ajv instance ESLint validates rule and config schemas with.
 * @param {Options} [additionalOptions] Options merged over ESLint's defaults.
 * @returns {AjvInstance} The configured validator.
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
	 * Ajv reads its fallback meta-schema out of the private `_opts` bag, but
	 * `Options` does not declare `defaultMeta`, so the write is widened to the
	 * one extra key rather than to the whole bag.
	 */
	// eslint-disable-next-line no-underscore-dangle -- Ajv's API
	/** @type {Options & { defaultMeta?: string }} */ (ajv._opts).defaultMeta =
		metaSchema.id;

	return ajv;
};

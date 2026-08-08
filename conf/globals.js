/**
 * @fileoverview Globals for ecmaVersion/sourceType
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Globals
//-----------------------------------------------------------------------------

/*
 * Each table carries an explicit `@type` rather than leaning on inference.
 * Without it, declaration emit turns every table into an `export namespace`
 * with one `let` per global — and `let eval` is a syntax error in a module,
 * which is automatically strict (TS1215). The file is reached by declaration
 * emit because `lib/rules/utils/ast-utils.js` requires it, and
 * `tests/lib/types/types.js` recompiles the emitted declarations.
 */

/** @type {Record<string, boolean>} */
const commonjs = {
	exports: true,
	global: false,
	module: false,
	require: false,
};

/** @type {Record<string, boolean>} */
const es3 = {
	Array: false,
	Boolean: false,
	constructor: false,
	Date: false,
	decodeURI: false,
	decodeURIComponent: false,
	encodeURI: false,
	encodeURIComponent: false,
	Error: false,
	escape: false,
	eval: false,
	EvalError: false,
	Function: false,
	hasOwnProperty: false,
	Infinity: false,
	isFinite: false,
	isNaN: false,
	isPrototypeOf: false,
	Math: false,
	NaN: false,
	Number: false,
	Object: false,
	parseFloat: false,
	parseInt: false,
	propertyIsEnumerable: false,
	RangeError: false,
	ReferenceError: false,
	RegExp: false,
	String: false,
	SyntaxError: false,
	toLocaleString: false,
	toString: false,
	TypeError: false,
	undefined: false,
	unescape: false,
	URIError: false,
	valueOf: false,
};

/** @type {Record<string, boolean>} */
const es5 = {
	...es3,
	JSON: false,
};

/** @type {Record<string, boolean>} */
const es2015 = {
	...es5,
	ArrayBuffer: false,
	DataView: false,
	Float32Array: false,
	Float64Array: false,
	Int16Array: false,
	Int32Array: false,
	Int8Array: false,
	Intl: false,
	Map: false,
	Promise: false,
	Proxy: false,
	Reflect: false,
	Set: false,
	Symbol: false,
	Uint16Array: false,
	Uint32Array: false,
	Uint8Array: false,
	Uint8ClampedArray: false,
	WeakMap: false,
	WeakSet: false,
};

// no new globals in ES2016
/** @type {Record<string, boolean>} */
const es2016 = {
	...es2015,
};

/** @type {Record<string, boolean>} */
const es2017 = {
	...es2016,
	Atomics: false,
	SharedArrayBuffer: false,
};

// no new globals in ES2018
/** @type {Record<string, boolean>} */
const es2018 = {
	...es2017,
};

// no new globals in ES2019
/** @type {Record<string, boolean>} */
const es2019 = {
	...es2018,
};

/** @type {Record<string, boolean>} */
const es2020 = {
	...es2019,
	BigInt: false,
	BigInt64Array: false,
	BigUint64Array: false,
	globalThis: false,
};

/** @type {Record<string, boolean>} */
const es2021 = {
	...es2020,
	AggregateError: false,
	FinalizationRegistry: false,
	WeakRef: false,
};

/** @type {Record<string, boolean>} */
const es2022 = {
	...es2021,
};

/** @type {Record<string, boolean>} */
const es2023 = {
	...es2022,
};

/** @type {Record<string, boolean>} */
const es2024 = {
	...es2023,
};

/** @type {Record<string, boolean>} */
const es2025 = {
	...es2024,
	Float16Array: false,
	Iterator: false,
};

/** @type {Record<string, boolean>} */
const es2026 = {
	...es2025,
	AsyncDisposableStack: false,
	DisposableStack: false,
	SuppressedError: false,
	Temporal: false,
};

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

module.exports = {
	commonjs,
	es3,
	es5,
	es2015,
	es2016,
	es2017,
	es2018,
	es2019,
	es2020,
	es2021,
	es2022,
	es2023,
	es2024,
	es2025,
	es2026,
};

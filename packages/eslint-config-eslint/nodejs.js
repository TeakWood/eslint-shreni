"use strict";

const {
	configs: {
		"flat/recommended-script": recommendedScriptConfig,
		"flat/recommended-module": recommendedModuleConfig,
	},
} = require("eslint-plugin-n");

const sharedRules = {
	"n/callback-return": ["error", ["cb", "callback", "next"]],
	"n/handle-callback-err": ["error", "err"],
	"n/prefer-node-protocol": "error",
};

const cjsConfigs = [
	recommendedScriptConfig,
	{
		name: "eslint-config-eslint/cjs",
		rules: {
			...sharedRules,
			"n/no-mixed-requires": "error",
			"n/no-new-require": "error",
			"n/no-path-concat": "error",
		},
	},
];

const esmConfigs = [
	recommendedModuleConfig,
	{
		name: "eslint-config-eslint/esm",
		rules: sharedRules,
	},
];

module.exports = {
	cjsConfigs,
	esmConfigs,
};

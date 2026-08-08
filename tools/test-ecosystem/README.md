# Ecosystem Tests

These tests run notable community plugins against the local ESLint repository.
They're meant to validate that current changes to ESLint won't break downstream consumers.

## Running

To build and test all plugins:

```shell
npm run test:ecosystem
```

To run on just one plugin:

```shell
npm run test:ecosystem -- --plugin <plugin-name>
```

Plugins are stored in `plugins-data.json`.
Plugin names are keys from that file.
For example, to test against `@eslint/css`:

```shell
npm run test:ecosystem -- --plugin @eslint/css
```

### Debugging Commands

When a command fails, the tail of both its stdout and its stderr is included in the reported error.
Plugin test runners report which assertions failed on stdout and write only a terse summary to stderr, so stderr alone is not enough to tell what broke.

To stream all output live instead of only seeing the tail of a failure, the [`debug`](https://www.npmjs.com/package/debug) package is used to surface the stdout of commands when `DEBUG=test:ecosystem` is enabled.

```shell
DEBUG=test:ecosystem npm run test:ecosystem -- --plugin @eslint/css
```

## Pinned Dependencies

An `install` command may name specific dependency versions, as `eslint-plugin-unicorn` does with `core-js-compat@3.49.0`.
Those pins work around a break in one of the plugin's own dependencies, not in ESLint, and removing one will fail the plugin's tests again.
Each pin is recorded with its reason and the condition for retiring it in `tests/tools/test-ecosystem.js`.

Note that `npm run test:ecosystem:update` only advances the `commit` field, so pins survive an update.
A pin should be retired deliberately, once the plugin no longer needs it.

## Updating

`plugins-data.json` contains pinned commit hashes for each repository.
Those hashes can be updated with the same script run in CI.

To update all plugins:

```shell
npm run test:ecosystem:update
```

To update just one plugin:

```shell
npm run test:ecosystem:update -- --plugin <plugin-name>
```

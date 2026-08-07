# Repo Map — Eslint Shreni

Deterministic index of source files, their exported/public symbols, and a
one-line role (each module's leading comment). Regenerated on merge. Use it to
aim your first Read/Grep/Glob — it is a map to search, not a substitute for
reading the code, and it omits tests and generated files.

## (root)

- `cypress.config.js`
- `eslint.config.js` — ESLint configuration file @author Nicholas C. Zakas
- `Makefile.js` — Build file @author nzakas

## bin

- `eslint.js`

## conf

- `ecma-version.js` — Configuration related to ECMAScript versions @author Milos Djermanovic
- `globals.js` — Globals for ecmaVersion/sourceType @author Nicholas C. Zakas

## coverage/lcov-report

- `block-navigation.js` — eslint-disable
- `prettify.js` — eslint-disable
- `sorter.js` — eslint-disable

## docs

- `.eleventy.js`
- `postcss.config.js`

## docs/_examples/custom-rule-tutorial-code

- `enforce-foo-bar.js` — Rule to enforce that `const foo` is assigned "bar". @author Ben Perlmutter
- `eslint-plugin-example.js` — Example an ESLint plugin with a custom rule. @author Ben Perlmutter
- `eslint.config.js` — Example ESLint config file that uses the custom rule from this tutorial. @author Ben Perlmutter
- `example.js` — Example of a file that will fail the custom rule in this tutorial. @author Ben Perlmutter

## docs/_examples/integration-tutorial-code

- `example-eslint-integration.js` — An example of how to integrate ESLint into your own tool @author Ben Perlmutter

## docs/_examples/integration-tutorial-code/sample-data

- `test-file.js` — Example data to lint using ESLint. This file contains a variety of errors. @author Ben Perlmutter

## docs/src/_data

- `eslintVersions.js` — Data for version selectors @author Milos Djermanovic
- `flags.js` — Convenience helper for feature flags. @author Nicholas C. Zakas
- `helpers.js`
- `layout.js`
- `rules_categories.js`
- `site.js` — Convenience helper for site data. @author Nicholas C. Zakas

## docs/src/_plugins

- `md-syntax-highlighter.js` — MIT License Copyright (c) 2019-present, Yuxi (Evan) You Permission is hereby granted, free of charg…
- `pre-wrapper.js`

## docs/src/assets/js

- `components-index.js`
- `css-vars-ponyfill@2.js` — ! css-vars-ponyfill v2.1.2 https://jhildenbiddle.github.io/css-vars-ponyfill/ (c) 2018-2019 John Hi…
- `focus-visible.js` — Applies the :focus-visible polyfill at the given scope. A scope in this case is either the top-leve…
- `inert-polyfill.js` — inert polyfill source: https://cdn.rawgit.com/GoogleChrome/inert-polyfill/v0.1.0/inert-polyfill.min…
- `main.js`
- `scroll-up-btn.js`
- `search.js` — Search functionality @author Nicholas C. Zakas
- `tabs.js`
- `themes.js`

## docs/src/static

- `serviceworker.js`

## docs/tools

- `code-block-utils.js` — A utility related to markdown code blocks. @author Yosuke Ota
- `markdown-it-rule-example.js`
- `prism-eslint-hook.js` — Use Prism hooks to draw linting errors with red markers on markdown code blocks. @author Yosuke Ota
- `validate-links.js`

## lib

- `api.js` — Expose out ESLint and CLI to require. @author Ian Christian Myers
- `cli.js` — Main CLI object. @author Nicholas C. Zakas
- `config-api.js` — exports for config helpers @author Nicholas C. Zakas
- `options.js` — Options configuration for optionator. @author George Zahariev
- `universal.js` — exports for browsers @author 唯然<weiran.zsd@outlook.com>
- `unsupported-api.js` — APIs that are not officially supported by ESLint. These APIs may change or be removed at any time.…

## lib/cli-engine

- `hash.js` — Defining the hashing function in one place. @author Michael Ficarra
- `lint-result-cache.js` — Utility for caching lint results. @author Kevin Partington

## lib/cli-engine/formatters

- `html.js` — HTML reporter @author Julian Laval
- `json-with-metadata.js` — JSON reporter, including rules metadata @author Chris Meyer
- `json.js` — JSON reporter @author Burak Yigit Kaya aka BYK
- `stylish.js` — Stylish reporter @author Sindre Sorhus

## lib/config

- `config-loader.js` — Utility to load config files @author Nicholas C. Zakas
- `config.js` — The `Config` class @author Nicholas C. Zakas
- `default-config.js` — Default configuration @author Nicholas C. Zakas
- `flat-config-array.js` — Flat Config Array @author Nicholas C. Zakas
- `flat-config-schema.js` — Flat config schema @author Nicholas C. Zakas

## lib/eslint

- `eslint-helpers.js` — Helper functions for ESLint class @author Nicholas C. Zakas
- `eslint.js` — Main class using flat config @author Nicholas C. Zakas
- `index.js`
- `worker.js` — Worker thread for multithread linting. @author Francesco Trotta

## lib/languages/js

- `index.js` — JavaScript Language Object @author Nicholas C. Zakas
- `validate-language-options.js` — The schema to validate language options @author Nicholas C. Zakas

## lib/languages/js/source-code

- `index.js`
- `source-code.js` — Abstraction of JavaScript source code. @author Nicholas C. Zakas

## lib/languages/js/source-code/token-store

- `backward-token-comment-cursor.js` — Define the cursor which iterates tokens and comments in reverse. @author Toru Nagashima
- `backward-token-cursor.js` — Define the cursor which iterates tokens only in reverse. @author Toru Nagashima
- `cursor.js` — Define the abstract class about cursors which iterate tokens. @author Toru Nagashima
- `cursors.js` — Define 2 token factories; forward and backward. @author Toru Nagashima
- `decorative-cursor.js` — Define the abstract class about cursors which manipulate another cursor. @author Toru Nagashima
- `filter-cursor.js` — Define the cursor which ignores specified tokens. @author Toru Nagashima
- `forward-token-comment-cursor.js` — Define the cursor which iterates tokens and comments. @author Toru Nagashima
- `forward-token-cursor.js` — Define the cursor which iterates tokens only. @author Toru Nagashima
- `index.js` — Object to handle access and retrieval of tokens. @author Brandon Mills
- `limit-cursor.js` — Define the cursor which limits the number of tokens. @author Toru Nagashima
- `padded-token-cursor.js` — Define the cursor which iterates tokens only, with inflated range. @author Toru Nagashima
- `skip-cursor.js` — Define the cursor which ignores the first few tokens. @author Toru Nagashima
- `utils.js` — Define utility functions for token store. @author Toru Nagashima

## lib/linter

- `apply-disable-directives.js` — A module that filters reported problems based on `eslint-disable` and `eslint-enable` comments
- `esquery.js` — ESQuery wrapper for ESLint. @author Nicholas C. Zakas
- `file-context.js` — The FileContext class. @author Nicholas C. Zakas
- `file-report.js` — A class to track messages reported by the linter for a file. @author Nicholas C. Zakas
- `index.js`
- `interpolate.js` — Interpolate keys from an object into a string with {{ }} markers. @author Jed Fox
- `linter.js` — Main Linter Class @author Gyandeep Singh @author aladdin-add
- `rule-fixer.js` — An object that creates fix commands for rules. @author Nicholas C. Zakas
- `source-code-fixer.js` — An object that caches and applies source code fixes. @author Nicholas C. Zakas
- `source-code-traverser.js` — Traverser for SourceCode objects. @author Nicholas C. Zakas
- `source-code-visitor.js` — SourceCodeVisitor class @author Nicholas C. Zakas
- `timing.js` — Tracks performance of individual rules. @author Brandon Mills
- `vfile.js` — Virtual file @author Nicholas C. Zakas

## lib/linter/code-path-analysis

- `code-path-analyzer.js` — A class of the code path analyzer. @author Toru Nagashima
- `code-path-segment.js` — The CodePathSegment class. @author Toru Nagashima
- `code-path-state.js` — A class to manage state of generating a code path. @author Toru Nagashima
- `code-path.js` — A class of the code path. @author Toru Nagashima
- `debug-helpers.js` — Helpers to debug for code path analysis. @author Toru Nagashima
- `fork-context.js` — A class to operate forking. This is state of forking. This has a fork list and manages it.
- `id-generator.js` — A class of identifiers generator for code path segments. Each rule uses the identifier of code path…

## lib/rule-tester

- `index.js`
- `rule-tester.js` — Mocha/Jest test wrapper @author Ilya Volodin

## lib/rules

- `accessor-pairs.js` — Rule to enforce getter and setter pairs in objects and classes. @author Gyandeep Singh
- `array-bracket-newline.js` — Rule to enforce linebreaks after open and before close array brackets @author Jan Peer Stöcklmair <…
- `array-bracket-spacing.js` — Disallows or enforces spaces inside of array brackets. @author Jamund Ferguson @deprecated in ESLin…
- `array-callback-return.js` — Rule to enforce return statements in callbacks of array's methods @author Toru Nagashima
- `array-element-newline.js` — Rule to enforce line breaks after each array element @author Jan Peer Stöcklmair <https://github.co…
- `arrow-body-style.js` — Rule to require braces in arrow function body. @author Alberto Rodríguez
- `arrow-parens.js` — Rule to require parens in arrow function arguments. @author Jxck @deprecated in ESLint v8.53.0
- `arrow-spacing.js` — Rule to define spacing before/after arrow function's arrow. @author Jxck @deprecated in ESLint v8.5…
- `block-scoped-var.js` — Rule to check for "block scoped" variables by binding context @author Matt DuVall <http://www.mattd…
- `block-spacing.js` — A rule to disallow or enforce spaces inside of single line blocks. @author Toru Nagashima
- `brace-style.js` — Rule to flag block statements that do not use the one true brace style @author Ian Christian Myers
- `callback-return.js` — Enforce return after a callback. @author Jamund Ferguson @deprecated in ESLint v7.0.0
- `camelcase.js` — Rule to flag non-camelcased identifiers @author Nicholas C. Zakas
- `capitalized-comments.js` — enforce or disallow capitalization of the first letter of a comment @author Kevin Partington
- `class-methods-use-this.js` — Rule to enforce that all class methods use 'this'. @author Patrick Williams
- `comma-dangle.js` — Rule to forbid or enforce dangling commas. @author Ian Christian Myers @deprecated in ESLint v8.53.0
- `comma-spacing.js` — Comma spacing - validates spacing before and after comma @author Vignesh Anand aka vegetableman.
- `comma-style.js` — Comma style - enforces comma styles of two types: last and first @author Vignesh Anand aka vegetabl…
- `complexity.js` — Counts the cyclomatic complexity of each function of the script. See https://en.wikipedia.org/wiki/…
- `computed-property-spacing.js` — Disallows or enforces spaces inside computed properties. @author Jamund Ferguson @deprecated in ESL…
- `consistent-return.js` — Rule to flag consistent return values @author Nicholas C. Zakas
- `consistent-this.js` — Rule to enforce consistent naming of "this" context variables @author Raphael Pigulla
- `constructor-super.js` — A rule to verify `super()` callings in constructor. @author Toru Nagashima
- `curly.js` — Rule to flag statements without curly braces @author Nicholas C. Zakas
- `default-case-last.js` — Rule to enforce `default` clauses in `switch` statements to be last @author Milos Djermanovic
- `default-case.js` — require default case in switch statements @author Aliaksei Shytkin
- `default-param-last.js` — enforce default parameters to be last @author Chiawen Chen
- `dot-location.js` — Validates newlines before and after dots @author Greg Cochard @deprecated in ESLint v8.53.0
- `dot-notation.js` — Rule to warn about using dot notation instead of square bracket notation when possible.
- `eol-last.js` — Require or disallow newline at the end of files @author Nodeca Team <https://github.com/nodeca>
- `eqeqeq.js` — Rule to flag statements that use != and == instead of !== and === @author Nicholas C. Zakas
- `for-direction.js` — enforce `for` loop update clause moving the counter in the right direction.(for-direction)
- `func-call-spacing.js` — Rule to control spacing within function calls @author Matt DuVall <http://www.mattduvall.com>
- `func-name-matching.js` — Rule to require function names to match the name of the variable or property to which they are assi…
- `func-names.js` — Rule to warn when a function expression does not have a name. @author Kyle T. Nunery
- `func-style.js` — Rule to enforce a particular function style @author Nicholas C. Zakas
- `function-call-argument-newline.js` — Rule to enforce line breaks between arguments of a function call @author Alexey Gonchar <https://gi…
- `function-paren-newline.js` — enforce consistent line breaks inside function parentheses @author Teddy Katz @deprecated in ESLint…
- `generator-star-spacing.js` — Rule to check the spacing around the * in generator functions. @author Jamund Ferguson
- `getter-return.js` — Enforces that a return statement is present in property getters. @author Aladdin-ADD(hh_2013@foxmai…
- `global-require.js` — Rule for disallowing require() outside of the top-level module context @author Jamund Ferguson
- `grouped-accessor-pairs.js` — Rule to require grouped accessor pairs in object literals and classes @author Milos Djermanovic
- `guard-for-in.js` — Rule to flag for-in loops without if statements inside @author Nicholas C. Zakas
- `handle-callback-err.js` — Ensure handling of errors when we know they exist. @author Jamund Ferguson @deprecated in ESLint v7…
- `id-blacklist.js` — Rule that warns when identifier names that are specified in the configuration are used.
- `id-denylist.js` — Rule that warns when identifier names that are specified in the configuration are used.
- `id-length.js` — Rule that warns when identifier names are shorter or longer than the values provided in configurati…
- `id-match.js` — Rule to flag non-matching identifiers @author Matthieu Larcher
- `implicit-arrow-linebreak.js` — enforce the location of arrow function bodies @author Sharmila Jesupaul @deprecated in ESLint v8.53…
- `indent-legacy.js` — This option sets a specific tab width for your code This rule has been ported and modified from nod…
- `indent.js` — This rule sets a specific indentation style and width for your code @author Teddy Katz
- `index.js` — Collects the built-in rules into a map structure so that they can be imported all at once and witho…
- `init-declarations.js` — A rule to control the style of variable initializations. @author Colin Ihrig
- `jsx-quotes.js` — A rule to ensure consistent quotes used in jsx syntax. @author Mathias Schreck <https://github.com/…
- `key-spacing.js` — Rule to specify spacing of object literal keys and values @author Brandon Mills @deprecated in ESLi…
- `keyword-spacing.js` — Rule to enforce spacing before and after keywords. @author Toru Nagashima @deprecated in ESLint v8.…
- `line-comment-position.js` — Rule to enforce the position of line comments @author Alberto Rodríguez @deprecated in ESLint v9.3.0
- `linebreak-style.js` — Rule to enforce a single linebreak style. @author Erik Mueller @deprecated in ESLint v8.53.0
- `lines-around-comment.js` — Enforces empty lines around comments. @author Jamund Ferguson @deprecated in ESLint v8.53.0
- `lines-around-directive.js` — Require or disallow newlines around directives. @author Kai Cataldo @deprecated in ESLint v4.0.0
- `lines-between-class-members.js` — Rule to check empty newline between class members @author 薛定谔的猫<hh_2013@foxmail.com> @deprecated in…
- `logical-assignment-operators.js` — Rule to replace assignment expressions with logical operator assignment @author Daniel Martens
- `max-classes-per-file.js` — Enforce a maximum number of classes per file @author James Garbutt <https://github.com/43081j>
- `max-depth.js` — A rule to set the maximum depth block can be nested in a function. @author Ian Christian Myers
- `max-len.js` — Rule to check for max length on a line. @author Matt DuVall <http://www.mattduvall.com>
- `max-lines-per-function.js` — A rule to set the maximum number of line of code in a function. @author Pete Ward <peteward44@gmail…
- `max-lines.js` — enforce a maximum file length @author Alberto Rodríguez
- `max-nested-callbacks.js` — Rule to enforce a maximum number of nested callbacks. @author Ian Christian Myers
- `max-params.js` — Rule to flag when a function has too many parameters @author Ilya Volodin
- `max-statements-per-line.js` — Specify the maximum number of statements allowed per line. @author Kenneth Williams @deprecated in…
- `max-statements.js` — A rule to set the maximum number of statements in a function. @author Ian Christian Myers
- `multiline-comment-style.js` — enforce a particular style for multiline comments @author Teddy Katz @deprecated in ESLint v9.3.0
- `multiline-ternary.js` — Enforce newlines between operands of ternary expressions @author Kai Cataldo @deprecated in ESLint…
- `new-cap.js` — Rule to flag use of constructors without capital letters @author Nicholas C. Zakas
- `new-parens.js` — Rule to flag when using constructor without parentheses @author Ilya Volodin @deprecated in ESLint…
- `newline-after-var.js` — Rule to check empty newline after "var" statement @author Gopal Venkatesan @deprecated in ESLint v4…
- `newline-before-return.js` — Rule to require newlines before `return` statement @author Kai Cataldo @deprecated in ESLint v4.0.0
- `newline-per-chained-call.js` — Rule to ensure newline per method call when chaining calls @author Rajendra Patil @author Burak Yig…
- `no-alert.js` — Rule to flag use of alert, confirm, prompt @author Nicholas C. Zakas
- `no-array-constructor.js` — Disallow construction of dense arrays using the Array constructor @author Matt DuVall <http://www.m…
- `no-async-promise-executor.js` — disallow using an async function as a Promise executor @author Teddy Katz
- `no-await-in-loop.js` — Rule to disallow uses of await inside of loops. @author Nat Mote (nmote)
- `no-bitwise.js` — Rule to flag bitwise identifiers @author Nicholas C. Zakas
- `no-buffer-constructor.js` — disallow use of the Buffer() constructor @author Teddy Katz @deprecated in ESLint v7.0.0
- `no-caller.js` — Rule to flag use of arguments.callee and arguments.caller. @author Nicholas C. Zakas
- `no-case-declarations.js` — Rule to flag use of an lexical declarations inside a case clause @author Erik Arvidsson
- `no-catch-shadow.js` — Rule to flag variable leak in CatchClauses in IE 8 and earlier @author Ian Christian Myers
- `no-class-assign.js` — A rule to disallow modifying variables of class declarations @author Toru Nagashima
- `no-compare-neg-zero.js` — The rule should warn against code that tries to compare against -0. @author Aladdin-ADD <hh_2013@fo…
- `no-cond-assign.js` — Rule to flag assignment in a conditional statement's test expression @author Stephen Murray <spmurr…
- `no-confusing-arrow.js` — A rule to warn against using arrow functions when they could be confused with comparisons
- `no-console.js` — Rule to flag use of console object @author Nicholas C. Zakas
- `no-const-assign.js` — A rule to disallow modifying variables that are declared using `const` @author Toru Nagashima
- `no-constant-binary-expression.js` — Rule to flag constant comparisons and logical expressions that always/never short circuit
- `no-constant-condition.js` — Rule to flag use constant conditions @author Christian Schulz <http://rndm.de>
- `no-constructor-return.js` — Rule to disallow returning value from constructor. @author Pig Fang <https://github.com/g-plane>
- `no-continue.js` — Rule to flag use of continue statement @author Borislav Zhivkov
- `no-control-regex.js` — Rule to forbid control characters from regular expressions. @author Nicholas C. Zakas
- `no-debugger.js` — Rule to flag use of a debugger statement @author Nicholas C. Zakas
- `no-delete-var.js` — Rule to flag when deleting variables @author Ilya Volodin
- `no-div-regex.js` — Rule to check for ambiguous div operator in regexes @author Matt DuVall <http://www.mattduvall.com>
- `no-dupe-args.js` — Rule to flag duplicate arguments @author Jamund Ferguson
- `no-dupe-class-members.js` — A rule to disallow duplicate name in class members. @author Toru Nagashima
- `no-dupe-else-if.js` — Rule to disallow duplicate conditions in if-else-if chains @author Milos Djermanovic
- `no-dupe-keys.js` — Rule to flag use of duplicate keys in an object. @author Ian Christian Myers
- `no-duplicate-case.js` — Rule to disallow a duplicate case label. @author Dieter Oberkofler @author Burak Yigit Kaya
- `no-duplicate-imports.js` — Restrict usage of duplicate imports. @author Simen Bekkhus
- `no-else-return.js` — Rule to flag `else` after a `return` in `if` @author Ian Christian Myers
- `no-empty-character-class.js` — Rule to flag the use of empty character classes in regular expressions @author Ian Christian Myers
- `no-empty-function.js` — Rule to disallow empty functions. @author Toru Nagashima
- `no-empty-pattern.js` — Rule to disallow an empty pattern @author Alberto Rodríguez
- `no-empty-static-block.js` — Rule to disallow empty static blocks. @author Sosuke Suzuki
- `no-empty.js` — Rule to flag use of an empty block statement @author Nicholas C. Zakas
- `no-eq-null.js` — Rule to flag comparisons to null without a type-checking operator. @author Ian Christian Myers
- `no-eval.js` — Rule to flag use of eval() statement @author Nicholas C. Zakas
- `no-ex-assign.js` — Rule to flag assignment of the exception parameter @author Stephen Murray <spmurrayzzz>
- `no-extend-native.js` — Rule to flag adding properties to native object's prototypes. @author David Nelson
- `no-extra-bind.js` — Rule to flag unnecessary bind calls @author Bence Dányi <bence@danyi.me>
- `no-extra-boolean-cast.js` — Rule to flag unnecessary double negation in Boolean contexts @author Brandon Mills
- `no-extra-label.js` — Rule to disallow unnecessary labels @author Toru Nagashima
- `no-extra-parens.js` — Disallow parenthesising higher precedence subexpressions. @author Michael Ficarra @deprecated in ES…
- `no-extra-semi.js` — Rule to flag use of unnecessary semicolons @author Nicholas C. Zakas @deprecated in ESLint v8.53.0
- `no-fallthrough.js` — Rule to flag fall-through cases in switch statements. @author Matt DuVall <http://mattduvall.com/>
- `no-floating-decimal.js` — Rule to flag use of a leading/trailing decimal point in a numeric literal @author James Allardice
- `no-func-assign.js` — Rule to flag use of function declaration identifiers as variables. @author Ian Christian Myers
- `no-global-assign.js` — Rule to disallow assignments to native objects or read-only global variables @author Ilya Volodin
- `no-implicit-coercion.js` — A rule to disallow the type conversions with shorter notations. @author Toru Nagashima
- `no-implicit-globals.js` — Rule to check for implicit global variables, functions and classes. @author Joshua Peek
- `no-implied-eval.js` — Rule to flag use of implied eval via setTimeout and setInterval @author James Allardice
- `no-import-assign.js` — Rule to flag updates of imported bindings. @author Toru Nagashima <https://github.com/mysticatea>
- `no-inline-comments.js` — Enforces or disallows inline comments. @author Greg Cochard
- `no-inner-declarations.js` — Rule to enforce declarations in program or function body root. @author Brandon Mills
- `no-invalid-regexp.js` — Validate strings passed to the RegExp constructor @author Michael Ficarra
- `no-invalid-this.js` — A rule to disallow `this` keywords in contexts where the value of `this` is `undefined`.
- `no-irregular-whitespace.js` — Rule to disallow whitespace that is not a tab or space, whitespace inside strings and comments are…

_Map truncated at 234/600 files to fit the prompt budget. Grep for anything not listed._

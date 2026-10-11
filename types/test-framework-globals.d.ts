/**
 * @fileoverview Ambient declarations for the globals a test framework injects.
 *
 * `RuleTester` runs inside the user's test framework and drives it through
 * whatever `describe` and `it` it finds on the global object, falling back to
 * its own handlers when neither is there. Those globals are not declared by
 * anything this package depends on, so without this file every probe for them
 * is TS2662.
 *
 * They are declared as possibly `undefined` on purpose: that is what makes the
 * `typeof x === "function"` guards in `lib/rule-tester/rule-tester.js`
 * load-bearing rather than redundant. Pulling in `@types/mocha` instead would
 * declare them as always present, and would commit this package to one
 * framework's shape for `it.only`.
 */

/** One of the functions a test framework provides. */
type TestFrameworkGlobal = {
	(text: string, method: () => void): unknown;

	/** The exclusive variant, which not every framework provides. */
	only?: (text: string, method: () => void) => unknown;
};

declare var describe: TestFrameworkGlobal | undefined;
declare var it: TestFrameworkGlobal | undefined;

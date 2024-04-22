# Contributing

This document covers how you can contribute to ZenFS, as well as some choices ZenFS makes.

## Issues and pull requests

When opening an issue, write a short yet descriptive name for the title. For example, putting the first line of an error stack trace is not a descriptive title. You do not need to triage the issue or PR, a maintainer will give it the applicable tags.

Please copy logs, terminal output, and code into a code block in the issue or PR. Do not include screenshots since those are very difficult to debug.

## Code

-   Avoid [callback hell](http://callbackhell.com/)— this is why ZenFS uses `async`/`await` a lot. This also includes nesting in general.
-   Document code. For the different functions and variables, write a short description of what it does and how it should be used. I certainly haven't been the best about doing this, so if you find missing docs an issue or PR would be welcome.

## NPM vs 3rd party package managers

ZenFS used `npm` rather than `pnpm` or `yarn` since it makes it easier for new contributors and simplifies tooling.

## Building

You can build the project with `npm run build`, or run watch mode with `npm run dev`.

ZenFS produces two builds: One using `tsc`, which is meant for almost all use cases, and `esbuild` which bundles the project into a single minified file for browsers.

## Formatting

You can automatically run formatting with the `npm run format` command

Tabs are used in formatting since they take up less space in files, in addition to making it easier to work with. You can't accidently click the wrong space then have to move around trying to delete the single tab width of indentation.

Trailing commas are used to reduce the amount of individual line changes in commits, which helps to improve clarity and commit diffs. For example:

```diff
const someObject = {
	a: 1,
	b: 2,
+	c: 3,
}

```

instead of

```diff
const someObject = {
	a: 1,
-	b: 2
+	b: 2,
+	c: 3
}

```

Other style choices are made to steamline the development process, making faster or more efficent. If you make changes to formatting, please make sure they make the development process better, not worse.

## Tests

You can run tests with the `npm test` command.

Tests are located in the `tests` directory. They are written in Typescript to catch type errors, and test step-by-step using Jest. Suite names are focused around a set of features (directories, links, permissions, etc.) rather than specific functions or classes.

There is also a couple of _very_ important files.

`assignment.ts` tests whether the exported `fs` is compatible with Node's exported `fs` module, which catches new feature additions.

`common.ts` provides the framework used for testing. It copys files from `tests/fixtures` to the virtual file system. These files probably aren't needed on their own, and could be generated at test runtime, though they work fine at the time of writing. I think the time spent making those changes could be better spent on actual features. `common.ts` also exports an `fs` module used by all the tests. In the future, I plan on making it possible to test different backends, which would be handled by `common.ts`

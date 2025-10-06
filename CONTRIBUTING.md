# Contributing

This document covers how you can contribute to ZenFS and how to work with the project's tooling.

## Discussions, issues and pull requests

When opening an issue or discussion, write a short descriptive name for the title. For example, putting the first line of an error stack trace is _not_ a descriptive title. You do not need to triage the issue or PR, a maintainer will give it the applicable tags.

Please copy logs, terminal output, and code into a code block in the issue or PR. Do not include screenshots since those are very difficult to debug.

### Issues vs Discussions

Issues are used to track bugs and features. For anything else you probably want to open a discussion.

### Bug Reports

When submitting a bug report, you must submit a [Minimal reproducible example](https://en.wikipedia.org/wiki/Minimal_reproducible_example) that does not depend on third party code. Failing to provide one may lead to delays in resolving the issue or outright closure.

## Code Style

#### Nesting

- Avoid [callback hell](http://callbackhell.com/)— this is why ZenFS uses `async`/`await` a lot.
- Use [guard clauses](<https://en.wikipedia.org/wiki/Guard_(computer_science)>) to reduce indentation
- If you're more of a visual learner, this video is helpful: [Why You Shouldn't Nest Your Code](https://youtu.be/CFRhGnuXG-4)

#### Naming things

- Don't use single letter variable names, with the exception of `i` in `for` loops
- Don't abbreviate in variable names
- Don't put types in variable names, it already has a type
- Don't put units in your variable names, but do include units in documentation if the type does not abstract the unit
    - Example #1: A variable `time: Date` doesn't need a unit because `Date` encapsulates units
    - Example #2: A variable `time: number` will need a unit in documentation, since it could be seconds, minutes, etc.
- Don't put types in types, for example prefixing an interface name with "I"
- Don't name a class "Base" or "Abstract"

The [Naming Things in Code](https://youtu.be/-J3wNP6u5YU) video covers everything, though you should keep in mind:

- Units will go into documentation if they are needed
- Bend the utils recommendation since some code can't be attributed to some other piece of code, it really is just a utility.

#### Documentation

For the different functions and variables, write a short description of what it does and how it should be used.
I certainly haven't been the best about doing this, so if you find missing or outdated documentation an issue or PR would be welcome.

## NPM vs 3rd party package managers

ZenFS uses `npm` rather than `pnpm` or `yarn` since it makes it easier for new contributors and simplifies tooling.

## Building

You can build the project with `npm run build` or simply `npx tsc`.
Run watch mode with `npm run dev`.
ZenFS builds using `tsc` to keep tooling simple.

## Formatting

You can automatically run formatting with the `npm run format` command

Tabs are used in formatting since they take up less space in files, in addition to making it easier to work with.
You can't accidentally click the wrong space then have to move around trying to delete the single tab width of indentation.

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

ZenFS' styling is aimed at improving developer experience.
If you make changes to formatting, make sure they improve the development experience.

## Tests

You can run tests with the `npm test` command.

Tests are located in the `tests` directory. They are written in Typescript to catch type errors, and test step-by-step using Node's native testing.
Suite names are generally focused around a set of features (directories, links, permissions, etc.) rather than specific functions or classes.

Tests are run using the `zenfs-test` command, which comes from `scripts/test.js`.
This makes it as easy as possible to change the configuration used for tests.
Run `npx zenfs-test --help` to see all the options.

`common.ts` provides the framework used for testing.
It copies files from `tests/data` to the virtual file system.
These files probably aren't needed on their own, and could be generated at test runtime, though they work fine at the time of writing.
I think the time spent making those changes could be better spent on actual features.
`common.ts` also exports an `fs` module used by all the tests.

#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		verbose: { short: 'w', type: 'boolean', default: false },
		test: { short: 't', type: 'string' },
		forceExit: { short: 'f', type: 'boolean', default: false },
		common: { short: 'C', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
	},
	allowPositionals: true,
});

if (options.help) {
	console.log(`zenfs-test [...options] <...paths> 

Paths: The setup files to run tests on

Options:
    --help, -h          Outputs this help message
    --verbose,-w        Output verbose messages
    --test,-t <glob>    Which test(s) to run
    --forceExit, -f	    Whether to use --test-force-exit
    --common, -C        Also run tests not specific to any backend
	--quiet, -q         Don't output normal messages`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.error('ERROR: Can not specify --verbose and --quiet');
	process.exit(1);
}

options.verbose && options.forceExit && console.debug('Forcing tests to exit (--test-force-exit)');

if (!existsSync(join(import.meta.dirname, '../dist'))) {
	console.error('ERROR: Missing build. If you are using an installed package, please submit a bug report.');
	process.exit(1);
}

const coverage = join(import.meta.dirname, '../.coverage');
if (existsSync(coverage)) rmSync(coverage, { recursive: true });
mkdirSync(coverage);
process.env.NODE_V8_COVERAGE = coverage;

if (options.common) {
	!options.quiet && console.log('Running common tests...');
	try {
		execSync("tsx --test --experimental-test-coverage 'tests/**/!(fs)/*.test.ts'", {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
	} catch {
		console.error('Common tests failed');
	}
}

const testsGlob = join(import.meta.dirname, `../tests/fs/${options.test || '*'}.test.ts`);

for (const setupFile of positionals) {
	if (!existsSync(setupFile)) {
		!options.quiet && console.warn('Skipping tests for non-existent setup file:', setupFile);
		continue;
	}

	!options.quiet && console.debug('Running tests using setup:', setupFile);
	process.env.SETUP = setupFile;

	try {
		execSync(['tsx --test --experimental-test-coverage', options.forceExit ? '--test-force-exit' : '', testsGlob, process.env.CMD].join(' '), {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
	} catch {
		!options.quiet && console.error('Tests failed:', setupFile);
	}
}

execSync('npx c8 report --reporter=text', { stdio: 'inherit' });
rmSync('.coverage', { recursive: true });

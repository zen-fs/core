#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		verbose: { type: 'boolean', default: false },
		test: { type: 'string' },
		forceExit: { short: 'f', type: 'boolean', default: false },
	},
	allowPositionals: true,
});

if (options.help) {
	console.log(`zenfs-test [...options] <...paths> 

paths: The setup files to run tests on

options:
	--help, -h		Outputs this help message
	--verbose		Output verbose messages
	--test			Which test to run
	--forceExit		Whether to use --test-force-exit
	`);
	process.exit();
}

if (options.verbose) console.debug('Forcing tests to exit (--test-force-exit)');

if (!existsSync(join(import.meta.dirname, '../dist'))) {
	console.log('ERROR: Missing build. If you are using an installed package, please submit a bug report.');
	process.exit(1);
}

const testsGlob = join(import.meta.dirname, `../tests/fs/${options.test || '*'}.test.ts`);

for (const setupFile of positionals) {
	if (options.verbose) console.debug('Running tests for:', setupFile);
	process.env.SETUP = setupFile;
	if (!existsSync(setupFile)) {
		console.log('ERROR: Skipping non-existent file:', setupFile);
		continue;
	}

	try {
		execSync(['tsx --test --experimental-test-coverage', options.forceExit ? '--test-force-exit' : '', testsGlob, process.env.CMD].join(' '), { stdio: 'inherit' });
	} catch {
		if (options.verbose) console.error('Tests failed:', setupFile);
	}
}

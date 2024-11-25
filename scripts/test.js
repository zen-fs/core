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
    --forceExit, -f	    Whether to use --test-force-exit`);
	process.exit();
}

if (options.verbose) console.debug('Forcing tests to exit (--test-force-exit)');

if (!existsSync(join(import.meta.dirname, '../dist'))) {
	console.log('ERROR: Missing build. If you are using an installed package, please submit a bug report.');
	process.exit(1);
}

const coverage = join(import.meta.dirname, '../.coverage');
if (existsSync(coverage)) rmSync(coverage, { recursive: true });
mkdirSync(coverage);
process.env.NODE_V8_COVERAGE = coverage;

const testsGlob = join(import.meta.dirname, `../tests/fs/${options.test || '*'}.test.ts`);

for (const setupFile of positionals) {
	if (!existsSync(setupFile)) {
		console.warn('ERROR: Skipping non-existent file:', setupFile);
		continue;
	}

	if (options.verbose) console.debug('Running tests for:', setupFile);
	process.env.SETUP = setupFile;

	try {
		execSync(['tsx --test --experimental-test-coverage', options.forceExit ? '--test-force-exit' : '', testsGlob, process.env.CMD].join(' '), {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
	} catch {
		if (options.verbose) console.error('Tests failed:', setupFile);
	}
}

execSync('npx c8 report --reporter=text', { stdio: 'inherit' });
rmSync('.coverage', { recursive: true });

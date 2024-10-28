#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		verbose: { type: 'boolean', default: false },
	},
	allowPositionals: true,
});

if (options.help) {
	console.log(`zenfs-test [...options] <...paths> 

paths: The setup files to run tests on

options:
	--help, -h		Outputs this help message
	--verbose		Output verbose messages
	`);
	process.exit();
}

for (const setupFile of positionals) {
	if (options.verbose) console.debug('Running tests for:', setupFile);
	process.env.SETUP = setupFile;
	execSync('tsx --test --experimental-test-coverage ' + join(import.meta.dirname, '../tests/fs/*.test.ts'), { stdio: 'inherit' });
}

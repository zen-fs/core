#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		verbose: { short: 'w', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
		test: { short: 't', type: 'string' },
		force: { short: 'f', type: 'boolean', default: false },
		auto: { short: 'a', type: 'boolean', default: false },
		build: { short: 'b', type: 'boolean', default: false },
		common: { short: 'c', type: 'boolean', default: false },
		coverage: { type: 'string', default: 'tests/.coverage' },
	},
	allowPositionals: true,
});

if (options.help) {
	console.log(`zenfs-test [...options] <...paths> 

Paths: The setup files to run tests on

Options:
    --help, -h          Outputs this help message
    --verbose,-w        Output verbose messages
    --quiet, -q         Don't output normal messages
    --test,-t <glob>    Which test(s) to run
    --force, -f     Whether to use --test-force-exit
    --auto, -a          Automatically detect setup files
	--build, -b         Run the npm build script prior to running tests
    --common, -c        Also run tests not specific to any backend
`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.error('ERROR: Can not specify --verbose and --quiet');
	process.exit(1);
}

options.verbose && options.force && console.debug('Forcing tests to exit (--test-force-exit)');

if (options.build) {
	!options.quiet && console.log('Building...');
	try {
		execSync('npm run build');
	} catch {
		console.warn('Build failed, continuing without it.');
	}
}

if (!existsSync(join(import.meta.dirname, '../dist'))) {
	console.error('ERROR: Missing build. If you are using an installed package, please submit a bug report.');
	process.exit(1);
}

if (options.auto) {
	let sum = 0;

	for (const pattern of ['**/tests/setup/*.ts', '**/tests/setup-*.ts']) {
		const files = await globSync(pattern);
		sum += files.length;
		positionals.push(...files);
	}

	!options.quiet && console.log(`Auto-detected ${sum} test setup files`);
}

if (existsSync(options.coverage)) rmSync(options.coverage, { recursive: true });
mkdirSync(options.coverage);
process.env.NODE_V8_COVERAGE = options.coverage;

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
		execSync(['tsx --test --experimental-test-coverage', options.force ? '--test-force-exit' : '', testsGlob, process.env.CMD].join(' '), {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
	} catch {
		!options.quiet && console.error('Tests failed:', setupFile);
	}
}

execSync('npx c8 report --reporter=text', { stdio: 'inherit' });
rmSync(options.coverage, { recursive: true });

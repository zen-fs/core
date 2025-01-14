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
		'non-final': { type: 'boolean' },
		'exit-on-fail': { short: 'e', type: 'boolean' },
	},
	allowPositionals: true,
});

if (options.help) {
	console.log(`zenfs-test [...options] <...paths> 

Paths: The setup files to run tests on

Options:
    -a, --auto          Automatically detect setup files
    -b, --build         Run the npm build script prior to running tests
    -c, --common        Also run tests not specific to any backend
    -e, --exit-on-fail  If any tests suites fail, exit immediately
    -h, --help          Outputs this help message
    -w, --verbose       Output verbose messages
    -q, --quiet         Don't output normal messages
    -t, --test <glob>   Which FS test suite(s) to run
    -f, --force         Whether to use --test-force-exit
    --coverage <dir>    Override the default coverage data directory
    --preserve-coverage Do not delete or report coverage data`);
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
		const files = await globSync(pattern).filter(f => !f.includes('node_modules'));
		sum += files.length;
		positionals.push(...files);
	}

	!options.quiet && console.log(`Auto-detected ${sum} test setup files`);
}

/**
 * Colorizes some text
 * @param {string} text Text to color
 * @param {string | number} code ANSI escape code
 * @returns
 */
function color(text, code) {
	return `\x1b[${code}m${text}\x1b[0m`;
}

function status(name) {
	const start = performance.now();

	const time = () => {
		let delta = Math.round(performance.now() - start),
			unit = 'ms';

		if (delta > 5000) {
			delta /= 1000;
			unit = 's';
		}

		return color(`(${delta} ${unit})`, '2;37');
	};

	return {
		pass() {
			if (!options.quiet) console.log(`${color('passed', 32)}: ${name} ${time()}`);
		},
		fail() {
			console.error(`${color('failed', '1;31')}: ${name} ${time()}`);
			process.exitCode = 1;
			if (options['exit-on-fail']) process.exit();
		},
	};
}

if (!options['preserve-coverage']) rmSync(options.coverage, { force: true, recursive: true });
mkdirSync(options.coverage, { recursive: true });
process.env.NODE_V8_COVERAGE = options.coverage;

if (options.common) {
	!options.quiet && console.log('Running common tests...');
	const { pass, fail } = status('Common tests');
	try {
		execSync("tsx --test --experimental-test-coverage 'tests/*.test.ts' 'tests/**/!(fs)/*.test.ts'", {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
		pass();
	} catch {
		fail();
	}
}

const testsGlob = join(import.meta.dirname, `../tests/fs/${options.test || '*'}.test.ts`);

for (const setupFile of positionals) {
	if (!existsSync(setupFile)) {
		!options.quiet && console.warn('Skipping tests for non-existent setup file:', setupFile);
		continue;
	}

	!options.quiet && console.log('Running tests:', setupFile);
	process.env.SETUP = setupFile;

	const { pass, fail } = status(setupFile);

	try {
		execSync(['tsx --test --experimental-test-coverage', options.force ? '--test-force-exit' : '', testsGlob, process.env.CMD].join(' '), {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
		pass();
	} catch {
		fail();
	}
}

if (!options['preserve-coverage']) execSync('npx c8 report --reporter=text', { stdio: 'inherit' });
if (!options['preserve-coverage']) rmSync(options.coverage, { recursive: true });

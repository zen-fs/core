#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, rmSync } from 'node:fs';
import { join, parse, basename } from 'node:path';
import { parseArgs, styleText } from 'node:util';

const { values: options, positionals } = parseArgs({
	options: {
		// Output
		help: { short: 'h', type: 'boolean', default: false },
		verbose: { short: 'v', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
		log: { short: 'l', type: 'string', default: '' },
		'file-names': { short: 'N', type: 'boolean', default: false },
		ci: { short: 'C', type: 'boolean', default: false },
		debug: { short: 'd', type: 'boolean', default: false },

		// Test behavior
		test: { short: 't', type: 'string' },
		force: { short: 'f', type: 'boolean', default: false },
		auto: { short: 'a', type: 'boolean', default: false },
		build: { short: 'b', type: 'boolean', default: false },
		common: { short: 'c', type: 'boolean', default: false },
		inspect: { short: 'I', type: 'boolean', default: false },
		skip: { short: 's', type: 'string', multiple: true, default: [] },
		'exit-on-fail': { short: 'e', type: 'boolean' },

		// Coverage
		coverage: { type: 'string', default: 'tests/.coverage' },
		preserve: { short: 'p', type: 'boolean' },
		report: { type: 'boolean', default: false },
		clean: { type: 'boolean', default: false },
	},
	allowPositionals: true,
});

function debug(...args) {
	if (options.debug) console.debug(styleText('dim', '[debug]'), ...args.map(a => (typeof a === 'string' ? styleText('dim', a) : a)));
}

if (options.help) {
	console.log(`zenfs-test [...options] <...paths> 

Paths: The setup files to run tests on

Behavior:
    -a, --auto            Automatically detect setup files
    -b, --build           Run the npm build script prior to running tests
    -c, --common          Also run tests not specific to any backend
    -e, --exit-on-fail    If any tests suites fail, exit immediately
    -t, --test <glob>     Which FS test suite(s) to run
    -f, --force           Whether to use --test-force-exit
    -I, --inspect         Use the inspector for debugging
    -s, --skip <pattern>  Skip tests with names matching the given pattern. Can be specified multiple times.
    -d, --debug           Output debug messages from the test runner

Output:
    -h, --help            Outputs this help message
    -v, --verbose         Output verbose messages
    -q, --quiet           Don't output normal messages
    -l, --logs <level>    Change the default log level for test output. Level can be a number or string
    -N, --file-names      Use full file paths for tests from setup files instead of the base name
    -C, --ci              Continuous integration (CI) mode. This interacts with the Github
                          Checks API for better test status. Requires @octokit/action

Coverage:
    --coverage <dir>      Override the default coverage data directory
    -p, --preserve        Do not delete or report coverage data
    --report              ONLY report coverage
    --clean               ONLY clean up coverage directory`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.error('ERROR: Can not specify --verbose and --quiet');
	process.exit(1);
}

process.env.NODE_V8_COVERAGE = options.coverage;
process.env.ZENFS_LOG_LEVEL = options.log;

if (options.clean) {
	rmSync(options.coverage, { recursive: true, force: true });
	process.exit();
}

if (options.report) {
	execSync('npx c8 report --reporter=text', { stdio: 'inherit' });
	rmSync(options.coverage, { recursive: true, force: true });
	process.exit();
}

let ci;
if (options.ci) ci = await import('./ci.js');

options.verbose && options.force && console.debug('Forcing tests to exit (--test-force-exit)');

if (options.build) {
	!options.quiet && process.stdout.write('Building... ');
	try {
		execSync('npm run build');
		console.log('done.');
	} catch {
		console.warn('failed, continuing without it.');
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

async function status(name) {
	const start = performance.now();

	if (options.ci) await ci.startCheck(name);

	const time = () => {
		let delta = Math.round(performance.now() - start),
			unit = 'ms';

		if (delta > 5000) {
			delta /= 1000;
			unit = 's';
		}

		return styleText('dim', `(${delta} ${unit})`);
	};

	const maybeName = options.verbose ? `: ${name}` : '';

	return {
		async pass() {
			if (!options.quiet) console.log(`${styleText('green', 'passed')}${maybeName} ${time()}`);
			if (options.ci) await ci.completeCheck(name, 'success');
		},
		async skip() {
			if (!options.quiet) console.log(`${styleText('yellow', 'skipped')}${maybeName} ${time()}`);
			if (options.ci) await ci.completeCheck(name, 'skipped');
		},
		async fail() {
			console.error(`${styleText(['red', 'bold'], 'failed')}${maybeName} ${time()}`);
			if (options.ci) await ci.completeCheck(name, 'failure');
			process.exitCode = 1;
			if (options['exit-on-fail']) process.exit();
		},
	};
}

if (!options.preserve) rmSync(options.coverage, { force: true, recursive: true });
mkdirSync(options.coverage, { recursive: true });

if (options.common) {
	const command = `tsx ${options.inspect ? 'inspect' : ''} ${options.force ? '--test-force-exit' : ''} --test --experimental-test-coverage 'tests/*.test.ts' 'tests/**/!(fs)/*.test.ts'`;

	if (!options.quiet) {
		debug('command:', command);
		process.stdout.write('Running common tests...' + (options.verbose ? '\n' : ' '));
	}
	const { pass, fail } = await status('Common tests');
	try {
		execSync(command, {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
		await pass();
	} catch {
		await fail();
	}
}

const testsGlob = join(import.meta.dirname, `../tests/fs/${options.test || '*'}.test.ts`);

for (const setupFile of positionals) {
	if (!existsSync(setupFile)) {
		!options.quiet && console.warn('Skipping tests for non-existent setup file:', setupFile);
		continue;
	}

	process.env.SETUP = setupFile;
	if (options.verbose) process.env.VERBOSE = '1';

	const name = options['file-names'] && !options.ci ? setupFile : parse(setupFile).name;

	const command = [
		'tsx --trace-deprecation',
		options.inspect ? '--inspect' : '',
		'--test --experimental-test-coverage',
		options.force ? '--test-force-exit' : '',
		options.skip.length ? `--test-skip-pattern='${options.skip.join('|').replaceAll("'", "\\'")}'` : '',
		`'${testsGlob.replaceAll("'", "\\'")}'`,
		process.env.CMD,
	].join(' ');

	if (!options.quiet) {
		debug('command:', command);
		if (options.verbose) console.log('Running tests:', name);
		else process.stdout.write(`Running tests: ${name}... `);
	}

	const { pass, fail, skip } = await status(name);

	if (basename(setupFile).startsWith('_')) {
		await skip();
		continue;
	}

	try {
		execSync(command, {
			stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
		});
		await pass();
	} catch {
		await fail();
	}
}

if (!options.preserve) {
	execSync('npx c8 report --reporter=text', { stdio: 'inherit' });
	rmSync(options.coverage, { recursive: true });
}

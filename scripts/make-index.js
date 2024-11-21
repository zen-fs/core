#!/usr/bin/env node
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import _path from 'node:path/posix';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		ignore: { short: 'i', type: 'string', multiple: true, default: [] },
		output: { short: 'o', type: 'string', default: 'index.json' },
		quiet: { short: 'q', type: 'boolean', default: false },
		verbose: { type: 'boolean', default: false },
	},
	allowPositionals: true,
});

const root = positionals.at(-1) || '.';

if (options.help) {
	console.log(`make-index <path> [...options]

path: The path to create a listing for

options:
	--help, -h		Outputs this help message
	--quiet, -q		The command will not generate any output, including error messages.
	--verbose		Output verbose messages
	--output, -o <path>	Path to the output file. Defaults to listing.
	--ignore, -i <pattern>	Ignores files which match the glob <pattern>. Can be passed multiple times.
	`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.log('Can not use both --verbose and --quiet.');
	process.exit();
}

let matchesGlob = _path.matchesGlob;

if (matchesGlob && options.verbose) {
	console.debug('[debug] path.matchesGlob is available.');
}

if (!matchesGlob) {
	console.warn('Warning: path.matchesGlob is not available, falling back to minimatch. (Node 20.17.0+ or 22.5.0+ needed)');

	try {
		const { minimatch } = await import('minimatch');
		matchesGlob = minimatch;
	} catch {
		console.error('Fatal error: Failed to fall back to minimatch (is it installed?)');
		process.exit(1);
	}
}

function fixSlash(path) {
	return path.replaceAll('\\', '/');
}

const resolvedRoot = root || '.';

const colors = {
	reset: 0,
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
	bright_black: 90,
	bright_red: 91,
	bright_green: 92,
	bright_yellow: 93,
	bright_blue: 94,
	bright_magenta: 95,
	bright_cyan: 96,
	bright_white: 97,
};

function color(color, text) {
	return `\x1b[${colors[color]}m${text}\x1b[0m`;
}

const entries = new Map();

function computeEntries(path) {
	try {
		if (options.ignore.some(pattern => matchesGlob(path, pattern))) {
			if (!options.quiet) console.log(`${color('yellow', 'skip')} ${path}`);
			return;
		}

		const stats = statSync(path);

		if (stats.isFile()) {
			entries.set('/' + _path.relative(resolvedRoot, path), stats);
			if (options.verbose) {
				console.log(`${color('green', 'file')} ${path}`);
			}
			return;
		}

		for (const file of readdirSync(path)) {
			computeEntries(_path.join(path, file));
		}
		entries.set('/' + _path.relative(resolvedRoot, path), stats);
		if (options.verbose) {
			console.log(`${color('bright_green', ' dir')} ${path}`);
		}
	} catch (e) {
		if (!options.quiet) {
			console.log(`${color('red', 'fail')} ${path}: ${e.message}`);
		}
	}
}

computeEntries(resolvedRoot);
if (!options.quiet) {
	console.log('Generated listing for ' + fixSlash(_path.resolve(root)));
}

const index = {
	version: 1,
	entries: Object.fromEntries(entries),
};

writeFileSync(options.output, JSON.stringify(index));

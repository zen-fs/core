#!/usr/bin/env node
import { parseArgs } from 'util';
import { statSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path/posix';
import { resolve } from 'path';

const {
	values: options,
	positionals: [root],
} = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		ignore: { short: 'i', type: 'string', multiple: true, default: [] },
		output: { short: 'o', type: 'string', default: 'listing.json' },
		quiet: { short: 'q', type: 'boolean', default: false },
		verbose: { type: 'boolean', default: false },
	},
	allowPositionals: true,
	strict: true,
});

if (options.help) {
	console.log(`make-index <path> [...options]
	path: The path to create a listing for

	options:
		--help, -h:				Outputs this help message
		--output, -o <path>:	Path to the output file. Defaults to listing.
		--quiet, -q: 			Do not output messages about individual files
		--verbose:				Output verbose messages
		--ignore, -i <pattern>:	Ignores files which match <pattern>. Can be passed multiple times.
	`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.log('Can not use both --verbose and --quiet.');
	process.exit();
}

function pathToPosix(path) {
	return path.replaceAll('\\', '/');
}

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

function makeListing(path, seen = new Set()) {
	try {
		const stats = statSync(path);

		if (stats.isFile()) {
			return null;
		}

		let entries = {};
		for (const file of readdirSync(path)) {
			const full = join(path, file);
			if (options.ignore.some(pattern => full.match(pattern))) {
				if (!options.quiet) console.log(`${color('yellow', 'skip')} ${full}`);
				continue;
			}

			entries[file] = makeListing(full, seen);
		}
		return entries;
	} catch (e) {
		if (!options.quiet) {
			console.log(`${color('red', 'fail')} ${path}: ${e.message}`);
		}
	}
}

const listing = makeListing(pathToPosix(root));
if (!options.quiet) console.log('Generated listing for ' + pathToPosix(resolve(root)));

writeFileSync(options.output, JSON.stringify(listing));

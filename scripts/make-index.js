#!/usr/bin/env node
import { constants as c, lstatSync, readdirSync, writeFileSync } from 'node:fs';
import { join, matchesGlob, relative, resolve } from 'node:path/posix';
import { parseArgs, styleText } from 'node:util';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		ignore: { short: 'i', type: 'string', multiple: true, default: [] },
		output: { short: 'o', type: 'string', default: 'index.json' },
		quiet: { short: 'q', type: 'boolean', default: false },
		xdev: { type: 'boolean', default: false },
		verbose: { type: 'boolean', default: false },
	},
	allowPositionals: true,
});

const root = positionals.at(-1) || '.';

if (options.help) {
	console.log(`make-index <path> [...options]

path: The path to create a listing for

options:
    -h, --help              Outputs this help message
    -q, --quiet             The command will not generate any output, including error messages.
        --verbose           Output verbose messages
        --xdev              Force crossing device/FS boundaries
    -o, --output <path>     Path to the output file. Defaults to listing.
    -i, --ignore <pattern>  Ignores files which match the glob <pattern>. Can be passed multiple times.
	`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.log('Can not use both --verbose and --quiet.');
	process.exit();
}

/**
 * @param {string} path
 */
function fixSlash(path) {
	return path.replaceAll('\\', '/');
}

const resolvedRoot = root || '.';

const entries = new Map();

/** @type {Record<string, import('node:util').InspectColor>} */
const typeMap = {
	file: 'green',
	' dir': 'blue',
	' sym': 'cyan',
	' dev': 'yellow',
	sock: 'magenta',
	fifo: 'blue',
};

function getTypeText(/** @type {{ mode: number }} */ stats) {
	switch (stats.mode & c.S_IFMT) {
		case c.S_IFBLK:
		case c.S_IFCHR:
			return ' dev';
		case c.S_IFIFO:
			return 'fifo';
		case c.S_IFSOCK:
			return 'sock';
		case c.S_IFREG:
			return 'file';
		case c.S_IFDIR:
			return ' dir';
		default:
			throw `Unknown file type: 0o${(stats.mode & c.S_IFMT).toString(8)}`;
	}
}

const seenDevs = new Set();

/**
 * @param {string} path
 */
function computeEntries(path) {
	try {
		if (options.ignore.some(pattern => matchesGlob(path, pattern))) {
			if (!options.quiet) console.log(`${styleText('yellow', 'skip')} ${path}`);
			return;
		}

		const stats = lstatSync(path);
		if (!seenDevs.size) seenDevs.add(stats.dev);
		else if (!seenDevs.has(stats.dev))
			if (options.xdev) {
				console.warn(
					`${styleText('yellowBright', `--xdev: Adding entries from device ${stats.dev} (${path}). You may get duplicate inos which MUST be de-duplicated manually.`)}`
				);
				seenDevs.add(stats.dev);
			} else {
				console.warn(`${styleText('yellowBright', `Ignoring ${path} because it crosses a device boundary`)}`);
				return;
			}

		const type = getTypeText(stats);

		entries.set('/' + relative(resolvedRoot, path), stats);
		if (options.verbose) console.log(`${styleText(typeMap[type] || 'white', type)} ${path}`);

		if (stats.isDirectory()) {
			for (const file of readdirSync(path)) computeEntries(join(path, file));
		}
	} catch (/** @type {any} */ e) {
		if (!options.quiet) {
			console.log(`${styleText('red', 'fail')} ${path}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

computeEntries(resolvedRoot);
if (!options.quiet) {
	console.log('Generated listing for ' + fixSlash(resolve(root)));
}

const index = {
	version: 1,
	entries: Object.fromEntries(entries),
};

writeFileSync(options.output, JSON.stringify(index));

#!/usr/bin/env node
import { build, context } from 'esbuild';
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { rmSync } from 'node:fs';
import { globalExternals } from '@fal-works/esbuild-plugin-global-externals';

let buildCount = 0;

const { watch, keep, quiet, globalName, entry } = parseArgs({
	options: {
		watch: { short: 'w', type: 'boolean', default: false },
		keep: { short: 'k', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
		globalName: { type: 'string' },
		entry: { type: 'string' },
	},
	strict: false,
	allowPositionals: true,
}).values;

async function exportsOf(name) {
	return Object.keys(await import(name)).filter(key => key != 'default');
}

function start() {
	if (!keep) {
		rmSync('dist', { force: true, recursive: true });
	}

	if (watch && !quiet) {
		console.log(`------------ Building #${++buildCount}`);
	}

	execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
}

const config = {
	entryPoints: [entry || 'src/index.ts'],
	target: 'es2021',
	globalName,
	outfile: 'dist/browser.min.js',
	sourcemap: true,
	keepNames: true,
	bundle: true,
	minify: true,
	platform: 'browser',
	plugins: [
		globalExternals({
			'@zenfs/core': {
				varName: 'ZenFS',
				namedExports: await exportsOf('@zenfs/core'),
			},
		}),
		{
			name: 'tsc+counter',
			setup({ onStart, onEnd }) {
				onStart(start);

				if (watch && !quiet) {
					onEnd(() => console.log(`--------------- Built #${buildCount}`));
				}
			},
		},
	],
};

if (watch) {
	if (!quiet) {
		console.log('Watching for changes...');
	}
	const ctx = await context(config);
	await ctx.watch();
} else {
	await build(config);
}

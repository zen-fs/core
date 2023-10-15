import { context } from 'esbuild';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const options = parseArgs({
	config: {
		keep: { short: 'k', type: 'boolean', default: false },
		watch: { short: 'w', type: 'boolean', default: false },
	},
}).values;

const ctx = await context({
	entryPoints: ['src/index.ts'],
	target: 'es6',
	globalName: 'BrowserFS',
	outfile: 'dist/browser.min.js',
	sourcemap: true,
	keepNames: true,
	bundle: true,
	minify: true,
	platform: 'browser',
	plugins: [{ name: 'watcher', setup(build) {
		build.onStart(() => {
			if(!options.keep) {
				rmSync('dist', { force: true, recursive: true });
			}

			try {
				execSync('tsc -p tsconfig.json');
			} catch (e) {
				console.error(e);
			}
		});
	} }],
});

if(options.watch) {
	console.log('Watching for changes...');
	await ctx.watch();
} else {
	await ctx.rebuild();
	await ctx.dispose();
}

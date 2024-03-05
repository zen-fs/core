import { context } from 'esbuild';
import { parseArgs } from 'node:util';

const options = parseArgs({
	config: {
		watch: { short: 'w', type: 'boolean', default: false },
	},
}).values;

const ctx = await context({
	entryPoints: ['src/index.ts'],
	target: 'esnext',
	globalName: 'BrowserFS',
	outfile: 'dist/browser.min.js',
	sourcemap: true,
	keepNames: true,
	bundle: true,
	minify: true,
	platform: 'browser',
});

try {
	if (options.watch) {
		console.log('Watching for changes...');
		await ctx.watch();
	} else {
		await ctx.rebuild();
	}
} catch (e) {
	console.error(e.message);
} finally {
	await ctx.dispose();
}

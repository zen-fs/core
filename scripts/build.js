import { build, context } from 'esbuild';
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const options = parseArgs({
	config: {
		watch: { short: 'w', type: 'boolean', default: false },
	},
	strict: false,
}).values;

const config = {
	entryPoints: ['src/index.ts'],
	target: 'esnext',
	globalName: 'ZenFS',
	outfile: 'dist/browser.min.js',
	sourcemap: true,
	keepNames: true,
	bundle: true,
	minify: true,
	platform: 'browser',
	plugins: [
		{
			name: 'tsc',
			setup({ onStart, onEnd }) {
				let buildCount = 0;
				onStart(async () => {
					try {
						console.log(`------------ Building #${++buildCount}`);
						execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
					} finally {
					}
				});
				onEnd(() => {
					console.log(`--------------- Built #${buildCount}`);
				});
			},
		},
	],
};

if (options.watch) {
	console.log('Watching for changes...');
	const ctx = await context(config);
	await ctx.watch();
} else {
	await build(config);
}

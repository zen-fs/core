import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fs } from '../src/index.ts';

export const fixturesDir = 'tests/fixtures/node';

/**
 * Creates a Typescript Worker
 * @see https://github.com/privatenumber/tsx/issues/354
 * @see https://github.com/nodejs/node/issues/47747#issuecomment-2287745567
 */
export function createTSWorker(source: string): Worker {
	return new Worker(`import('tsx/esm/api').then(tsx => {tsx.register();import('${source}');});`, { eval: true });
}

function copy(_path: string) {
	const path = relative(fixturesDir, _path) || '/';
	const stats = statSync(_path);

	if (!stats.isDirectory()) {
		fs.writeFileSync(path, readFileSync(_path));
		return;
	}

	if (path != '/') {
		fs.mkdirSync(path);
	}
	for (const file of readdirSync(_path)) {
		copy(join(_path, file));
	}
}

copy(fixturesDir);

export { fs };

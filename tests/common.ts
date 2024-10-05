import { fs } from '../src/index.js';
import { join, relative } from 'path';
import { statSync, readFileSync, readdirSync } from 'fs';
import { Worker } from 'worker_threads';

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

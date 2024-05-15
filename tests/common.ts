import { fs } from '../src/index.js';
import { join, relative } from 'path';
import { statSync, readFileSync, readdirSync } from 'fs';

export const fixturesDir = 'tests/fixtures/node';

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

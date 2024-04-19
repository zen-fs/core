import { fs } from '../src';
import { join, relative } from 'path';
import { statSync, readFileSync, readdirSync } from 'fs';

export const fixturesDir = '__fixtures__/node';

function copy(_p: string) {
	const p = relative(fixturesDir, _p) || '/';
	const stats = statSync(_p);

	if (!stats.isDirectory()) {
		fs.writeFileSync(p, readFileSync(_p));
		return;
	}

	if (p != '/') {
		fs.mkdirSync(p);
	}
	for (const file of readdirSync(_p)) {
		copy(join(_p, file));
	}
}

copy(fixturesDir);

export { fs };

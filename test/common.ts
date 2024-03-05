import { Stats, FileType, type BigIntStats } from '../src/stats';
import { fs } from '../src/index';
import * as path from 'path';
import { statSync, readFileSync, readdirSync } from 'fs';

export const fixturesDir = 'test/fixtures/files/node';

function copy(_p: string) {
	const p = path.posix.relative(fixturesDir, _p);
	const stats = statSync(_p);

	if (!stats.isDirectory()) {
		fs.writeFileSync(p, readFileSync(_p));
		return;
	}

	if (p != '/') {
		fs.mkdirSync(p);
	}
	for (const file of readdirSync(_p)) {
		copy(path.join(_p, file));
	}
}

copy(fixturesDir);

export { fs };

export function createMockStats(mode: number | bigint): Stats | BigIntStats {
	return new Stats(FileType.FILE, -1, mode);
}

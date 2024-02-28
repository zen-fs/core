import { Stats, FileType } from '../src/stats';
import { type Configuration, configure as _configure, fs } from '../src/index';
import * as path from 'path';
import { statSync, readFileSync, readdirSync } from 'fs';

export const tmpDir = 'tmp/';
export const fixturesDir = 'test/fixtures/files/node';

function copy(_fs: typeof fs, _p: string) {
	const p = path.posix.resolve('/', path.posix.relative(fixturesDir, _p));
	const stats = statSync(_p);

	if (!stats.isDirectory()) {
		_fs.writeFileSync(p, readFileSync(_p));
		return;
	}

	if (p != '/') {
		_fs.mkdirSync(p);
	}
	for (const file of readdirSync(_p)) {
		copy(_fs, path.join(_p, file));
	}
}

export async function configure(config: Configuration) {
	const result = await _configure(config);
	copy(fs, fixturesDir);
	return result;
}

export { fs };

export function createMockStats(mode: number | bigint): Stats {
	return new Stats(FileType.FILE, -1, mode);
}

const tests: { [s: string]: Configuration } = {
	AsyncMirror: { sync: { fs: 'InMemory' }, async: { fs: 'InMemory' } },
	FolderAdapter: { wrapped: { fs: 'InMemory' }, folder: '/example' },
	InMemory: {},
	OverlayFS: { readable: { fs: 'InMemory' }, writable: { fs: 'InMemory' } },
};

export const backends = Object.entries(tests);

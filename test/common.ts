import { Stats, FileType } from '../src/stats';
import { configure as _configure, fs, InMemory, AsyncMirror, Overlay } from '../src/index';
import * as path from 'path';
import { statSync, readFileSync, readdirSync } from 'fs';
import type { BackendConfig } from '../src/backends/backend';

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

export async function configure(config: BackendConfig): Promise<void> {
	await _configure(config);
	copy(fs, fixturesDir);
}

export { fs };

export function createMockStats(mode: number | bigint): Stats {
	return new Stats(FileType.FILE, -1, mode);
}

const tests: BackendConfig[] = [{ backend: AsyncMirror, sync: InMemory, async: InMemory }, { backend: InMemory }, { backend: Overlay, readable: InMemory, writable: InMemory }];

export const backends: [string, BackendConfig][] = tests.map(test => [test.backend.name, test]);

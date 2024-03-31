import { fs } from '../common';
import { FileHandle } from '../../src/emulation/promises';

describe('fs.fileSync', () => {
	const file = 'a.js';

	let handle: FileHandle;

	beforeAll(async () => {
		handle = await fs.promises.open(file, 'a', 0o777);
	});

	it('should synchronize file data changes (sync)', async () => {
		fs.fdatasyncSync(handle.fd);
		fs.fsyncSync(handle.fd);
	});

	it('should synchronize file data changes (async)', async () => {
		await handle.datasync();
		await handle.sync();
	});

	afterAll(async () => {
		await handle.close();
	});
});

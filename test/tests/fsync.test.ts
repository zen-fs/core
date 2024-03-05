import { backends, fs, configure } from '../common';
import * as path from 'path';
// Import promisify
import { fixturesDir } from '../common';
import { FileHandle } from '../../src/emulation/promises';

describe.each(backends)('%s fs.fileSync', (name, options) => {
	const configured = configure(options);
	const file = path.join(fixturesDir, 'a.js');

	if (!fs.getMount('/').metadata.readonly) {
		let handle: FileHandle;

		beforeAll(async () => {
			handle = await fs.promises.open(file, 'a', 0o777);
		});

		if (fs.getMount('/').metadata.synchronous) {
			it('should synchronize file data changes (sync)', async () => {
				await configured;
				fs.fdatasyncSync(handle.fd);
				fs.fsyncSync(handle.fd);
			});
		}

		it('should synchronize file data changes (async)', async () => {
			await configured;
			await handle.datasync();
			await handle.sync();
		});

		afterAll(async () => {
			await handle.close();
		});
	}
});

import { backends, fs, configure, tmpDir, fixturesDir } from '../common';
import * as path from 'path';

describe.each(backends)('%s fs.writeFile', (name, options) => {
	const configured = configure(options);
	if (!fs.getMount('/').metadata.readonly) {
		const fileNameLen = Math.max(260 - tmpDir.length - 1, 1);
		const fileName = path.join(tmpDir, new Array(fileNameLen + 1).join('x'));
		const fullPath = path.resolve(fileName);

		it('should write file and verify its size', async () => {
			await configured;
			await fs.promises.writeFile(fullPath, 'ok');
			const stats = await fs.promises.stat(fullPath);
			expect(stats.size).toBe(2);
		});

		afterAll(async () => {
			await fs.promises.unlink(fullPath);
		});
	}
});

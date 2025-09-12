import { configureSingle, CopyOnWrite, fs, InMemory, resolveMountConfig } from '@zenfs/core';
import { copySync, data } from '../setup.js';

fs.umount('/');
const readable = await resolveMountConfig({ backend: InMemory, label: 'ro' });
fs.mount('/', readable);
copySync(data);

await configureSingle({
	backend: CopyOnWrite,
	readable,
	writable: InMemory.create({ label: 'cow' }),
});

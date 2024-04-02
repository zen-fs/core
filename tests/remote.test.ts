import { MessageChannel } from 'node:worker_threads';
import { fs, configure, InMemory } from '@zenfs/core';
import { Port } from '../src/backend.js';
import { attach } from '../src/remote.js';

const { port1, port2 } = new MessageChannel();
await configure({
	'/tmp': InMemory,
	'/port': { backend: Port, port: port1 },
});
attach(port2, fs.mounts.get('/tmp'));
const content = 'FS is in a port';
await fs.promises.writeFile('/port/test', content);
expect(fs.readFileSync('/tmp/test', 'utf8')).toBe(content);
expect(await fs.promises.readFile('/port/test', 'utf8')).toBe(content);
/*
describe('Remote FS test', () => {
	const { port1, port2 } = new MessageChannel();

	test('read', async () => {
		await configure({
			'/tmp': InMemory,
			'/port': { backend: Port, port: port1 },
		});
		attach(port2, fs.mounts.get('/tmp'));
		const content = 'FS is in a port';
		await fs.promises.writeFile('/port/test', content);
		expect(fs.readFileSync('/tmp/test', 'utf8')).toBe(content);
		expect(await fs.promises.readFile('/port/test', 'utf8')).toBe(content);
	});
});
*/

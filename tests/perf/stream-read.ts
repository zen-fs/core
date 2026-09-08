// SPDX-License-Identifier: LGPL-3.0-or-later
// Reading through `createReadStream`: the VFS cache lookup, `copyFromCache`, and the stream's own
// chunking, with the files written outside the timed window.
import { pipeline } from 'node:stream/promises';
import { chunks, fs, mount, settle } from './common.ts';

interface Config {
	size: number;
	count: number;
	/** Stream highWaterMark, which is also the read chunk size */
	hwm: number;
	prep: 'writeFile' | 'stream';
}

interface State {
	buffer: Buffer;
	parts: Buffer[];
}

export async function setup(config: Config): Promise<State> {
	await mount('perf-stream-read');
	const buffer = Buffer.alloc(config.size, 0xab);
	return { buffer, parts: chunks(buffer, config.hwm) };
}

export async function before(config: Config, state: State): Promise<void> {
	for (let i = 0; i < config.count; i++) {
		if (config.prep == 'stream') await pipeline(state.parts, fs.createWriteStream(`/w${i}`, { highWaterMark: config.hwm }));
		else await fs.promises.writeFile(`/w${i}`, state.buffer);
	}
	await settle();
}

export async function test(config: Config) {
	let bytes = 0;

	for (let i = 0; i < config.count; i++) {
		for await (const chunk of fs.createReadStream(`/w${i}`, { highWaterMark: config.hwm })) bytes += (chunk as Buffer).length;
	}

	if (bytes != config.size * config.count) throw new Error(`short read: ${bytes} of ${config.size * config.count}`);

	return { bytes, files: config.count };
}

export async function after(config: Config): Promise<void> {
	for (let i = 0; i < config.count; i++) await fs.promises.rm(`/w${i}`);
}

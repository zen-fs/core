// SPDX-License-Identifier: LGPL-3.0-or-later
// Writing through `createWriteStream`: how the cache grows as a file is appended to one chunk at a
// time. A region that reallocates exactly on every append makes this quadratic in the file's size.
import { pipeline } from 'node:stream/promises';
import { chunks, fs, mount, settle } from './common.ts';

interface Config {
	size: number;
	count: number;
	hwm: number;
}

interface State {
	parts: Buffer[];
}

export async function setup(config: Config): Promise<State> {
	await mount('perf-stream-write');
	return { parts: chunks(Buffer.alloc(config.size, 0xab), config.hwm) };
}

export async function test(config: Config, state: State) {
	for (let i = 0; i < config.count; i++) await pipeline(state.parts, fs.createWriteStream(`/w${i}`, { highWaterMark: config.hwm }));

	return { bytes: config.size * config.count, files: config.count };
}

export async function after(config: Config): Promise<void> {
	for (let i = 0; i < config.count; i++) await fs.promises.rm(`/w${i}`);
	await settle();
}

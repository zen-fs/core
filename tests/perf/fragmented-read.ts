// SPDX-License-Identifier: LGPL-3.0-or-later
// Reads spread across a file with many disjoint cached regions.

import type { FileHandle } from '@zenfs/core/promises';
import { fs, mount, piece, stride } from './common.ts';

interface Config {
	/** Cached regions to build, one per scattered write */
	regions: number;
	reads: number;
}

interface State {
	handle: FileHandle;
	target: Buffer;
}

export async function setup(config: Config): Promise<State> {
	await mount('perf-fragmented-read');

	await fs.promises.writeFile('/f', Buffer.alloc(config.regions * stride));
	const handle = await fs.promises.open('/f', 'r+');

	const data = Buffer.alloc(piece, 0xcd);
	for (let i = 0; i < config.regions; i++) await handle.write(data, 0, data.length, i * stride);

	return { handle, target: Buffer.allocUnsafe(piece) };
}

export async function test(config: Config, state: State) {
	// Backwards, so a scan that starts at region zero pays its worst case on every read
	for (let i = 0; i < config.reads; i++)
		await state.handle.read(state.target, 0, state.target.length, (config.regions - 1 - (i % config.regions)) * stride);

	return { reads: config.reads, bytes: config.reads * piece };
}

export async function teardown(config: Config, state: State): Promise<void> {
	await state.handle.close();
	await fs.promises.rm('/f');
}

// SPDX-License-Identifier: LGPL-3.0-or-later
// Writes that each land in their own region, so the region list grows by one per write.
// Anything that walks the whole list — or re-sorts the dirty ranges — per write shows up as
// quadratic here.
import type { FileHandle } from '@zenfs/core/promises';
import { fs, mount, piece, stride } from './common.ts';

interface Config {
	writes: number;
}

interface State {
	data: Buffer;
	handle?: FileHandle;
}

export async function setup(): Promise<State> {
	await mount('perf-fragmented-write');
	return { data: Buffer.alloc(piece, 0xcd) };
}

/** A fresh file each iteration: the point is the cost of building the region list, not of reusing it. */
export async function before(config: Config, state: State): Promise<void> {
	await fs.promises.writeFile('/f', Buffer.alloc(config.writes * stride));
	state.handle = await fs.promises.open('/f', 'r+');
}

export async function test(config: Config, state: State) {
	for (let i = 0; i < config.writes; i++) await state.handle!.write(state.data, 0, state.data.length, i * stride);

	return { writes: config.writes, bytes: config.writes * piece };
}

export async function after(config: Config, state: State): Promise<void> {
	await state.handle!.close();
	await fs.promises.rm('/f');
}

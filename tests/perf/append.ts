// SPDX-License-Identifier: LGPL-3.0-or-later
// Sequential appends into one region. Every write extends the same region, so a region that
// allocates exactly what it needs copies the whole file on each append.
import type { FileHandle } from '@zenfs/core/promises';
import { fs, mount, piece } from './common.ts';

interface Config {
	writes: number;
}

interface State {
	data: Buffer;
	handle?: FileHandle;
}

export async function setup(): Promise<State> {
	await mount('perf-append');
	return { data: Buffer.alloc(piece, 0x11) };
}

export async function before(config: Config, state: State): Promise<void> {
	state.handle = await fs.promises.open('/a', 'w');
}

export async function test(config: Config, state: State) {
	for (let i = 0; i < config.writes; i++) await state.handle!.write(state.data, 0, state.data.length, i * piece);

	return { writes: config.writes, bytes: config.writes * piece };
}

export async function after(config: Config, state: State): Promise<void> {
	await state.handle!.close();
	await fs.promises.rm('/a');
}

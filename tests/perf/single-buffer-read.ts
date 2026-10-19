// SPDX-License-Identifier: LGPL-3.0-or-later
// 4 KB reads at random offsets in one file in a SingleBuffer.
// The file is opened fresh for each iteration, so every read misses the vnode cache and reaches the store.
import { block, fs, mountWithFile, offsets, type Config } from './single-buffer-random.ts';

interface State {
	offsets: number[];
	target: Uint8Array;
	fd?: number;
}

export async function setup(config: Config): Promise<State> {
	await mountWithFile(config);
	return { offsets: offsets(config), target: new Uint8Array(block) };
}

export function before(config: Config, state: State): void {
	state.fd = fs.openSync('/f', 'r');
}

export function test(config: Config, state: State) {
	for (const offset of state.offsets) fs.readSync(state.fd!, state.target, 0, block, offset);
	return { reads: state.offsets.length, bytes: state.offsets.length * block };
}

export function after(config: Config, state: State): void {
	fs.closeSync(state.fd!);
}

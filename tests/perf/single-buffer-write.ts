// SPDX-License-Identifier: LGPL-3.0-or-later
// 4 KB writes at random offsets in one file in a SingleBuffer.
// By default, only the writes are timed, and they stay in the vnode cache until the untimed close.
// With `flush`, the close is timed too, which writes the cached data to the store.
// With `osync`, the file is opened with O_SYNC, so every write reaches the store.
import { block, fs, mountWithFile, offsets, type Config as BaseConfig } from './single-buffer-random.ts';

interface Config extends BaseConfig {
	flush: number;
	sync: number;
}

interface State {
	offsets: number[];
	data: Uint8Array;
	fd?: number;
}

export async function setup(config: Config): Promise<State> {
	await mountWithFile(config);
	return { offsets: offsets(config), data: new Uint8Array(block).fill(0xa5) };
}

export function before(config: Config, state: State): void {
	state.fd = fs.openSync('/f', config.sync ? 'rs+' : 'r+');
}

export function test(config: Config, state: State) {
	for (const offset of state.offsets) fs.writeSync(state.fd!, state.data, 0, block, offset);

	if (config.flush) {
		fs.closeSync(state.fd!);
		state.fd = undefined;
	}

	return { writes: state.offsets.length, bytes: state.offsets.length * block };
}

export function after(config: Config, state: State): void {
	if (state.fd !== undefined) fs.closeSync(state.fd);
}

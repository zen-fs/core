// SPDX-License-Identifier: LGPL-3.0-or-later
// Helpers for random access to one file in a SingleBuffer.
import { configureSingle, SingleBuffer } from '@zenfs/core';
import { fs, KB, MB } from './common.ts';

export { fs };

export const block = 4 * KB;

export interface Config {
	/** Size of the file */
	size: number;

	/** Number of blocks accessed, each once */
	count: number;

	sbfs_v2: boolean;
}

/** Mounts a SingleBuffer with room for the file twice over, then creates the file */
export async function mountWithFile(config: Config): Promise<void> {
	await configureSingle({ backend: SingleBuffer, buffer: new ArrayBuffer(config.size * 2 + 4 * MB), v2: config.sbfs_v2 });
	fs.writeFileSync('/f', new Uint8Array(config.size).fill(0x5a));
}

/** Offsets of `count` distinct blocks of the file, in a shuffled order that is the same on every run */
export function offsets(config: Config): number[] {
	const blocks = Array.from({ length: config.size / block }, (_, i) => i);

	let seed = 0x2545f491;
	for (let i = blocks.length - 1; i > 0; i--) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		const j = seed % (i + 1);
		[blocks[i], blocks[j]] = [blocks[j], blocks[i]];
	}

	return blocks.slice(0, config.count).map(i => i * block);
}

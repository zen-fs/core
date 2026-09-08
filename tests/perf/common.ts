// SPDX-License-Identifier: LGPL-3.0-or-later
import { configureSingle, fs, InMemory } from '@zenfs/core';

export { fs };

export const KB = 1024;
export const MB = 1024 * 1024;

/**
 * A piece and the stride between pieces, chosen so consecutive writes never merge into one region:
 * the 12 KB hole between them is wider than `regionGapThreshold`.
 */
export const piece = 4 * KB;
export const stride = 16 * KB;

/** A fresh in-memory filesystem, so no configuration inherits another's cached vnodes. */
export async function mount(name: string): Promise<void> {
	await configureSingle({ backend: InMemory, name });
}

/** Split a buffer the way a stream writer feeds it. */
export function chunks(buffer: Buffer, size: number): Buffer[] {
	const out: Buffer[] = [];
	for (let i = 0; i < buffer.length; i += size) out.push(buffer.subarray(i, Math.min(i + size, buffer.length)));
	return out;
}

/** Give the event loop a moment, so work queued by the previous phase never lands in the timed one. */
export function settle(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 50));
}

// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs } from '@zenfs/core';
import { getDefaultHighWaterMark, setDefaultHighWaterMark } from '@zenfs/streams';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('Streams', () => {
	test('createReadStream reads in chunks of the default highWaterMark', async () => {
		fs.writeFileSync('/hwm.bin', new Uint8Array(10_000));
		const previous = getDefaultHighWaterMark(false);
		setDefaultHighWaterMark(false, 4096);
		try {
			const sizes: number[] = [];
			for await (const chunk of fs.createReadStream('/hwm.bin')) sizes.push((chunk as Uint8Array).byteLength);
			assert.deepEqual(sizes, [4096, 4096, 1808]);
		} finally {
			setDefaultHighWaterMark(false, previous);
			fs.unlinkSync('/hwm.bin');
		}
	});
});

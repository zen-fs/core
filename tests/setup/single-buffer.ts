import { SingleBuffer, configureSingle } from '@zenfs/core';
import { copySync, data } from '../setup.ts';

await configureSingle({
	backend: SingleBuffer,
	buffer: new ArrayBuffer(0x1100000),
	v2: false,
});

copySync(data);

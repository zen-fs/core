import { SingleBuffer, configureSingle } from '@zenfs/core';
import { copySync, data } from '@zenfs/devel/tests/setup';

await configureSingle({
	backend: SingleBuffer,
	buffer: new ArrayBuffer(0x1100000),
	v2: true,
});

copySync(data);

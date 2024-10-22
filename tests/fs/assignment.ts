/* eslint-disable @typescript-eslint/no-unused-vars */

/*
	This test assigns the exported fs module from ZenFS with the one exported from Node.
	This ensures anything new that is added will be caught

	Notes on omissions and exclusions:
	- __promisify__ is omitted as it is metadata
	- native is omitted as zenfs isn't native
	- ReadStream and WriteStream are excluded since they are polfilled from another module
*/

import type * as node from 'node:fs';
import { fs as zen } from '../../src/index.ts';

type Mock = {
	[K in Exclude<keyof typeof node, 'ReadStream' | 'WriteStream'>]: Omit<(typeof node)[K], '__promisify__' | 'native'>;
};

const _module: Mock = zen;

/* eslint-disable @typescript-eslint/no-unused-vars */

/*
	This test assigns the exported fs module from ZenFS with the one exported from Node.
	This ensures anything new that is added will be caught
*/

import { fs as zen } from '../src/index.js';
import * as node from 'fs';

type Mock = {
	[K in keyof typeof node]: Omit<(typeof node)[K], '__promisify__' | 'native'>;
};

const _module: Mock = zen;

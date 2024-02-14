import * as fs_mock from './index.js';
import type * as fs_node from 'node:fs';

const fs = fs_mock as typeof fs_node & typeof fs_mock;

export * from './index.js';
export default fs;

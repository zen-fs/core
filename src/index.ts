export * from './backends/backend';
export * from './backends/AsyncStore';
export * from './backends/InMemory';
export * from './backends/Locked';
export * from './backends/Overlay';
export * from './backends/SyncStore';
export * from './ApiError';
export * from './config';
export * from './cred';
export * from './file';
export * from './filesystem';
export * from './FileIndex';
export * from './inode';
export * from './mutex';
export * from './stats';
export * from './utils';

export * from './emulation/index';
import * as fs from './emulation/index';
import * as path from './emulation/path';
export { fs, path };
export default fs;

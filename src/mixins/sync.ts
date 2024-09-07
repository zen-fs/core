import { type Cred } from '../cred.js';
import { type File } from '../file.js';
import { type Stats } from '../stats.js';
import type { FileSystem } from '../filesystem.js';
import type { Mixin, _AsyncFSMethods } from './shared.js';

/**
 * Implements the asynchronous API in terms of the synchronous API.
 */
/* eslint-disable @typescript-eslint/require-await */
export function Sync<T extends typeof FileSystem>(FS: T): Mixin<T, _AsyncFSMethods> {
	abstract class SyncFS extends FS implements _AsyncFSMethods {
		public async exists(path: string, cred: Cred): Promise<boolean> {
			return this.existsSync(path, cred);
		}

		public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
			return this.renameSync(oldPath, newPath, cred);
		}

		public async stat(path: string, cred: Cred): Promise<Stats> {
			return this.statSync(path, cred);
		}

		public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
			return this.createFileSync(path, flag, mode, cred);
		}

		public async openFile(path: string, flag: string, cred: Cred): Promise<File> {
			return this.openFileSync(path, flag, cred);
		}

		public async unlink(path: string, cred: Cred): Promise<void> {
			return this.unlinkSync(path, cred);
		}

		public async rmdir(path: string, cred: Cred): Promise<void> {
			return this.rmdirSync(path, cred);
		}

		public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
			return this.mkdirSync(path, mode, cred);
		}

		public async readdir(path: string, cred: Cred): Promise<string[]> {
			return this.readdirSync(path, cred);
		}

		public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
			return this.linkSync(srcpath, dstpath, cred);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			return this.syncSync(path, data, stats);
		}
	}
	return SyncFS;
}
/* eslint-enable @typescript-eslint/require-await */

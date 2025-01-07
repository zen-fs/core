import type { File } from '../file.js';
import type { CreationOptions, FileSystem } from '../filesystem.js';
import type { Stats } from '../stats.js';
import type { Mixin, AsyncFSMethods } from './shared.js';

/**
 * Implements the asynchronous API in terms of the synchronous API.
 */
/* eslint-disable @typescript-eslint/require-await */
export function Sync<T extends typeof FileSystem>(FS: T): Mixin<T, AsyncFSMethods> {
	abstract class SyncFS extends FS implements AsyncFSMethods {
		public async exists(path: string): Promise<boolean> {
			return this.existsSync(path);
		}

		public async rename(oldPath: string, newPath: string): Promise<void> {
			return this.renameSync(oldPath, newPath);
		}

		public async stat(path: string): Promise<Stats> {
			return this.statSync(path);
		}

		public async createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
			return this.createFileSync(path, flag, mode, options);
		}

		public async openFile(path: string, flag: string): Promise<File> {
			return this.openFileSync(path, flag);
		}

		public async unlink(path: string): Promise<void> {
			return this.unlinkSync(path);
		}

		public async rmdir(path: string): Promise<void> {
			return this.rmdirSync(path);
		}

		public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
			return this.mkdirSync(path, mode, options);
		}

		public async readdir(path: string): Promise<string[]> {
			return this.readdirSync(path);
		}

		public async link(srcpath: string, dstpath: string): Promise<void> {
			return this.linkSync(srcpath, dstpath);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			return this.syncSync(path, data, stats);
		}
	}
	return SyncFS;
}
/* eslint-enable @typescript-eslint/require-await */

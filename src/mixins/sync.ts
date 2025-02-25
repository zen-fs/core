import type { File } from '../internal/file.js';
import type { CreationOptions, FileSystem } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { AsyncFSMethods, Mixin } from './shared.js';

/**
 * Implements the asynchronous API in terms of the synchronous API.
 * @category Internals
 */
/* eslint-disable @typescript-eslint/require-await */
export function Sync<T extends abstract new (...args: any[]) => FileSystem>(FS: T): Mixin<T, AsyncFSMethods> {
	abstract class SyncFS extends FS implements AsyncFSMethods {
		public async exists(path: string): Promise<boolean> {
			return this.existsSync(path);
		}

		public async rename(oldPath: string, newPath: string): Promise<void> {
			return this.renameSync(oldPath, newPath);
		}

		public async stat(path: string): Promise<InodeLike> {
			return this.statSync(path);
		}

		public async touch(path: string, metadata: InodeLike): Promise<void> {
			return this.touchSync(path, metadata);
		}

		public async createFile(path: string, flag: string, options: CreationOptions): Promise<File> {
			return this.createFileSync(path, flag, options);
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

		public async mkdir(path: string, options: CreationOptions): Promise<void> {
			return this.mkdirSync(path, options);
		}

		public async readdir(path: string): Promise<string[]> {
			return this.readdirSync(path);
		}

		public async link(srcpath: string, dstpath: string): Promise<void> {
			return this.linkSync(srcpath, dstpath);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<InodeLike>): Promise<void> {
			return this.syncSync(path, data, stats);
		}

		public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
			return this.readSync(path, buffer, offset, end);
		}

		public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
			return this.writeSync(path, buffer, offset);
		}
	}
	return SyncFS;
}
/* eslint-enable @typescript-eslint/require-await */

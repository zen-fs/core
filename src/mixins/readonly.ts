// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import type { FileSystem } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { Mixin } from './shared.js';

/**
 * @internal
 */
export interface ReadonlyMixin {
	rename(oldPath: string, newPath: string): Promise<never>;
	renameSync(oldPath: string, newPath: string): never;
	createFile(path: string, flag: string, mode: number): Promise<never>;
	createFileSync(path: string, flag: string, mode: number): never;
	unlink(path: string): Promise<never>;
	unlinkSync(path: string): never;
	rmdir(path: string): Promise<never>;
	rmdirSync(path: string): never;
	mkdir(path: string, mode: number): Promise<never>;
	mkdirSync(path: string, mode: number): never;
	link(srcpath: string, dstpath: string): Promise<never>;
	linkSync(srcpath: string, dstpath: string): never;
	touch(path: string, metadata: Readonly<InodeLike>): Promise<never>;
	touchSync(path: string, metadata: Readonly<InodeLike>): never;
	sync(): Promise<never>;
	syncSync(): never;
	write(path: string, buffer: Uint8Array, offset: number): Promise<never>;
	writeSync(path: string, buffer: Uint8Array, offset: number): never;
}

/**
 * Implements the non-readonly methods to throw `EROFS`
 * @category Internals
 */
/* eslint-disable @typescript-eslint/require-await */
export function Readonly<T extends abstract new (...args: any[]) => FileSystem>(FS: T): Mixin<T, ReadonlyMixin> {
	abstract class ReadonlyFS extends FS {
		public constructor(...args: any[]) {
			super(...args);
			this.attributes.set('no_write');
		}

		public async rename(): Promise<never> {
			throw withErrno('EROFS');
		}

		public renameSync(): never {
			throw withErrno('EROFS');
		}

		public async createFile(): Promise<never> {
			throw withErrno('EROFS');
		}

		public createFileSync(): never {
			throw withErrno('EROFS');
		}

		public async unlink(): Promise<never> {
			throw withErrno('EROFS');
		}

		public unlinkSync(): never {
			throw withErrno('EROFS');
		}

		public async rmdir(): Promise<never> {
			throw withErrno('EROFS');
		}

		public rmdirSync(): never {
			throw withErrno('EROFS');
		}

		public async mkdir(): Promise<never> {
			throw withErrno('EROFS');
		}

		public mkdirSync(): never {
			throw withErrno('EROFS');
		}

		public async link(): Promise<never> {
			throw withErrno('EROFS');
		}

		public linkSync(): never {
			throw withErrno('EROFS');
		}

		public async touch(): Promise<never> {
			throw withErrno('EROFS');
		}

		public touchSync(): never {
			throw withErrno('EROFS');
		}

		public async sync(): Promise<never> {
			throw withErrno('EROFS');
		}

		public syncSync(): never {
			throw withErrno('EROFS');
		}

		public async write(): Promise<never> {
			throw withErrno('EROFS');
		}

		public writeSync(): never {
			throw withErrno('EROFS');
		}

		public streamWrite(): never {
			throw withErrno('EROFS');
		}
	}
	return ReadonlyFS;
}
/* eslint-enable @typescript-eslint/require-await */

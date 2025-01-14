import { Errno, ErrnoError } from '../error.js';
import type { FileSystem, FileSystemMetadata } from '../filesystem.js';
import type { StatsLike } from '../stats.js';
import type { Mixin } from './shared.js';

/**
 * @internal
 */
export interface ReadonlyMixin {
	metadata(): FileSystemMetadata;
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
	sync(path: string, data: Uint8Array, stats: Readonly<StatsLike<number>>): Promise<never>;
	syncSync(path: string, data: Uint8Array, stats: Readonly<StatsLike<number>>): never;
	write(path: string, buffer: Uint8Array, offset: number): Promise<never>;
	writeSync(path: string, buffer: Uint8Array, offset: number): Promise<never>;
}

/**
 * Implements the non-readonly methods to throw `EROFS`
 */
/* eslint-disable @typescript-eslint/require-await */
export function Readonly<T extends typeof FileSystem>(FS: T): Mixin<T, ReadonlyMixin> {
	abstract class ReadonlyFS extends FS {
		public metadata(): FileSystemMetadata {
			return { ...super.metadata(), readonly: true };
		}

		public async rename(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public renameSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}

		public async createFile(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public createFileSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}

		public async unlink(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public unlinkSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}

		public async rmdir(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public rmdirSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}

		public async mkdir(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public mkdirSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}

		public async link(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public linkSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}

		public async sync(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public syncSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}

		public async write(): Promise<never> {
			throw new ErrnoError(Errno.EROFS);
		}

		public writeSync(): never {
			throw new ErrnoError(Errno.EROFS);
		}
	}
	return ReadonlyFS;
}
/* eslint-enable @typescript-eslint/require-await */

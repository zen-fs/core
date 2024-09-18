import { Errno, ErrnoError } from '../error.js';
import type { File } from '../file.js';
import type { FileSystem, FileSystemMetadata } from '../filesystem.js';
import type { Stats } from '../stats.js';
import type { Mixin } from './shared.js';

/**
 * Implements the non-readonly methods to throw `EROFS`
 */
/* eslint-disable @typescript-eslint/require-await */
export function Readonly<T extends typeof FileSystem>(
	FS: T
): Mixin<
	T,
	{
		metadata(): FileSystemMetadata;
		rename(oldPath: string, newPath: string): Promise<void>;
		renameSync(oldPath: string, newPath: string): void;
		createFile(path: string, flag: string, mode: number): Promise<File>;
		createFileSync(path: string, flag: string, mode: number): File;
		unlink(path: string): Promise<void>;
		unlinkSync(path: string): void;
		rmdir(path: string): Promise<void>;
		rmdirSync(path: string): void;
		mkdir(path: string, mode: number): Promise<void>;
		mkdirSync(path: string, mode: number): void;
		link(srcpath: string, dstpath: string): Promise<void>;
		linkSync(srcpath: string, dstpath: string): void;
		sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
		syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
	}
> {
	abstract class ReadonlyFS extends FS {
		public metadata(): FileSystemMetadata {
			return { ...super.metadata(), readonly: true };
		}
		/* eslint-disable @typescript-eslint/no-unused-vars */
		public async rename(oldPath: string, newPath: string): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public renameSync(oldPath: string, newPath: string): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async createFile(path: string, flag: string, mode: number): Promise<File> {
			throw new ErrnoError(Errno.EROFS);
		}

		public createFileSync(path: string, flag: string, mode: number): File {
			throw new ErrnoError(Errno.EROFS);
		}

		public async unlink(path: string): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public unlinkSync(path: string): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async rmdir(path: string): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public rmdirSync(path: string): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async mkdir(path: string, mode: number): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public mkdirSync(path: string, mode: number): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async link(srcpath: string, dstpath: string): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public linkSync(srcpath: string, dstpath: string): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			throw new ErrnoError(Errno.EROFS);
		}
	}
	return ReadonlyFS;
}
/* eslint-enable @typescript-eslint/require-await */

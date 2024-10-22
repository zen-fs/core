import { Errno, ErrnoError } from '../error.ts';
import type { File } from '../file.ts';
import type { FileSystem, FileSystemMetadata } from '../filesystem.ts';
import type { Stats } from '../stats.ts';
import type { Mixin } from './shared.ts';

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

		public async rename(): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public renameSync(): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async createFile(): Promise<File> {
			throw new ErrnoError(Errno.EROFS);
		}

		public createFileSync(): File {
			throw new ErrnoError(Errno.EROFS);
		}

		public async unlink(): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public unlinkSync(): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async rmdir(): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public rmdirSync(): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async mkdir(): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public mkdirSync(): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async link(): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public linkSync(): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async sync(): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public syncSync(): void {
			throw new ErrnoError(Errno.EROFS);
		}
	}
	return ReadonlyFS;
}
/* eslint-enable @typescript-eslint/require-await */

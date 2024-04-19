import { Buffer } from 'buffer';
import type * as Node from 'fs';
import type { BufferEncodingOption, EncodingOption, ReadSyncOptions, StatOptions, symlink } from 'fs';
import { ApiError, ErrorCode } from '../ApiError';
import { ActionType, File, isAppendable, isReadable, isWriteable, parseFlag, pathExistsAction, pathNotExistsAction } from '../file';
import { FileContents, FileSystem } from '../filesystem';
import { BigIntStats, FileType, type BigIntStatsFs, type Stats, type StatsFs } from '../stats';
import { Dir, Dirent } from '../emulation/dir';
import { dirname, join, parse } from '../emulation/path';
import { PathLike, cred, fd2file, fdMap, fixError, getFdForFile, mounts, normalizeMode, normalizeOptions, normalizePath, normalizeTime, resolveMount } from '../emulation/shared';


// Import all necessary filesystem functions from "./sync"
import * as sync from '../emulation/sync';

// Import the cwd function from "./process.ts" and resolve from "./path"
import { cwd } from '.';
import { resolve } from '../emulation/path';
import { initializeRootProcess } from './process';

initializeRootProcess();

// Helper to resolve paths
function resolvePath(path) {
	return resolve(cwd(), path);
}

// Proxy statSync
export function statSync(path: PathLike, options?: { bigint?: false }): Stats;
export function statSync(path: PathLike, options: { bigint: true }): BigIntStats;
export function statSync(path: PathLike, options?: StatOptions): Stats | BigIntStats {
	const _path = resolvePath(path);
	// @ts-ignore
	return _statSync(_path, options);
}

// Proxy readFileSync
export function readFileSync(filename: string, options?: { flag?: string }): Buffer;
export function readFileSync(filename: string, options: (Node.EncodingOption & { flag?: string }) | BufferEncoding): string;
export function readFileSync(filename: string, options: Node.WriteFileOptions = {}): FileContents {
	const _path = resolvePath(filename);
	return sync.readFileSync(_path, options);
}

// Proxy writeFileSync
export function writeFileSync(filename: string, data: FileContents, options?: Node.WriteFileOptions): void;
export function writeFileSync(filename: string, data: FileContents, encoding?: BufferEncoding): void;
export function writeFileSync(filename: string, data: FileContents, _options?: Node.WriteFileOptions | BufferEncoding): void {
	const _path = resolvePath(filename);
	sync.writeFileSync(_path, data, _options);
}

// Proxy mkdirSync
export function mkdirSync(path: PathLike, options: Node.MakeDirectoryOptions & { recursive: true }): string;
export function mkdirSync(path: PathLike, options?: Node.Mode | (Node.MakeDirectoryOptions & { recursive?: false })): void;
export function mkdirSync(path: PathLike, options?: Node.Mode | Node.MakeDirectoryOptions): string | void {
	const _path = resolvePath(path);
	// @ts-ignore
	sync.mkdirSync(_path, options);
}

// Proxy realpathSync
export function realpathSync(path: PathLike, options: BufferEncodingOption): Buffer;
export function realpathSync(path: PathLike, options?: EncodingOption): string;
export function realpathSync(path: PathLike, options?: EncodingOption | BufferEncodingOption): string | Buffer {
	const _path = resolvePath(path);
	// @ts-ignore
	return sync.realpathSync(_path, options);
}

// Proxy unlinkSync
export function unlinkSync(path: PathLike): void {
	const _path = resolvePath(path);
	sync.unlinkSync(_path);
}

export function readdirSync(path: PathLike, options?: { encoding?: BufferEncoding; withFileTypes?: false } | BufferEncoding): string[];
export function readdirSync(path: PathLike, options: { encoding: 'buffer'; withFileTypes?: false } | 'buffer'): Buffer[];
export function readdirSync(path: PathLike, options: { withFileTypes: true }): Dirent[];
export function readdirSync(path: PathLike, options?: { encoding?: BufferEncoding | 'buffer'; withFileTypes?: boolean } | string): string[] | Dirent[] | Buffer[] {
	const _path = resolvePath(path);
	// @ts-ignore
	return sync.readdirSync(_path, options);
}

export function existsSync(path: PathLike): boolean {
	const _path = resolvePath(path);
	return sync.existsSync(_path);
}

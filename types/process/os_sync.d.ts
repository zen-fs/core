/// <reference types="node" />
/// <reference types="node" />
import { Buffer } from 'buffer';
import type * as Node from 'fs';
import type { BufferEncodingOption, EncodingOption } from 'fs';
import { FileContents } from '../filesystem';
import { BigIntStats, type Stats } from '../stats';
import { Dirent } from '../emulation/dir';
import { PathLike } from '../emulation/shared';
export declare function statSync(path: PathLike, options?: {
    bigint?: false;
}): Stats;
export declare function statSync(path: PathLike, options: {
    bigint: true;
}): BigIntStats;
export declare function readFileSync(filename: string, options?: {
    flag?: string;
}): Buffer;
export declare function readFileSync(filename: string, options: (Node.EncodingOption & {
    flag?: string;
}) | BufferEncoding): string;
export declare function writeFileSync(filename: string, data: FileContents, options?: Node.WriteFileOptions): void;
export declare function writeFileSync(filename: string, data: FileContents, encoding?: BufferEncoding): void;
export declare function mkdirSync(path: PathLike, options: Node.MakeDirectoryOptions & {
    recursive: true;
}): string;
export declare function mkdirSync(path: PathLike, options?: Node.Mode | (Node.MakeDirectoryOptions & {
    recursive?: false;
})): void;
export declare function realpathSync(path: PathLike, options: BufferEncodingOption): Buffer;
export declare function realpathSync(path: PathLike, options?: EncodingOption): string;
export declare function unlinkSync(path: PathLike): void;
export declare function readdirSync(path: PathLike, options?: {
    encoding?: BufferEncoding;
    withFileTypes?: false;
} | BufferEncoding): string[];
export declare function readdirSync(path: PathLike, options: {
    encoding: 'buffer';
    withFileTypes?: false;
} | 'buffer'): Buffer[];
export declare function readdirSync(path: PathLike, options: {
    withFileTypes: true;
}): Dirent[];
export declare function existsSync(path: PathLike): boolean;

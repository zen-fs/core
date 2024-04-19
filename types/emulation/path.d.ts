/// <reference types="node" />
import type { ParsedPath } from 'node:path';
export declare let cwd: string;
export declare function cd(path: string): void;
export declare const sep = "/";
export declare function normalizeString(path: string, allowAboveRoot: boolean): string;
export declare function formatExt(ext: string): string;
export declare function resolve(...args: string[]): string;
export declare function normalize(path: string): string;
export declare function isAbsolute(path: string): boolean;
export declare function join(...args: string[]): string;
export declare function relative(from: string, to: string): string;
export declare function dirname(path: string): string;
export declare function basename(path: string, suffix?: string): string;
export declare function extname(path: string): string;
export declare function format(pathObject: ParsedPath): string;
export declare function parse(path: string): ParsedPath;

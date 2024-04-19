import { FileSystem } from './filesystem';
import { Cred } from './cred';
declare global {
    function atob(data: string): string;
    function btoa(data: string): string;
}
/**
 * Synchronous recursive makedir.
 * @hidden
 */
export declare function mkdirpSync(p: string, mode: number, cred: Cred, fs: FileSystem): void;
/**
 * Calculates levenshtein distance.
 * @hidden
 */
export declare function levenshtein(a: string, b: string): number;
/**
 * Waits n ms.
 * @hidden
 */
export declare function wait(ms: number): Promise<void>;
/**
 * @hidden
 */
export declare const setImmediate: (callback: () => unknown) => void;
/**
 * Encodes a string into a buffer
 * @internal
 */
export declare function encode(input: string): Uint8Array;
/**
 * Decodes a string from a buffer
 * @internal
 */
export declare function decode(input?: Uint8Array): string;
/**
 * Decodes a directory listing
 * @hidden
 */
export declare function decodeDirListing(data: Uint8Array): Record<string, bigint>;
/**
 * Encodes a directory listing
 * @hidden
 */
export declare function encodeDirListing(data: Record<string, bigint>): Uint8Array;
/**
 * Extracts an object of properties assignable to P from an object T
 * @hidden
 */
export type ExtractProperties<T, P> = {
    [K in keyof T as T[K] extends infer Prop ? (Prop extends P ? K : never) : never]: T[K];
};
/**
 * Extract a the keys in T which are required properties
 * @hidden
 * @see https://stackoverflow.com/a/55247867/17637456
 */
export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends {
        [P in K]: T[K];
    } ? never : K;
}[keyof T];

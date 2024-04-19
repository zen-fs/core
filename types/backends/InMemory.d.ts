import type { Ino } from '../inode';
import { SimpleSyncStore, SyncStore, SyncStoreFS, SyncTransaction } from './SyncStore';
/**
 * A simple in-memory store
 */
export declare class InMemoryStore implements SyncStore, SimpleSyncStore {
    name: string;
    private store;
    constructor(name?: string);
    clear(): void;
    beginTransaction(): SyncTransaction;
    get(key: Ino): Uint8Array;
    put(key: Ino, data: Uint8Array, overwrite: boolean): boolean;
    remove(key: Ino): void;
}
/**
 * A simple in-memory file system backed by an InMemoryStore.
 * Files are not persisted across page loads.
 */
export declare const InMemory: {
    readonly name: "InMemory";
    readonly isAvailable: () => boolean;
    readonly options: {
        readonly name: {
            readonly type: "string";
            readonly required: false;
            readonly description: "The name of the store";
        };
    };
    readonly create: ({ name }: {
        name?: string;
    }) => SyncStoreFS;
};

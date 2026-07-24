---
title: Virtual File System (VFS)
---

## Overview

The Virtual File System (VFS) in ZenFS provides an abstraction layer that emulates the `node:fs` API, allowing applications to interact with files and directories in a unified manner. The VFS is responsible for handling path resolution, managing file system contexts, and mounting various storage backends.

### Path Translation and Resolution

The VFS converts user-provided paths into normalized absolute paths that the system can process. It also resolves which path corresponds to which mounted file system. This ensures compatibility with different storage backends and maintains a consistent structure across the system. Also, the VFS handles support for symlinks— which the internal API is unaware of.

### `node:fs` Emulation

The VFS provides a consistent API that mirrors Node.js's built-in file system module— down to full type compatibility!

### Contexts and permissions

_Main article: [Security](./security.md)_

Contexts in ZenFS encapsulate file system operations within an execution scope. In addition to changing the uid/gid, this allows the ability to effectively `chroot`.

### Mounts

ZenFS allows mounting multiple storage backends, enabling seamless access to diverse storage implementations. A mounted backend can be a local filesystem, an in-memory store, a cloud providers storage system (e.g. Google Drive), etc. The limit is your imagination. Some nice features include hot-swapping mounts and per-mount configurations.

### Files and File Descriptors

The VFS is also responsible for handling open files and file descriptors.

## Vnodes

A `VNode` is the VFS-level representation of a file. It is roughly equivalent to Linux's in-memory `struct inode`. Each vnode is the single authoritative copy of an inode's metadata, along with cached file data. Every open `Handle` for a file shares one vnode, which means metadata changes (like a truncate) are immediately visible across handles instead of each handle having its own possibly stale copy.

Vnodes cache file data using a [`Resource`](https://james-pre.github.io/utilium/classes/cache.Resource.html). This works like a page cache, though with byte granularity rather than fixed-size pages. Reads are served from the cache and fill it from the backend on a miss. Writes go _only_ to the cache; the vnode tracks which ranges are dirty, and nothing is written to the backend until the vnode is synced. When a sync happens, dirty data is written first and metadata second, in a single flush. This means a file's data and metadata are updated together rather than being split across many partial backend writes.

A vnode is synced when:

- A handle for it is synced or closed (`fsync`, `fdatasync`, `close`)
- The file was opened with `O_SYNC`, the inode has the `Sync` flag, or the file system has the `sync` attribute, in which case every operation syncs immediately
- The file system is unmounted

Character devices, block devices, and inodes with the `DAX` flag bypass the data cache (reads and writes go directly to the backend).

Note that `VNode` methods do _not_ acquire the vnode's lock. Operations usually span multiple vnode calls, so callers are responsible for locking.

## The Vnode Cache (vcache)

Every file system gets a `VCache`, which keeps track of its vnodes. This is modeled after Linux's dcache and icache. Vnodes are keyed by ino, so hard links naturally share a vnode. A separate path index is maintained for lookups, and is updated when paths change. `rename` re-keys entries (including descendants when renaming a directory), `link` adds paths, and `unlink` removes them.

Vnodes are reference counted with `ref` and `unref`, similar to `i_count`. A vnode stays cached while it is referenced or dirty, and is evicted once it is neither. This bounds the cache to open files and unsynced changes. There is no LRU for keeping around clean, unreferenced vnodes (yet).

The cache is created when a file system is mounted. On unmount, all dirty vnodes are synced and the cache is dropped.

Since a vnode may have unsynced changes, VFS operations that stat a path check the cache first:

```ts
const stats = cacheOf(fs).get(path)?.inode ?? fs.statSync(path);
```

A cached vnode's inode takes precedence over the backend, since it is authoritative when dirty. When a clean vnode is `ref`ed with fresh stats, its inode is refreshed instead.

## Locking

Every vnode has a readers-writer lock, `RwLock`. This is modeled after Linux's `rw_semaphore`, which is used for `i_rwsem`. A lock can be held by multiple readers (`ro`) or one exclusive writer (`rw`).

Operations that modify a directory's entries (creating, unlinking, or renaming files) lock the _parent directory's_ vnode with `rw`. This serializes the backend's read-modify-write of the directory listing, which prevents concurrent operations from losing entries ([#256](https://github.com/zen-fs/core/issues/256), [#298](https://github.com/zen-fs/core/issues/298)). `rename` may need to lock two directories, in which case they are locked in ascending inode number order to avoid ABBA deadlocks. This is the same trick as Linux's `lock_two_nondirectories`.

Since a vnode may not be cached when an operation needs to lock it, the `lockPath` and `lockPathSync` helpers ref the vnode, lock it, and return a single release that undoes both. These pair nicely with `using`:

```ts
using _ = lockPathSync(fs, dirname(resolved), 'rw', parentStats);
fs.createFileSync(resolved, options);
```

Synchronous code can't wait for a lock to be released, so `lockSync` never blocks. If the lock is available (or only contended by queued waiters), it is granted immediately. Otherwise:

- If the holder is asynchronous, `EAGAIN` is thrown. The operation can be retried later, consistent with how synchronous operations on asynchronous backends already behave
- If the holder is synchronous, it must be higher up in the current call chain. Waiting would deadlock, so `EDEADLK` is thrown.

### Integration with Backends

_Main article: [Backends](./backends.md)_

The VFS does not directly interact with storage media but instead routes all file operations to the appropriate backend. This design ensures modularity and simplifies the addition of new storage backends.

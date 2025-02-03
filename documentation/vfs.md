---
title: Virtual File System (VFS)
---

> [!NOTE]
> This article is a work in progress!

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

### Integration with Backends

_Main article: [Backends](./backends.md)_

The VFS does not directly interact with storage media but instead routes all file operations to the appropriate backend. This design ensures modularity and simplifies the addition of new storage backends.

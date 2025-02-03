---
title: Internal API
category: Internals
---

## Overview

The Internal API is the foundation of ZenFS, providing a standardized interface for managing file systems and file operations. All backends must instantiate a `FileSystem` implementation that conforms to this API, ensuring compatibility with the Virtual File System (VFS) and applications using ZenFS.

## `FileSystem`

The `FileSystem` class is the core of the internal API. It abstracts file storage operations, metadata management, and error handling. `FileSystem` does a few things:

**Storage Abstraction:** Defines how files and directories are represented within a backend.

**Usage Information (`UsageInfo`):** Tracks available storage, block sizes, and inode counts.

**Metadata:** Various pieces of metadata, which are used by the VFS. This includes:

- `attributes` is designed to keep track of simple values. This is analogous to options in [/etc/fstab](https://en.wikipedia.org/wiki/Fstab).
- `name` is for the name of the file system type. For example, `tmpfs` is the name of `InMemory`. This is modeled after `file_system_type->name` in Linux
- `id` is a unique 32-bit unsigned integer for the type of file system. It is currently unused internally but may in the future (one compelling use case is to resolve collisions of `name`). This is primarily designed for users, for example it could be used for partition tables.
- `label` is an optional field that is designed to be used with instances. This is the same as labels in the context of normal partitions and file systems.

**File Operations:** Implements core actions like creating, reading, writing, and deleting files.

**Error Handling:** Standardizes file system errors through `ErrnoError`.

## `File`

The `File` class provides low-level mechanisms for working with files, ensuring standard behaviors across backends.

## Backends and the Internal API

Backends in ZenFS do not implement file operations directly. Instead, they instantiate a `FileSystem` implementation that conforms to the internal API.

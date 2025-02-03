---
title: Architecture
children:
	- ./backends.md
	- ./internal.md
	- ./vfs.md
---

> [!NOTE]
> This article is a work in progress!

ZenFS is modular, designed to provide a flexible abstraction over multiple storage backends. It allows applications to interact with files and directories without needing to be aware of the underlying storage mechanism. Separating the file system logic into distinct layers ensures maintainability and extensibility, without a major impact on performance.

ZenFS is built upon three main components:

## 1. Virtual File System (VFS)

_Main article: [Virtual File System (VFS)](./vfs.md)_

The Virtual File System (VFS) is responsible for emulating the `node:fs` API, path resolution, and mounting different storage backends. It provides a unified interface that applications interact with, abstracting away differences between storage implementations.

Responsibilities:

- Path translation and resolution
- `node:fs` emulation
- Managing contexts and permissions
- Handling mounts for different backends

## 2. Backends

_Main article: [Backends](./backends.md)_

Backends provide a modular way to configure and use various underlying storage implementations. They are the metaphorical glue between the VFS, configuration, and the internal API.

## 3. Internal API

_Main article: [Internal API](./internal.md)_

The Internal API provides the core functionality of ZenFS. It serves as the foundation that both the VFS and backends rely on. The internal API is what backend implementations conform to, allowing the VFS to easily perform operations without knowledge of the underlying implementation.

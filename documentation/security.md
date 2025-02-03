---
title: Security
---

> [!WARNING]
> Since ZenFS exists purely client-side, this is **not** a true security boundary!

## Overview

Security in ZenFS is handled at the Virtual File System (VFS) level, ensuring that file operations comply with access control rules before interacting with storage backends. The primary mechanisms for enforcing security include permissions enforcement, user credential management, and execution contexts. ZenFS is designed to be used with a _single import per ES realm_.

## Permissions Enforcement in the VFS

The VFS is responsible for checking file permissions before executing operations. This ensures that unauthorized access attempts are blocked before reaching the backend storage system. Permissions are enforced based on the user ID (UID) and group ID (GID) associated with the process performing the operation.

## `chroot`: Isolated Execution

`chroot` in ZenFS is implemented as a shortcut for creating a new execution context or modifying an existing one. The effective uid or gid of the current set of credentials object _must_ be 0, which ensures untrusted code given a `chroot`ed environment cannot escape.

```ts
import { fs } from '@zenfs/core';

const ctx = fs.chroot('/sandbox');
ctx.writeFileSync('/file.txt', 'Restricted');
console.log(ctx.readdirSync('/'));
```

## User and Group ID Management via `configure`

ZenFS allows modifying user and group IDs (UID/GID) through configure. This allows you to use permissions, since by default the root user always has permission.

Example Configuration

```ts
await configure({ uid: 1001, gid: 1001 });
```

## Credentials Management

ZenFS maintains an internal credentials system, similar to the Linux `cred` struct, which defines the user and group ownership of operations.

## Contexts: Secure Execution Environments (kind of)

Contexts (`FSContext`/`BoundContext`) in ZenFS define isolated execution environments that enforce security constraints. Each context has:

- A root directory (enabling `chroot`-like isolation).
- Bound credentials that determine access permissions.

**Example: Using a Context**

```ts
import { bindContext, fs } from '@zenfs/core';

const ctx = bindContext('/secure', { uid: 333, gid: 333 });

ctx.writeFileSync('/data.txt', 'Restricted Access');

console.log(fs.readdirSync('/secure')); // ['data.txt']
```

Contexts provide the fundamentals for building custom processes, the primary unit of execution in operating systems. By encapsulating a root directory and credentials, contexts allow for controlled access, process isolation, and flexible permission management. This design mirrors how modern OSes handle security and execution environments, enabling fine-grained control over filesystem interactions.

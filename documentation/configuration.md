---
title: Configuration
---

## Overview

The `configure` function is the primary entry point for setting up ZenFS. It determines which backends to use and how they are mounted.

## Setting Up ZenFS

The `configure` function initializes ZenFS with the provided configuration object. It makes sure file systems are set up and ready, then mounts them. Also, `configure` allows you to enable or disable features— like permissions. For more information on the options available, refer to the documentation for the `Configuration` interface.

Example Usage:

```ts
import { configure, InMemory } from '@zenfs/core';

await configure({
	mounts: {
		'/tmp': { backend: InMemory, label: 'temp-storage' },
	},
});
```

## Synchronous configuration

If you require configuration to be done synchronously, you can use `configureSync`. Note that will throw `EWOULDBLOCK`/`EAGAIN` when asynchronous backends are encountered.

```ts
import { configureSync, InMemory } from '@zenfs/core';

configureSync({
	mounts: {
		'/tmp': { backend: InMemory, label: 'temp-storage' },
	},
});
```

Backends that do all their work eagerly, such as `InMemory` and `SingleBuffer`, are designed to work with these synchronous configuration helpers.

For single-mount scenarios there are matching helpers: use `configureSingle` (or `configureSingleSync`) to replace the root mount without providing a full configuration object.

## Mounting File Systems and `resolveMountConfig`

Mounting file systems in ZenFS is handled dynamically. When a mount configuration is provided, it is processed using `resolveMountConfig`, which determines how the backend should be initialized and mounted.

`resolveMountConfig` parses the provided mount configuration, validates the backend and its options, and instantiates the appropriate `FileSystem` for the given backend. It then returns the instance after it is ready. For example:

```ts
import { resolveMountConfig, InMemory, mount } from '@zenfs/core';

const tmpfs = await resolveMountConfig({
	backend: InMemory,
	label: 'temp-storage',
});

mount('/mnt/tmp', tmpfs);
```

When dealing exclusively with synchronous backends, you can call `resolveMountConfigSync`. It performs the same validation, but it throws if a backend performs any asynchronous work during creation or readiness.

### Dynamic Mounting

Mounts can be resolved dynamically at runtime, allowing flexibility when configuring storage. This is especially useful for:

- Swapping backends on the fly.
- Mounting remote storage systems dynamically.
- Creating temporary in-memory file systems.

## Contexts

_Main article: [Security](./security.md)_

Contexts allow you to create an additional `node:fs` "module" which has a different set of credentials and root.

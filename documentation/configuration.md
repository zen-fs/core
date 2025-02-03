---
title: Configuration
---

## Overview

The `configure` function is the primary entry point for setting up ZenFS. It determines which backends to use and how they are mounted.

## `configure`: Setting Up ZenFS

The `configure` function initializes ZenFS with the provided configuration object. It makes sure file systems are set up and ready, then mounts them. Also, `configure` allows you to enable or disable features— like permissions. For more information on the options available, refer to the documentation for the `Configuration` interface.

Example Usage:

```ts
import { configure, InMemory } from '@zenfs/core';

await configure({
	mounts: {
		'/tmp': { backend: InMemory, options: { name: 'temp-storage' } },
	},
});
```

## Mounting File Systems and `resolveMountConfig`

Mounting file systems in ZenFS is handled dynamically. When a mount configuration is provided, it is processed using `resolveMountConfig`, which determines how the backend should be initialized and mounted.

`resolveMountConfig` parses the provided mount configuration, validates the backend and its options, and instantiates the appropriate `FileSystem` for the given backend. It then returns the instance after it is ready. For example:

```ts
import { resolveMountConfig, InMemory, mount } from '@zenfs/core';

const tmpfs = await resolveMountConfig({
	backend: InMemory,
	options: { name: 'temp-storage' },
});

mount('/mnt/tmp', tmpfs);
```

### Dynamic Mounting

Mounts can be resolved dynamically at runtime, allowing flexibility when configuring storage. This is especially useful for:

- Swapping backends on the fly.
- Mounting remote storage systems dynamically.
- Creating temporary in-memory file systems.

## Contexts

_Main article: [Security](./security.md)_

Contexts allow you to create an additional `node:fs` "module" which has a different set of credentials and root.

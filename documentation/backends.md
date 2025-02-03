---
title: Backends
---

## Overview

Backends in ZenFS are configuration-driven objects that instantiate storage implementations conforming to the internal API. Rather than directly handling file operations, the VFS routes all interactions through a backend, which creates and configures a `FileSystem` instance.

## Configuration

Backends in ZenFS are designed to be configuration-driven. Each backend provides:

A `name`, used to identify the backend type.

A set of configuration `options`, defined via `OptionsConfig<T>`.

A `create` method, which returns an instance of `FileSystem` or a promise resolving to an instance of `FileSystem`.

## An example

An example implementation of a backend might look something like this:

```ts
interface ExampleOptions {
	raw: RawExampleData; // e.g. `Storage` for a backend that works with `localStorage`
}

const Example = {
	name: 'ExampleStorage',
	options: {
		raw: { type: 'object', required: true },
	},
	async create({ raw }: ExampleOptions) {
		await raw.doSomethingAsync();
		return new ExampleFS(raw);
	},
} as const satisfies Backend<ExampleFS, ExampleOptions>;
```

**Why do backends use `as const`, `satisfies`, and other strange ways to export a simple object**

If you've taken a look at ZenFS' code, you may have noticed just how convoluted an actual backend definition is:

```ts
const _InMemory = {
	// ...
} as const satisfies Backend<StoreFS<InMemoryStore>, { name?: string }>;
type _InMemory = typeof _InMemory;
export interface InMemory extends _InMemory {}
export const InMemory: InMemory = _InMemory;
```

There are quite a few things going on here, but they are all for a good reason:

1. `as const` and `satisfies`: This is to make sure the backend has the strictest types Typescript will allow, which in turn allow for more detailed and precise information when you try to incorrectly configure a backend
2. `type _...` and `interface`: The `type` alias is needed since [interfaces can't extend typeof types](https://github.com/Microsoft/TypeScript/issues/14757). Using an interface means when a backend is incorrectly `configure`d, you will see the interface name. If this isn't done, VS Code and Typescript will show the _entire_ expanded `as const` type definition in the error message.
3. Exporting with a different name: This is done since a type can not be referenced in its own definition

## Integration with VFS and Internal API

The VFS does not interact directly with storage media. Instead, it mounts a configured backend, which in turn instantiates a `FileSystem`. This design ensures modularity and simplifies adding new storage types.

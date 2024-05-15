
# Store

While `StoreFS`, `Store`, etc. don't provide any backends directly, they are invaluable for creating new backends with a minimal amount of code.

`StoreFS` implements the all of `FileSystem` using a `Store`.

`Store` and `Transaction` are simple interfaces which are used by `StoreFS`.

In [simple.ts](./simple.ts) you can find `SimpleSyncStore`, `SimpleAsyncStore`, and `SimpleTransaction`. These classes provide an even more simple interface. This means backends like `InMemory` can be implemented with a very small amount of code.


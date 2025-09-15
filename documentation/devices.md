---
title: Devices and Device Drivers
---

> [!WARNING]
> The device and device driver API is being upgraded into a broader "kernel" module API.
> See [#262](https://github.com/zen-fs/core/issues/262) for more information.

ZenFS includes support for device files. These are designed to follow Linux's device file behavior, for consistency and ease of use. You can automatically add some normal devices with the `addDevices` configuration option:

```ts
await configure({
	mounts: {
		/* ... */
	},
	addDevices: true,
});

fs.writeFileSync('/dev/null', 'Some data to be discarded');

const randomData = new Uint8Array(100);

const random = fs.openSync('/dev/random', 'r');
fs.readSync(random, randomData);
fs.closeSync(random);
```

## Device Drivers

You can create your own devices by implementing a `DeviceDriver`. For example, the null device looks similar to this:

```ts
const customNullDevice = {
	name: 'custom_null',
	// only 1 can exist per DeviceFS
	singleton: true,
	// optional if false
	isBuffered: false,
	read() {
		return 0;
	},
	write() {
		return 0;
	},
};
```

Note the actual implementation's write is slightly more complicated since it adds to the file position. You can find more information on the docs.

Finally, if you'd like to use your custom device with the file system:

```ts
import { addDevice, fs } from '@zenfs/core';

addDevice(customNullDevice);

fs.writeFileSync('/dev/custom', 'This gets discarded.');
```

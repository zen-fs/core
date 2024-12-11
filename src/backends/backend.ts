/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Entries, RequiredKeys } from 'utilium';
import { ErrnoError, Errno } from '../error.js';
import type { FileSystem } from '../filesystem.js';

type OptionType = 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' | (abstract new (...args: any[]) => any);

/**
 * Resolves the type of Backend.options from the options interface
 */
export type OptionsConfig<T> = {
	[K in keyof T]: {
		/**
		 * The basic JavaScript type(s) for this option.
		 */
		type: OptionType | readonly OptionType[];

		/**
		 * Description of the option. Used in error messages and documentation.
		 * @deprecated
		 */
		description?: string;

		/**
		 * Whether or not the option is required (optional can be set to null or undefined). Defaults to false.
		 */
		required: K extends RequiredKeys<T> ? true : false;

		/**
		 * A custom validation function to check if the option is valid.
		 * When async, resolves if valid and rejects if not.
		 * When sync, it will throw an error if not valid.
		 */
		validator?(opt: T[K]): void | Promise<void>;
	};
};

/**
 * Configuration options shared by backends and `Configuration`
 */
export interface SharedConfig {
	/**
	 * If set, disables the sync cache and sync operations on async file systems.
	 */
	disableAsyncCache?: boolean;
}

/**
 * A backend
 */
export interface Backend<FS extends FileSystem = FileSystem, TOptions extends object = object> {
	/**
	 * Create a new instance of the backend
	 */
	create(options: TOptions & Partial<SharedConfig>): FS | Promise<FS>;

	/**
	 * A name to identify the backend.
	 */
	name: string;

	/**
	 * Describes all of the options available for this backend.
	 */
	options: OptionsConfig<TOptions>;

	/**
	 * Whether the backend is available in the current environment.
	 * It supports checking synchronously and asynchronously
	 *
	 * Returns 'true' if this backend is available in the current
	 * environment. For example, a backend using a browser API will return
	 * 'false' if the API is unavailable
	 *
	 */
	isAvailable?(): boolean | Promise<boolean>;
}

/**
 * Gets the options type of a backend
 * @internal
 */
export type OptionsOf<T extends Backend> = T extends Backend<FileSystem, infer TOptions> ? TOptions : never;

/**
 * Gets the FileSystem type for a backend
 * @internal
 */
export type FilesystemOf<T extends Backend> = T extends Backend<infer FS> ? FS : never;

/** @internal */
export function isBackend(arg: unknown): arg is Backend {
	return arg != null && typeof arg == 'object' && 'create' in arg && typeof arg.create == 'function';
}

/**
 * Checks that `options` object is valid for the file system options.
 * @internal
 */
export async function checkOptions<T extends Backend>(backend: T, options: Record<string, unknown>): Promise<void> {
	if (typeof options != 'object' || options === null) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid options');
	}

	// Check for required options.
	for (const [optName, opt] of Object.entries(backend.options) as Entries<OptionsConfig<Record<string, any>>>) {
		const value = options?.[optName];

		if (value === undefined || value === null) {
			if (!opt.required) {
				continue;
			}

			throw new ErrnoError(Errno.EINVAL, 'Missing required option: ' + optName);
		}

		// Option provided, check type.

		type T = typeof opt.type extends (infer U)[] ? U : typeof opt.type;

		const isType = (value: unknown): value is T => (typeof opt.type == 'function' ? value instanceof opt.type : typeof value === opt.type);

		if (Array.isArray(opt.type) ? !opt.type.some(isType) : !isType(value)) {
			// The type of the value as a string
			const type = typeof value == 'object' && 'constructor' in value ? value.constructor.name : typeof value;

			// The expected type (as a string)
			const name = (type: OptionType) => (typeof type == 'function' ? type.name : type);
			const expected = Array.isArray(opt.type) ? `one of ${opt.type.map(name).join(', ')}` : name(opt.type as OptionType);

			throw new ErrnoError(Errno.EINVAL, `Incorrect type for "${optName}": ${type} (expected ${expected})`);
		}

		if (opt.validator) {
			await opt.validator(value);
		}
		// Otherwise: All good!
	}
}

/**
 * Specifies a file system backend type and its options.
 *
 * Individual options can recursively contain BackendConfiguration objects for values that require file systems.
 *
 * The configuration for each file system corresponds to that file system's option object passed to its `create()` method.
 */
export type BackendConfiguration<T extends Backend> = OptionsOf<T> & Partial<SharedConfig> & { backend: T };

/** @internal */
export function isBackendConfig<T extends Backend>(arg: unknown): arg is BackendConfiguration<T> {
	return arg != null && typeof arg == 'object' && 'backend' in arg && isBackend(arg.backend);
}

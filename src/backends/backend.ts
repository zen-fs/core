import { ApiError, ErrorCode } from '../ApiError.js';
import { FileSystem } from '../filesystem.js';
import { levenshtein } from '../utils.js';

type OptionType = 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function';

/**
 * Describes a file system option.
 */
export interface OptionConfig<T> {
	/**
	 * The basic JavaScript type(s) for this option.
	 */
	type: OptionType | OptionType[];

	/**
	 * Whether or not the option is required (optional can be set to null or undefined). Defaults to false.
	 */
	required?: boolean;

	/**
	 * Description of the option. Used in error messages and documentation.
	 */
	description: string;

	/**
	 * A custom validation function to check if the option is valid.
	 * When async, resolves if valid and rejects if not.
	 * When sync, it will throw an error if not valid.
	 */
	validator?(opt: T): void | Promise<void>;
}

/**
 * Describes all of the options available in a file system.
 */
type BackendOptionsConfig = Record<string, OptionConfig<unknown>>;

/**
 * A backend
 */
export interface Backend<FS extends FileSystem = FileSystem, OC extends BackendOptionsConfig = BackendOptionsConfig> {
	/**
	 * Create a new instance of the backend
	 */
	create(options: object): FS;

	/**
	 * A name to identify the backend.
	 */
	name: string;

	/**
	 * Describes all of the options available for this backend.
	 */
	options: OC;

	/**
	 * Whether the backend is available in the current environment.
	 * It supports checking synchronously and asynchronously
	 * Sync:
	 * Returns 'true' if this backend is available in the current
	 * environment. For example, a `localStorage`-backed filesystem will return
	 * 'false' if the browser does not support that API.
	 *
	 * Defaults to 'false', as the FileSystem base class isn't usable alone.
	 */
	isAvailable(): boolean;
}

/**
 * @internal
 */
export function isBackend(arg: unknown): arg is Backend {
	return arg != null && typeof arg == 'object' && 'isAvailable' in arg && typeof arg.isAvailable == 'function' && 'create' in arg && typeof arg.create == 'function';
}

/**
 * Checks that the given options object is valid for the file system options.
 * @internal
 */
export async function checkOptions(backend: Backend, opts: object): Promise<void> {
	if (typeof opts != 'object' || opts === null) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid options');
	}

	// Check for required options.
	for (const [optName, opt] of Object.entries(backend.options)) {
		const providedValue = opts?.[optName];

		if (providedValue === undefined || providedValue === null) {
			if (!opt.required) {
				continue;
			}
			/* Required option not provided.
			if any incorrect options provided, which ones are close to the provided one?
			(edit distance 5 === close)*/
			const incorrectOptions = Object.keys(opts)
				.filter(o => !(o in backend.options))
				.map((a: string) => {
					return { str: a, distance: levenshtein(optName, a) };
				})
				.filter(o => o.distance < 5)
				.sort((a, b) => a.distance - b.distance);

			throw new ApiError(
				ErrorCode.EINVAL,
				`${backend.name}: Required option '${optName}' not provided.${
					incorrectOptions.length > 0 ? ` You provided '${incorrectOptions[0].str}', did you mean '${optName}'.` : ''
				}`
			);
		}
		// Option provided, check type.
		const typeMatches = Array.isArray(opt.type) ? opt.type.indexOf(typeof providedValue) != -1 : typeof providedValue == opt.type;
		if (!typeMatches) {
			throw new ApiError(
				ErrorCode.EINVAL,
				`${backend.name}: Value provided for option ${optName} is not the proper type. Expected ${
					Array.isArray(opt.type) ? `one of {${opt.type.join(', ')}}` : opt.type
				}, but received ${typeof providedValue}`
			);
		}

		if (opt.validator) {
			await opt.validator(providedValue);
		}
		// Otherwise: All good!
	}
}

export function createBackend<B extends Backend>(backend: B, options?: object): Promise<ReturnType<B['create']>> {
	checkOptions(backend, options);
	const fs = <ReturnType<B['create']>>backend.create(options);
	return fs.ready();
}

export const backends: { [backend: string]: Backend } = {};

export function registerBackend(..._backends: Backend[]) {
	for (const backend of _backends) {
		backends[backend.name] = backend;
	}
}

/**
 * Specifies a file system backend type and its options.
 *
 * Individual options can recursively contain BackendConfig objects for
 * option values that require file systems.
 *
 * The option object for each file system corresponds to that file system's option object passed to its `Create()` method.
 */
export interface BackendConfig {
	backend: Backend;
	[key: string]: unknown;
}

/**
 * @internal
 */
export function isBackendConfig(arg: unknown): arg is BackendConfig {
	return arg != null && typeof arg == 'object' && 'backend' in arg;
}

/**
 * Retrieve a file system with the given configuration.
 * @param config A BackendConfig object.
 */
export async function resolveBackendConfig(options: BackendConfig): Promise<FileSystem> {
	if (typeof options !== 'object' || options == null) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid options on configuration object.');
	}

	let { backend } = options;
	if (!backend) {
		throw new ApiError(ErrorCode.EPERM, 'Missing backend');
	}

	const props = Object.keys(options).filter(k => k != 'backend');

	for (const prop of props) {
		let option = options[prop];

		if (isBackend(option)) {
			option = { backend: option };
		}

		if (isBackendConfig(option)) {
			options[prop] = await resolveBackendConfig(option);
		}
	}

	if (typeof backend == 'string') {
		if (!Object.hasOwn(backends, backend)) {
			throw new ApiError(ErrorCode.EINVAL, 'Unknown backend: ' + backend);
		}

		backend = backends[backend];
	}

	if (!backend.isAvailable()) {
		throw new ApiError(ErrorCode.EPERM, 'Backend not available: ' + backend);
	}
	checkOptions(backend, options);
	const fs = backend.create(options);
	await fs.ready();
	return fs;
}

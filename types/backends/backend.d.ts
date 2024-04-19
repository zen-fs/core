import { FileSystem } from '../filesystem';
import { type RequiredKeys } from '../utils';
type OptionType = 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function';
/**
 * Resolves the type of Backend.options from the options interface
 */
type OptionsConfig<T> = {
    [K in keyof T]: {
        /**
         * The basic JavaScript type(s) for this option.
         */
        type: OptionType | readonly OptionType[];
        /**
         * Description of the option. Used in error messages and documentation.
         */
        description: string;
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
 * A backend
 */
export interface Backend<FS extends FileSystem = FileSystem, TOptions extends object = object> {
    /**
     * Create a new instance of the backend
     */
    create(options: TOptions): FS;
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
     * Sync:
     * Returns 'true' if this backend is available in the current
     * environment. For example, a `localStorage`-backed filesystem will return
     * 'false' if the browser does not support that API.
     *
     * Defaults to 'false', as the FileSystem base class isn't usable alone.
     */
    isAvailable(): boolean | Promise<boolean>;
}
/**
 * @internal
 */
export declare function isBackend(arg: unknown): arg is Backend;
/**
 * Checks that the given options object is valid for the file system options.
 * @internal
 */
export declare function checkOptions<T extends Backend>(backend: T, opts: object): Promise<void>;
export declare function createBackend<B extends Backend>(backend: B, options?: object): Promise<ReturnType<B['create']>>;
/**
 * Specifies a file system backend type and its options.
 *
 * Individual options can recursively contain BackendConfig objects for
 * option values that require file systems.
 *
 * The option object for each file system corresponds to that file system's option object passed to its `Create()` method.
 */
export type BackendConfiguration<FS extends FileSystem = FileSystem, TOptions extends object = object> = TOptions & {
    backend: Backend<FS, TOptions>;
};
/**
 * @internal
 */
export declare function isBackendConfig(arg: unknown): arg is BackendConfiguration;
export {};

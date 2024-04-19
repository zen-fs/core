import type { Backend, BackendConfiguration } from './backends/backend';
import { FileSystem } from './filesystem';
/**
 * Configuration for a specific mount point
 */
export type MountConfiguration<FS extends FileSystem = FileSystem, TOptions extends object = object> = FS | BackendConfiguration<FS, TOptions> | Backend<FS, TOptions>;
/**
 * Retrieve a file system with the given configuration.
 * @param config A BackendConfig object.
 */
export declare function resolveMountConfig<FS extends FileSystem, TOptions extends object = object>(config: MountConfiguration<FS, TOptions>, _depth?: number): Promise<FS>;
/**
 *A mapping of mount points to their configurations
 */
export type MappingConfiguration = Partial<{
    uid: number;
    gid: number;
}> & Record<string, FileSystem | BackendConfiguration | Backend>;
/**
 * Configuration for the file systems
 */
export type Configuration = MountConfiguration | MappingConfiguration;
/**
 * Creates filesystems with the given configuration, and initializes ZenFS with it.
 * @see Configuration for more info on the configuration object.
 */
export declare function configure(config: Configuration): Promise<void>;

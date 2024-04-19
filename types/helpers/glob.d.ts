/**
 * Synchronous, recursive function to list files matching a glob pattern in a directory and its subdirectories using minimatch.
 * @param dirPath Directory to search within
 * @param pattern Glob pattern to match filenames (e.g., '*.txt')
 * @returns Array of matching filenames, including path relative to the initial directory
 */
export declare function globSync(dirPath: string, pattern: string): string[];

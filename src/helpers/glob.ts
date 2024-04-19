import { join } from '../emulation/path';
import { minimatch } from 'minimatch';
import { readdirSync } from '../process/os_sync'

/**
 * Synchronous, recursive function to list files matching a glob pattern in a directory and its subdirectories using minimatch.
 * @param dirPath Directory to search within
 * @param pattern Glob pattern to match filenames (e.g., '*.txt')
 * @returns Array of matching filenames, including path relative to the initial directory
 */
export function globSync(dirPath: string, pattern: string): string[] {
  let results: string[] = [];

  function recurse(currentPath) {
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (let entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        recurse(fullPath); // Recursively search in subdirectory
      } else if (minimatch(entry.name, pattern)) {
        results.push(fullPath); // Add file to results if it matches the pattern
      }
    }
  }

  try {
    recurse(dirPath); // Start the recursion from the initial directory path
    return results;
  } catch (err) {
    console.error('Error:', err);
    return []; // Return an empty array in case of an error
  }
}

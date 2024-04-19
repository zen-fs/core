import { join } from '../emulation/path';
import { existsSync, mkdirSync } from '../process/os_sync'

/**
 * Synchronously creates a directory and all necessary parent directories.
 * @param dirPath The path of the directory to create.
 */
export function mkdirpSync(dirPath: string) {
  const parentPath = join(dirPath, '..');  // Get the parent directory

  if (!existsSync(parentPath)) {
    mkdirpSync(parentPath);  // Recursively ensure parent directories exist
  }

  if (!existsSync(dirPath)) {
    mkdirSync(dirPath);  // Create the directory if it does not exist
  }
}


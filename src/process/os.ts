import { getActiveProcess, getProcessPath, writeState } from "./process";
import { resolve } from '../emulation/path';
// Function to get the current working directory of the active process
export function cwd() {
  const activeProcess = getActiveProcess();
  return activeProcess.cwd;
}

// Function to change the current working directory of the active process
export function chdir(newPath): void {
  const newCwd = resolve(cwd(), newPath);
  const activeProcess = getActiveProcess();
  const processPath = getProcessPath(activeProcess.pid);
  activeProcess.cwd = newCwd;
  writeState(processPath, activeProcess); // Save updated state
}

export function cd(newPath): void {
  chdir(newPath);
}

// Function to print the current working directory (similar to Unix/Linux `pwd`)
export function pwd() {
  return cwd(); // Simply returns the result of cwd()
}

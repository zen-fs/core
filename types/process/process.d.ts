export declare function initialize(): void;
export declare function initializeRootProcess(): void;
export declare function createProcess({ title, pid, cwd }?: {
    title: any;
    pid: any;
    cwd?: string;
}): any;
export declare function getProcessPath(pid: any): string;
export declare function getActiveProcessPath(): string;
export declare function writeState(processPath: any, state: any): void;
export declare function getActiveProcess(): any;
export declare function readState(processPath: any): any;
export declare function getActiveProcessId(): string;
export declare const setActiveProcess: (pid: string) => string[];
export declare function kill(...args: any[]): void;
export declare const detach: () => string[];
export declare const spawn: () => any;

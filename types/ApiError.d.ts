/// <reference types="node" />
/**
 * Standard libc error codes. More will be added to this enum and ErrorStrings as they are
 * needed.
 * @url http://www.gnu.org/software/libc/manual/html_node/Error-Codes.html
 */
export declare enum ErrorCode {
    /**
     * Operation not permitted
     */
    EPERM = 1,
    /**
     * No such file or directory
     */
    ENOENT = 2,
    /**
     * Input/output error
     */
    EIO = 5,
    /**
     * Bad file descriptor
     */
    EBADF = 9,
    /**
     * Permission denied
     */
    EACCES = 13,
    /**
     * Resource busy or locked
     */
    EBUSY = 16,
    /**
     * File exists
     */
    EEXIST = 17,
    /**
     * File is not a directory
     */
    ENOTDIR = 20,
    /**
     * File is a directory
     */
    EISDIR = 21,
    /**
     * Invalid argument
     */
    EINVAL = 22,
    /**
     * File is too big
     */
    EFBIG = 27,
    /**
     * No space left on disk
     */
    ENOSPC = 28,
    /**
     * Cannot modify a read-only file system
     */
    EROFS = 30,
    /**
     * Resource deadlock would occur
     */
    EDEADLK = 35,
    /**
     * Directory is not empty
     */
    ENOTEMPTY = 39,
    /**
     * Operation is not supported
     */
    ENOTSUP = 95
}
/**
 * Strings associated with each error code.
 * @internal
 */
export declare const ErrorStrings: {
    [code in ErrorCode]: string;
};
interface ApiErrorJSON {
    errno: ErrorCode;
    message: string;
    path?: string;
    code: string;
    stack: string;
    syscall: string;
}
/**
 * Represents a ZenFS error. Passed back to applications after a failed
 * call to the ZenFS API.
 */
export declare class ApiError extends Error implements NodeJS.ErrnoException {
    errno: ErrorCode;
    path?: string;
    syscall: string;
    static fromJSON(json: ApiErrorJSON): ApiError;
    static With(code: string, path: string, syscall?: string): ApiError;
    code: string;
    /**
     * Represents a ZenFS error. Passed back to applications after a failed
     * call to the ZenFS API.
     *
     * Error codes mirror those returned by regular Unix file operations, which is
     * what Node returns.
     * @constructor ApiError
     * @param type The type of the error.
     * @param message A descriptive error message.
     */
    constructor(errno: ErrorCode, message?: string, path?: string, syscall?: string);
    /**
     * @return A friendly error message.
     */
    toString(): string;
    toJSON(): ApiErrorJSON;
    /**
     * The size of the API error in buffer-form in bytes.
     */
    bufferSize(): number;
}
export {};

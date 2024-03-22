/**
 * Standard libc error codes. More will be added to this enum and ErrorStrings as they are
 * needed.
 * @url http://www.gnu.org/software/libc/manual/html_node/Error-Codes.html
 */
export enum ErrorCode {
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
	 * Directory is not empty
	 */
	ENOTEMPTY = 39,
	/**
	 * Operation is not supported
	 */
	ENOTSUP = 95,
}

/**
 * Strings associated with each error code.
 * @internal
 */
export const ErrorStrings: { [code in ErrorCode]: string } = {
	[ErrorCode.EPERM]: 'Operation not permitted.',
	[ErrorCode.ENOENT]: 'No such file or directory.',
	[ErrorCode.EIO]: 'Input/output error.',
	[ErrorCode.EBADF]: 'Bad file descriptor.',
	[ErrorCode.EACCES]: 'Permission denied.',
	[ErrorCode.EBUSY]: 'Resource busy or locked.',
	[ErrorCode.EEXIST]: 'File exists.',
	[ErrorCode.ENOTDIR]: 'File is not a directory.',
	[ErrorCode.EISDIR]: 'File is a directory.',
	[ErrorCode.EINVAL]: 'Invalid argument.',
	[ErrorCode.EFBIG]: 'File is too big.',
	[ErrorCode.ENOSPC]: 'No space left on disk.',
	[ErrorCode.EROFS]: 'Cannot modify a read-only file system.',
	[ErrorCode.ENOTEMPTY]: 'Directory is not empty.',
	[ErrorCode.ENOTSUP]: 'Operation is not supported.',
};

interface ApiErrorJSON {
	errno: ErrorCode;
	message: string;
	path: string;
	code: string;
	stack: string;
}

/**
 * Represents a ZenFS error. Passed back to applications after a failed
 * call to the ZenFS API.
 */
export class ApiError extends Error implements NodeJS.ErrnoException {
	public static fromJSON(json: ApiErrorJSON): ApiError {
		const err = new ApiError(json.errno, json.message, json.path);
		err.code = json.code;
		err.stack = json.stack;
		return err;
	}

	public static OnPath(code: ErrorCode, path: string): ApiError {
		return new ApiError(code, ErrorStrings[code], path);
	}

	public static EACCES(path: string): ApiError {
		return this.OnPath(ErrorCode.EACCES, path);
	}

	public static ENOENT(path: string): ApiError {
		return this.OnPath(ErrorCode.ENOENT, path);
	}

	public static EEXIST(path: string): ApiError {
		return this.OnPath(ErrorCode.EEXIST, path);
	}

	public static EISDIR(path: string): ApiError {
		return this.OnPath(ErrorCode.EISDIR, path);
	}

	public static ENOTDIR(path: string): ApiError {
		return this.OnPath(ErrorCode.ENOTDIR, path);
	}

	public static EPERM(path: string): ApiError {
		return this.OnPath(ErrorCode.EPERM, path);
	}

	public static ENOTEMPTY(path: string): ApiError {
		return this.OnPath(ErrorCode.ENOTEMPTY, path);
	}

	public code: string;

	// Unsupported.
	public syscall: string = '';
	public stack?: string;

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
	constructor(public errno: ErrorCode, message: string = ErrorStrings[errno], public path?: string) {
		super(message);
		this.code = ErrorCode[errno];
		this.message = `${this.code}: ${message}${this.path ? `, '${this.path}'` : ''}`;
	}

	/**
	 * @return A friendly error message.
	 */
	public toString(): string {
		return this.message;
	}

	public toJSON(): ApiErrorJSON {
		return {
			errno: this.errno,
			code: this.code,
			path: this.path,
			stack: this.stack,
			message: this.message,
		};
	}

	/**
	 * The size of the API error in buffer-form in bytes.
	 */
	public bufferSize(): number {
		// 4 bytes for string length.
		return 4 + JSON.stringify(this.toJSON()).length;
	}
}

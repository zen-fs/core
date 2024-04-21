/**
 * Standard libc error codes. More will be added to this enum and ErrorStrings as they are
 * needed.
 * @url https://en.wikipedia.org/wiki/Errno.h
 */
export enum ErrorCode {
	/** Operation not permitted */
	EPERM = 1,
	/** No such file or directory */
	ENOENT = 2,
	/** Interrupted system call */
	EINTR = 4,
	/** Input/output error */
	EIO = 5,
	/** No such device or address */
	ENXIO = 6,
	/** Bad file descriptor */
	EBADF = 9,
	/** Resource temporarily unavailable */
	EAGAIN = 11,
	/** Cannot allocate memory */
	ENOMEM = 12,
	/** Permission denied */
	EACCES = 13,
	/** Bad address */
	EFAULT = 14,
	/** Block device required */
	ENOTBLK = 15,
	/** Resource busy or locked */
	EBUSY = 16,
	/** File exists */
	EEXIST = 17,
	/** Invalid cross-device link */
	EXDEV = 18,
	/** No such device */
	ENODEV = 19,
	/** File is not a directory */
	ENOTDIR = 20,
	/** File is a directory */
	EISDIR = 21,
	/** Invalid argument */
	EINVAL = 22,
	/** Too many open files in system */
	ENFILE = 23,
	/** Too many open files */
	EMFILE = 24,
	/** Text file busy */
	ETXTBSY = 26,
	/** File is too big */
	EFBIG = 27,
	/** No space left on disk */
	ENOSPC = 28,
	/** Illegal seek */
	ESPIPE = 29,
	/** Cannot modify a read-only file system */
	EROFS = 30,
	/** Too many links */
	EMLINK = 31,
	/** Broken pipe */
	EPIPE = 32,
	/** Numerical argument out of domain */
	EDOM = 33,
	/** Numerical result out of range */
	ERANGE = 34,
	/** Resource deadlock would occur */
	EDEADLK = 35,
	/** File name too long */
	ENAMETOOLONG = 36,
	/** No locks available */
	ENOLCK = 37,
	/** Function not implemented */
	ENOSYS = 38,
	/** Directory is not empty */
	ENOTEMPTY = 39,
	/** Too many levels of symbolic links */
	ELOOP = 40,
	/** No message of desired type */
	ENOMSG = 42,
	/** Invalid exchange */
	EBADE = 52,
	/** Invalid request descriptor */
	EBADR = 53,
	/** Exchange full */
	EXFULL = 54,
	/** No anode */
	ENOANO = 55,
	/** Invalid request code */
	EBADRQC = 56,
	/** Device not a stream */
	ENOSTR = 60,
	/** No data available */
	ENODATA = 61,
	/** Timer expired */
	ETIME = 62,
	/** Out of streams resources */
	ENOSR = 63,
	/** Machine is not on the network */
	ENONET = 64,
	/** Object is remote */
	EREMOTE = 66,
	/** Link has been severed */
	ENOLINK = 67,
	/** Communication error on send */
	ECOMM = 70,
	/** Protocol error */
	EPROTO = 71,
	/** Bad message */
	EBADMSG = 74,
	/** Value too large for defined data type */
	EOVERFLOW = 75,
	/** File descriptor in bad state */
	EBADFD = 77,
	/** Streams pipe error */
	ESTRPIPE = 86,
	/** Socket operation on non-socket */
	ENOTSOCK = 88,
	/** Destination address required */
	EDESTADDRREQ = 89,
	/** Message too long */
	EMSGSIZE = 90,
	/** Protocol wrong type for socket */
	EPROTOTYPE = 91,
	/** Protocol not available */
	ENOPROTOOPT = 92,
	/** Protocol not supported */
	EPROTONOSUPPORT = 93,
	/** Socket type not supported */
	ESOCKTNOSUPPORT = 94,
	/** Operation is not supported */
	ENOTSUP = 95,
	/** Network is down */
	ENETDOWN = 100,
	/** Network is unreachable */
	ENETUNREACH = 101,
	/** Network dropped connection on reset */
	ENETRESET = 102,
	/** Connection timed out */
	ETIMEDOUT = 110,
	/** Connection refused */
	ECONNREFUSED = 111,
	/** Host is down */
	EHOSTDOWN = 112,
	/** No route to host */
	EHOSTUNREACH = 113,
	/** Operation already in progress */
	EALREADY = 114,
	/** Operation now in progress */
	EINPROGRESS = 115,
	/** Stale file handle */
	ESTALE = 116,
	/** Remote I/O error */
	EREMOTEIO = 121,
	/** Disk quota exceeded */
	EDQUOT = 122,
}
/**
 * Strings associated with each error code.
 * @internal
 */
export const errorMessages: { [K in ErrorCode]: string } = {
	[ErrorCode.EPERM]: 'Operation not permitted',
	[ErrorCode.ENOENT]: 'No such file or directory',
	[ErrorCode.EINTR]: 'Interrupted system call',
	[ErrorCode.EIO]: 'Input/output error',
	[ErrorCode.ENXIO]: 'No such device or address',
	[ErrorCode.EBADF]: 'Bad file descriptor',
	[ErrorCode.EAGAIN]: 'Resource temporarily unavailable',
	[ErrorCode.ENOMEM]: 'Cannot allocate memory',
	[ErrorCode.EACCES]: 'Permission denied',
	[ErrorCode.EFAULT]: 'Bad address',
	[ErrorCode.ENOTBLK]: 'Block device required',
	[ErrorCode.EBUSY]: 'Resource busy or locked',
	[ErrorCode.EEXIST]: 'File exists',
	[ErrorCode.EXDEV]: 'Invalid cross-device link',
	[ErrorCode.ENODEV]: 'No such device',
	[ErrorCode.ENOTDIR]: 'File is not a directory',
	[ErrorCode.EISDIR]: 'File is a directory',
	[ErrorCode.EINVAL]: 'Invalid argument',
	[ErrorCode.ENFILE]: 'Too many open files in system',
	[ErrorCode.EMFILE]: 'Too many open files',
	[ErrorCode.ETXTBSY]: 'Text file busy',
	[ErrorCode.EFBIG]: 'File is too big',
	[ErrorCode.ENOSPC]: 'No space left on disk',
	[ErrorCode.ESPIPE]: 'Illegal seek',
	[ErrorCode.EROFS]: 'Cannot modify a read-only file system',
	[ErrorCode.EMLINK]: 'Too many links',
	[ErrorCode.EPIPE]: 'Broken pipe',
	[ErrorCode.EDOM]: 'Numerical argument out of domain',
	[ErrorCode.ERANGE]: 'Numerical result out of range',
	[ErrorCode.EDEADLK]: 'Resource deadlock would occur',
	[ErrorCode.ENAMETOOLONG]: 'File name too long',
	[ErrorCode.ENOLCK]: 'No locks available',
	[ErrorCode.ENOSYS]: 'Function not implemented',
	[ErrorCode.ENOTEMPTY]: 'Directory is not empty',
	[ErrorCode.ELOOP]: 'Too many levels of symbolic links',
	[ErrorCode.ENOMSG]: 'No message of desired type',
	[ErrorCode.EBADE]: 'Invalid exchange',
	[ErrorCode.EBADR]: 'Invalid request descriptor',
	[ErrorCode.EXFULL]: 'Exchange full',
	[ErrorCode.ENOANO]: 'No anode',
	[ErrorCode.EBADRQC]: 'Invalid request code',
	[ErrorCode.ENOSTR]: 'Device not a stream',
	[ErrorCode.ENODATA]: 'No data available',
	[ErrorCode.ETIME]: 'Timer expired',
	[ErrorCode.ENOSR]: 'Out of streams resources',
	[ErrorCode.ENONET]: 'Machine is not on the network',
	[ErrorCode.EREMOTE]: 'Object is remote',
	[ErrorCode.ENOLINK]: 'Link has been severed',
	[ErrorCode.ECOMM]: 'Communication error on send',
	[ErrorCode.EPROTO]: 'Protocol error',
	[ErrorCode.EBADMSG]: 'Bad message',
	[ErrorCode.EOVERFLOW]: 'Value too large for defined data type',
	[ErrorCode.EBADFD]: 'File descriptor in bad state',
	[ErrorCode.ESTRPIPE]: 'Streams pipe error',
	[ErrorCode.ENOTSOCK]: 'Socket operation on non-socket',
	[ErrorCode.EDESTADDRREQ]: 'Destination address required',
	[ErrorCode.EMSGSIZE]: 'Message too long',
	[ErrorCode.EPROTOTYPE]: 'Protocol wrong type for socket',
	[ErrorCode.ENOPROTOOPT]: 'Protocol not available',
	[ErrorCode.EPROTONOSUPPORT]: 'Protocol not supported',
	[ErrorCode.ESOCKTNOSUPPORT]: 'Socket type not supported',
	[ErrorCode.ENOTSUP]: 'Operation is not supported',
	[ErrorCode.ENETDOWN]: 'Network is down',
	[ErrorCode.ENETUNREACH]: 'Network is unreachable',
	[ErrorCode.ENETRESET]: 'Network dropped connection on reset',
	[ErrorCode.ETIMEDOUT]: 'Connection timed out',
	[ErrorCode.ECONNREFUSED]: 'Connection refused',
	[ErrorCode.EHOSTDOWN]: 'Host is down',
	[ErrorCode.EHOSTUNREACH]: 'No route to host',
	[ErrorCode.EALREADY]: 'Operation already in progress',
	[ErrorCode.EINPROGRESS]: 'Operation now in progress',
	[ErrorCode.ESTALE]: 'Stale file handle',
	[ErrorCode.EREMOTEIO]: 'Remote I/O error',
	[ErrorCode.EDQUOT]: 'Disk quota exceeded',
};

interface ApiErrorJSON {
	errno: ErrorCode;
	message: string;
	path?: string;
	code: keyof typeof ErrorCode;
	stack: string;
	syscall: string;
}

/**
 * Represents a ZenFS error. Passed back to applications after a failed
 * call to the ZenFS API.
 */
export class ApiError extends Error implements NodeJS.ErrnoException {
	public static fromJSON(json: ApiErrorJSON): ApiError {
		const err = new ApiError(json.errno, json.message, json.path, json.syscall);
		err.code = json.code;
		err.stack = json.stack;
		return err;
	}

	public static With(code: keyof typeof ErrorCode, path: string, syscall?: string): ApiError {
		return new ApiError(ErrorCode[code], errorMessages[ErrorCode[code]], path, syscall);
	}

	public code: keyof typeof ErrorCode;

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
	constructor(
		public errno: ErrorCode,
		message: string = errorMessages[errno],
		public path?: string,
		public syscall: string = ''
	) {
		super(message);
		this.code = <keyof typeof ErrorCode>ErrorCode[errno];
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
			syscall: this.syscall,
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

/**
 * Standard libc error codes. More will be added to this enum and error strings as they are
 * needed.
 * @url https://en.wikipedia.org/wiki/Errno.h
 */
export enum Errno {
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
export const errorMessages: { [K in Errno]: string } = {
	[Errno.EPERM]: 'Operation not permitted',
	[Errno.ENOENT]: 'No such file or directory',
	[Errno.EINTR]: 'Interrupted system call',
	[Errno.EIO]: 'Input/output error',
	[Errno.ENXIO]: 'No such device or address',
	[Errno.EBADF]: 'Bad file descriptor',
	[Errno.EAGAIN]: 'Resource temporarily unavailable',
	[Errno.ENOMEM]: 'Cannot allocate memory',
	[Errno.EACCES]: 'Permission denied',
	[Errno.EFAULT]: 'Bad address',
	[Errno.ENOTBLK]: 'Block device required',
	[Errno.EBUSY]: 'Resource busy or locked',
	[Errno.EEXIST]: 'File exists',
	[Errno.EXDEV]: 'Invalid cross-device link',
	[Errno.ENODEV]: 'No such device',
	[Errno.ENOTDIR]: 'File is not a directory',
	[Errno.EISDIR]: 'File is a directory',
	[Errno.EINVAL]: 'Invalid argument',
	[Errno.ENFILE]: 'Too many open files in system',
	[Errno.EMFILE]: 'Too many open files',
	[Errno.ETXTBSY]: 'Text file busy',
	[Errno.EFBIG]: 'File is too big',
	[Errno.ENOSPC]: 'No space left on disk',
	[Errno.ESPIPE]: 'Illegal seek',
	[Errno.EROFS]: 'Cannot modify a read-only file system',
	[Errno.EMLINK]: 'Too many links',
	[Errno.EPIPE]: 'Broken pipe',
	[Errno.EDOM]: 'Numerical argument out of domain',
	[Errno.ERANGE]: 'Numerical result out of range',
	[Errno.EDEADLK]: 'Resource deadlock would occur',
	[Errno.ENAMETOOLONG]: 'File name too long',
	[Errno.ENOLCK]: 'No locks available',
	[Errno.ENOSYS]: 'Function not implemented',
	[Errno.ENOTEMPTY]: 'Directory is not empty',
	[Errno.ELOOP]: 'Too many levels of symbolic links',
	[Errno.ENOMSG]: 'No message of desired type',
	[Errno.EBADE]: 'Invalid exchange',
	[Errno.EBADR]: 'Invalid request descriptor',
	[Errno.EXFULL]: 'Exchange full',
	[Errno.ENOANO]: 'No anode',
	[Errno.EBADRQC]: 'Invalid request code',
	[Errno.ENOSTR]: 'Device not a stream',
	[Errno.ENODATA]: 'No data available',
	[Errno.ETIME]: 'Timer expired',
	[Errno.ENOSR]: 'Out of streams resources',
	[Errno.ENONET]: 'Machine is not on the network',
	[Errno.EREMOTE]: 'Object is remote',
	[Errno.ENOLINK]: 'Link has been severed',
	[Errno.ECOMM]: 'Communication error on send',
	[Errno.EPROTO]: 'Protocol error',
	[Errno.EBADMSG]: 'Bad message',
	[Errno.EOVERFLOW]: 'Value too large for defined data type',
	[Errno.EBADFD]: 'File descriptor in bad state',
	[Errno.ESTRPIPE]: 'Streams pipe error',
	[Errno.ENOTSOCK]: 'Socket operation on non-socket',
	[Errno.EDESTADDRREQ]: 'Destination address required',
	[Errno.EMSGSIZE]: 'Message too long',
	[Errno.EPROTOTYPE]: 'Protocol wrong type for socket',
	[Errno.ENOPROTOOPT]: 'Protocol not available',
	[Errno.EPROTONOSUPPORT]: 'Protocol not supported',
	[Errno.ESOCKTNOSUPPORT]: 'Socket type not supported',
	[Errno.ENOTSUP]: 'Operation is not supported',
	[Errno.ENETDOWN]: 'Network is down',
	[Errno.ENETUNREACH]: 'Network is unreachable',
	[Errno.ENETRESET]: 'Network dropped connection on reset',
	[Errno.ETIMEDOUT]: 'Connection timed out',
	[Errno.ECONNREFUSED]: 'Connection refused',
	[Errno.EHOSTDOWN]: 'Host is down',
	[Errno.EHOSTUNREACH]: 'No route to host',
	[Errno.EALREADY]: 'Operation already in progress',
	[Errno.EINPROGRESS]: 'Operation now in progress',
	[Errno.ESTALE]: 'Stale file handle',
	[Errno.EREMOTEIO]: 'Remote I/O error',
	[Errno.EDQUOT]: 'Disk quota exceeded',
};

export interface ErrnoErrorJSON {
	errno: Errno;
	message: string;
	path?: string;
	code: keyof typeof Errno;
	stack: string;
	syscall: string;
}

/**
 * Represents a ZenFS error. Passed back to applications after a failed
 * call to the ZenFS API.
 */
export class ErrnoError extends Error implements NodeJS.ErrnoException {
	public static fromJSON(json: ErrnoErrorJSON): ErrnoError {
		const err = new ErrnoError(json.errno, json.message, json.path, json.syscall);
		err.code = json.code;
		err.stack = json.stack;
		return err;
	}

	public static With(code: keyof typeof Errno, path?: string, syscall?: string): ErrnoError {
		return new ErrnoError(Errno[code], errorMessages[Errno[code]], path, syscall);
	}

	public code: keyof typeof Errno;

	public declare stack: string;

	/**
	 * Represents a ZenFS error. Passed back to applications after a failed
	 * call to the ZenFS API.
	 *
	 * Error codes mirror those returned by regular Unix file operations, which is
	 * what Node returns.
	 * @param type The type of the error.
	 * @param message A descriptive error message.
	 */
	constructor(
		public errno: Errno,
		message: string = errorMessages[errno],
		public path?: string,
		public syscall: string = ''
	) {
		super(message);
		this.code = <keyof typeof Errno>Errno[errno];
		this.message = `${this.code}: ${message}${this.path ? `, '${this.path}'` : ''}`;
	}

	/**
	 * @return A friendly error message.
	 */
	public toString(): string {
		return this.message;
	}

	public toJSON(): ErrnoErrorJSON {
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

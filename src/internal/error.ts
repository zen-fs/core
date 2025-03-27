import { Errno, ErrnoException, type ErrnoExceptionJSON } from 'kerium';

/**
 * @category Internals
 */
export interface ErrnoErrorJSON extends ErrnoExceptionJSON {
	path?: string;
}

/**
 * An error with additional information about what happened
 * @category Internals
 */
export class ErrnoError extends ErrnoException {
	public static fromJSON(this: void, json: ErrnoErrorJSON): ErrnoError {
		const err = new ErrnoError(json.errno, json.message, json.path, json.syscall);
		err.code = json.code;
		err.stack = json.stack;
		Error.captureStackTrace?.(err, ErrnoError.fromJSON);
		return err;
	}

	public static With(this: void, code: keyof typeof Errno, path?: string, syscall?: string): ErrnoError {
		const err = new ErrnoError(Errno[code], undefined, path, syscall);
		Error.captureStackTrace?.(err, ErrnoError.With);
		return err;
	}

	public constructor(
		errno: Errno,
		message?: string,
		public path?: string,
		syscall?: string
	) {
		super(errno, message, syscall);
		Error.captureStackTrace?.(this, this.constructor);
	}

	public toString(): string {
		return super.toString() + (this.path ? `, '${this.path}'` : '');
	}

	public toJSON(): ErrnoErrorJSON {
		return {
			...super.toJSON(),
			path: this.path,
		};
	}
}

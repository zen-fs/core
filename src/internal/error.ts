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
export class ErrnoError extends ErrnoException implements NodeJS.ErrnoException {
	public static fromJSON(json: ErrnoErrorJSON): ErrnoError {
		const err = new ErrnoError(json.errno, json.message, json.path, json.syscall);
		err.code = json.code;
		err.stack = json.stack;
		return err;
	}

	public static With(code: keyof typeof Errno, path?: string, syscall?: string): ErrnoError {
		return new ErrnoError(Errno[code], undefined, path, syscall);
	}

	public constructor(
		errno: Errno,
		message?: string,
		public path?: string,
		syscall?: string
	) {
		super(errno, message, syscall);
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

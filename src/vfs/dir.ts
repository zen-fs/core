/**
 * @see `DT_*` in `dirent.h`
 */
export enum DirType {
	UNKNOWN = 0,
	FIFO = 1,
	CHR = 2,
	DIR = 4,
	BLK = 6,
	REG = 8,
	LNK = 10,
	SOCK = 12,
	WHT = 14,
}

/**
 * Converts a file mode to a directory type.
 * @see `IFTODT` in `dirent.h`
 */
export function ifToDt(mode: number): DirType {
	return ((mode & 0o170000) >> 12) as DirType;
}

/**
 * Converts a directory type to a file mode.
 * @see `DTTOIF` in `dirent.h`
 */
export function dtToIf(dt: DirType): number {
	return dt << 12;
}

export class Dirent {
	ino!: number;
	type!: DirType;
	path!: string;
	name!: string;
}

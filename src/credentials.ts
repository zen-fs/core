/**
 * Credentials used for various operations.
 * Similar to Linux's cred struct.
 * @see https://github.com/torvalds/linux/blob/master/include/linux/cred.h
 */
export interface Credentials {
	uid: number;
	gid: number;
	suid: number;
	sgid: number;
	euid: number;
	egid: number;
}

export const credentials: Credentials = {
	uid: 0,
	gid: 0,
	suid: 0,
	sgid: 0,
	euid: 0,
	egid: 0,
};

export const rootCredentials: Credentials = {
	uid: 0,
	gid: 0,
	suid: 0,
	sgid: 0,
	euid: 0,
	egid: 0,
};

/**
 * Credentials used for various operations.
 * Similar to Linux's cred struct. See https://github.com/torvalds/linux/blob/master/include/linux/cred.h
 */
export interface Cred {
	uid: number;
	gid: number;
	suid: number;
	sgid: number;
	euid: number;
	egid: number;
}

export const rootCred: Cred = {
	uid: 0,
	gid: 0,
	suid: 0,
	sgid: 0,
	euid: 0,
	egid: 0,
};

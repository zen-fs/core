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
	/**
	 * List of group IDs.
	 */
	groups: number[];
}

export const credentials: Credentials = {
	uid: 0,
	gid: 0,
	suid: 0,
	sgid: 0,
	euid: 0,
	egid: 0,
	groups: [],
};

export interface CredentialInit {
	uid: number;
	gid: number;
	suid?: number;
	sgid?: number;
	euid?: number;
	egid?: number;
	groups?: number[];
}

export function createCredentials(source: CredentialInit): Credentials {
	return {
		suid: source.uid,
		sgid: source.gid,
		euid: source.uid,
		egid: source.gid,
		groups: [],
		...source,
	};
}

/**
 * Uses credentials from the provided uid and gid.
 */
export function useCredentials(source: CredentialInit): void {
	Object.assign(credentials, createCredentials(source));
}

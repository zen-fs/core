/**
 * Credentials used for various operations.
 * Similar to Linux's cred struct.
 * @category Internals
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

/**
 * Initialization for a set of credentials
 * @category Internals
 */
export interface CredentialsInit extends Partial<Credentials> {
	uid: number;
	gid: number;
}

/**
 * @category Internals
 */
export function createCredentials(source: CredentialsInit): Credentials {
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
 * Returns true if the credentials can be used for an operation that requires root privileges.
 * @internal
 * @category Internals
 */
export function credentialsAllowRoot(cred?: Credentials): boolean {
	if (!cred) return false;
	return !cred.uid || !cred.gid || !cred.euid || !cred.egid || cred.groups.some(gid => !gid);
}

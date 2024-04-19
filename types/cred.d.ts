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
export declare const rootCred: Cred;

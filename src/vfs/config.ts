// SPDX-License-Identifier: LGPL-3.0-or-later
/** Whether to perform access checks */
export let checkAccess: boolean = true;

/** If set, path resolution will always do a full walk. More correct but potentially very slow. */
export let resolveFullWalk: boolean = false;

/**
 * @internal @hidden
 */
export interface _VFSConfig {
	checkAccess: boolean;
	resolveFullWalk: boolean;
}

/**
 * @internal @hidden
 */
export function _setVFSConfig(cfg: _VFSConfig): void {
	checkAccess = cfg.checkAccess;
	resolveFullWalk = cfg.resolveFullWalk;
}

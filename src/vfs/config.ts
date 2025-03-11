/** Whether to perform access checks */
export let checkAccess: boolean = true;

/**
 * @internal @hidden
 */
export function _setAccessChecks(value: boolean): void {
	checkAccess = value;
}

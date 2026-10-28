/**
 * Runs the `@zenfs/devel` version of a script instead of this deprecated one, if `@zenfs/devel` is installed.
 * @param {string} name
 */
export async function useDevel(name) {
	let path;
	try {
		path = import.meta.resolve('@zenfs/devel/bin/' + name);
	} catch {
		console.warn(`Warning: ${name} has moved to @zenfs/devel and will be removed from @zenfs/core in 3.0`);
		return;
	}

	await import(path);
	process.exit();
}

export const config = {
	/**
	 * Whether to perform access checks
	 */
	checkAccess: true,

	/**
	 * Whether to sync atime updates immediately when reading from a file
	 */
	updateOnRead: true,

	/**
	 * If a file's buffer is not large enough to store content when writing and the buffer can't be resized, reuse the buffer passed to write()
	 */
	unsafeBufferReplace: false,
};

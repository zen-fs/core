import * as log from '../dist/internal/log.js';

export function setupLogs(prefix) {
	const { ZENFS_LOG_LEVEL } = process.env;

	let level = log.Level.CRIT;

	if (ZENFS_LOG_LEVEL) {
		const tmp = parseInt(ZENFS_LOG_LEVEL);
		if (Number.isSafeInteger(tmp)) level = tmp;
		else level = ZENFS_LOG_LEVEL;
	}

	log.configure({
		enabled: true,
		format: log.fancy({ style: 'ansi', colorize: 'message' }),
		dumpBacklog: true,
		level,
		stack: true,
		output: (...msg) => (prefix ? console.error(prefix, ...msg) : console.error(...msg)),
	});
}

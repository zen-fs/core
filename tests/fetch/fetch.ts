import { configure, Fetch } from '../../dist/index.js';
import { baseUrl } from './config.js';
import * as log from '../../dist/log.js';

await configure({
	mounts: {
		'/': {
			backend: Fetch,
			baseUrl,
			index: baseUrl + '/.index.json',
		},
	},
	log: {
		enabled: true,
		output: console.error,
		format(entry) {
			const time = (entry.elapsedMs / 1000).toFixed(3).padStart(10);
			const levelColor = entry.level < log.Level.WARN ? 31 : entry.level > log.Level.WARN ? 36 : 33;
			const level = `\x1b[1;${levelColor}m${log.levels[entry.level].toUpperCase()}\x1b[0m`;
			return `[${time}] ${level} ${entry.message}`;
		},
		level: log.Level.INFO,
		dumpBacklog: true,
	},
});

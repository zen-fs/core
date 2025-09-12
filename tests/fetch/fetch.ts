import { configure, Fetch } from '@zenfs/core';
import { log } from 'kerium';
import { baseUrl } from './config.js';

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
		format: log.fancy({ style: 'ansi', colorize: 'message' }),
		level: log.Level.INFO,
		dumpBacklog: true,
	},
});

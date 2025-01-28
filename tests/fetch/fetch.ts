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
		format: log._withColors('ansi'),
		level: log.Level.INFO,
		dumpBacklog: true,
	},
});

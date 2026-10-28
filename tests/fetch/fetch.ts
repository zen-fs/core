import { configure, Fetch } from '@zenfs/core';
import { log } from 'kerium';
import type { TestFlag, TestFlagState } from '@zenfs/devel/tests/common';
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

export const flags: Partial<Record<TestFlag, TestFlagState>> = {
	// `IndexFS` does not implement hard links
	links: false,
};

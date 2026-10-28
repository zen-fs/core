import { configure, Fetch } from '@zenfs/core';
import type { TestFlag, TestFlagState } from '@zenfs/devel/tests/common';
import { log } from 'kerium';
import { once } from 'node:events';
import { join } from 'node:path';
import { after } from 'node:test';
import { Worker } from 'node:worker_threads';

const server = new Worker(join(import.meta.dirname, '../backend/fetch.worker.js'));

after(() => server.terminate());

const [port] = await once(server, 'message');

const baseUrl = 'http://localhost:' + port;

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

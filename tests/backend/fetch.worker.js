import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { data } from '@zenfs/devel/tests/setup';
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';

const statusCodes = {
	ENOENT: 404,
};

const entries = {};
for (const path of ['', ...readdirSync(data, { recursive: true })]) entries['/' + path] = lstatSync(join(data, path));

const index = JSON.stringify({ version: 1, entries });

const server = createServer((request, response) => {
	response.statusCode = 200;
	const { url = '', method } = request;

	/**
	 * @todo Test POST/DELETE
	 */
	if (method != 'GET') {
		response.end();
		return;
	}

	if (url == '/.ping') {
		response.end('pong');
		return;
	}

	if (url == '/.index.json') {
		response.end(index);
		return;
	}

	const path = join(data, url.slice(1) || '');
	try {
		response.end(readFileSync(path));
	} catch (e) {
		response.statusCode = statusCodes[e.code] || 400;
		response.end();
	}
});

server.listen(0, () => parentPort.postMessage(server.address().port));

process.on('beforeExit', () => {
	server.close().unref();
});

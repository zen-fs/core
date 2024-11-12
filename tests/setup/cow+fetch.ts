import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { configureSingle, Fetch, InMemory, Overlay } from '../../dist/index.js';
import { data, tmp } from './common.js';

const port = 26514,
	index = tmp + '/index.json';

const statusCodes = {
	ENOENT: 404,
};

execSync(`npm exec make-index -- ${data} --output ${index} --quiet`, { stdio: 'inherit' });

const server = createServer((request, response) => {
	const path = request.url == '/.index.json' ? index : join(data, request.url?.slice(1) || '');
	try {
		response.statusCode = 200;
		response.end(readFileSync(path));
	} catch (e: any) {
		response.statusCode = statusCodes[e.code as keyof typeof statusCodes] || 400;
		response.end();
	}
});

server
	.once('error', (error: NodeJS.ErrnoException) => {
		if (error.code == 'EADDRINUSE') return;
		throw error;
	})
	.listen(port)
	.unref();

const baseUrl = 'http://localhost:' + port;

await configureSingle({
	backend: Overlay,
	readable: Fetch.create({
		baseUrl,
		index: baseUrl + '/.index.json',
	}),
	writable: InMemory.create({ name: 'cow' }),
});

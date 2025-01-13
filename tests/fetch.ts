import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { data, tmp } from './setup.js';

// If you change the port please update the setup file as well
const port = 26514;

const statusCodes = {
	ENOENT: 404,
};

try {
	execSync(`npm exec make-index -- ${data} --output ${tmp}/index.json --quiet`, { stdio: 'inherit' });
} catch (e: any) {
	if (e.signal == 'SIGINT') {
		console.log('Aborted whilst creating index.');
		process.exit(0);
	} else {
		console.error('Index creation failed: ' + e.message);
		process.exit(1);
	}
}

const server = createServer((request, response) => {
	const { url = '' } = request;

	if (url == '/.ping') {
		response.statusCode = 200;
		response.end('pong');
		return;
	}

	const path = url == '/.index.json' ? join(tmp, 'index.json') : join(data, url.slice(1) || '');
	try {
		response.statusCode = 200;
		response.end(readFileSync(path));
	} catch (e: any) {
		response.statusCode = statusCodes[e.code as keyof typeof statusCodes] || 400;
		response.end();
	}
});

server.listen(port);

process.on('beforeExit', () => {
	server.close().unref();
});

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { suite, test } from 'node:test';
import { wait } from 'utilium';
import { createInterface, Interface } from '../../dist/readline.js';

suite('Readline interface', { skip: true }, () => {
	test('creates interface with readable stream', async () => {
		const input = new PassThrough();
		await using rl = createInterface({ input });

		assert.ok(rl instanceof Interface);
		assert.equal(rl.input, input);
	});

	test('emits line events when receiving data', async () => {
		const input = new PassThrough();
		await using rl = createInterface({ input });

		const lines: string[] = [];
		rl.on('line', (line: string) => lines.push(line));

		input.write('first line\n');
		input.write('second line\r\n');
		input.write('third line\n');

		await wait(10);

		assert.deepEqual(lines, ['first line', 'second line', 'third line']);
	});

	test('handles partial lines correctly', async () => {
		const input = new PassThrough();
		await using rl = createInterface({ input });

		const lines: string[] = [];
		rl.on('line', (line: string) => lines.push(line));

		input.write('partial ');
		input.write('line\n');
		input.write('another ');
		input.write('partial line\n');

		await wait(10);

		assert.deepEqual(lines, ['partial line', 'another partial line']);
	});

	test('emits remaining buffer on close', async () => {
		const input = new PassThrough();
		await using rl = createInterface({ input });

		const lines: string[] = [];
		rl.on('line', (line: string) => lines.push(line));

		input.write('line with newline\n');
		input.write('line without newline');

		await wait(10);

		assert.deepEqual(lines, ['line with newline']);

		await wait(10);

		assert.deepEqual(lines, ['line with newline', 'line without newline']);
	});

	test('tracks history correctly', async () => {
		const input = new PassThrough();
		await using rl = createInterface({ input });

		let history: string[] = [];
		rl.on('history', (h: string[]) => (history = h));

		input.write('first command\n');
		input.write('second command\n');

		await wait(10);

		assert.deepEqual(history, ['first command', 'second command']);
	});

	test('pause and resume functionality', async () => {
		const input = new PassThrough();
		await using rl = createInterface({ input });

		const lines: string[] = [];
		rl.on('line', (line: string) => lines.push(line));

		rl.pause();
		input.write('should not be processed\n');

		await wait(10);

		assert.deepEqual(lines, []);

		rl.resume();
		input.write('should be processed\n');

		await wait(10);

		assert.deepEqual(lines, ['should be processed']);
	});
});

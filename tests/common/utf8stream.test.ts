// SPDX-License-Identifier: LGPL-3.0-or-later
import { Buffer } from 'buffer';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.ts';

suite('Utf8Stream', config('write'), () => {
	test('writes synchronously', config('sync'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-sync.log', sync: true });

		assert.equal(stream.write('hello '), true);
		assert.equal(stream.write('wörld\n'), true);
		assert.equal(fs.readFileSync('u8-sync.log', 'utf8'), 'hello wörld\n');

		stream.destroy();
	});

	test('exposes its options', config('sync'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-props.log', sync: true, minLength: 16, maxLength: 32 });

		assert.equal(stream.file, 'u8-props.log');
		assert.equal(stream.contentMode, 'utf8');
		assert.equal(stream.sync, true);
		assert.equal(stream.append, true);
		assert.equal(stream.minLength, 16);
		assert.equal(stream.maxLength, 32);
		assert.equal(stream.periodicFlush, 0);
		assert.equal(stream.mkdir, false);
		assert.ok(stream.fd > 0);

		stream.destroy();
	});

	test('buffers until minLength, then flushes', config('sync'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-buffered.log', sync: true, minLength: 4096 });

		stream.write('buffered');
		assert.equal(fs.readFileSync('u8-buffered.log', 'utf8'), '');

		stream.flushSync();
		assert.equal(fs.readFileSync('u8-buffered.log', 'utf8'), 'buffered');

		stream.destroy();
	});

	test('truncates when append is false', config('sync'), () => {
		fs.writeFileSync('u8-append.log', 'existing\n');

		const stream = new fs.Utf8Stream({ dest: 'u8-append.log', sync: true, append: false });
		stream.write('replaced');
		assert.equal(fs.readFileSync('u8-append.log', 'utf8'), 'replaced');

		stream.destroy();
	});

	test('writes buffers when contentMode is buffer', config('sync'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-buffer.log', sync: true, contentMode: 'buffer' });

		assert.equal(stream.contentMode, 'buffer');
		assert.throws(() => stream.write('not a buffer'), { code: 'ERR_INVALID_ARG_TYPE' });
		stream.write(Buffer.from('hi '));
		stream.write(Buffer.from('there'));
		assert.equal(fs.readFileSync('u8-buffer.log', 'utf8'), 'hi there');

		stream.destroy();
	});

	test('drops writes over maxLength', config('sync'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-drop.log', sync: true, maxLength: 4 });

		const dropped: string[] = [];
		stream.on('drop', data => dropped.push(data.toString()));

		stream.write('12345');
		stream.write('12');

		assert.deepEqual(dropped, ['12345']);
		assert.equal(fs.readFileSync('u8-drop.log', 'utf8'), '12');

		stream.destroy();
	});

	test('reopen switches files', config('sync'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-rotate.log', sync: true, minLength: 4096 });

		stream.write('before');
		stream.flushSync();
		stream.reopen('u8-rotated.log');
		assert.equal(stream.file, 'u8-rotated.log');

		stream.write('after');
		stream.flushSync();

		assert.equal(fs.readFileSync('u8-rotate.log', 'utf8'), 'before');
		assert.equal(fs.readFileSync('u8-rotated.log', 'utf8'), 'after');

		stream.destroy();
	});

	test('creates missing directories when mkdir is set', config('sync', 'directories'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-deep/dir/out.log', sync: true, mkdir: true });

		stream.write('made it');
		assert.equal(fs.readFileSync('u8-deep/dir/out.log', 'utf8'), 'made it');

		stream.destroy();
	});

	test('writes to an existing descriptor', config('sync'), () => {
		const fd = fs.openSync('u8-fd.log', 'w');
		const stream = new fs.Utf8Stream({ fd, sync: true });

		assert.equal(stream.fd, fd);
		stream.write('via fd');
		assert.equal(fs.readFileSync('u8-fd.log', 'utf8'), 'via fd');

		stream.destroy();
	});

	test('throws after being destroyed', config('sync'), () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-destroyed.log', sync: true });
		stream.destroy();

		assert.throws(() => stream.write('x'), { code: 'ERR_INVALID_STATE' });
		assert.throws(() => stream.flushSync(), { code: 'ERR_INVALID_STATE' });
		assert.throws(() => stream.end(), { code: 'ERR_INVALID_STATE' });
		stream.destroy(); // A second destroy is a no-op
	});

	test('validates its options', () => {
		assert.throws(() => new fs.Utf8Stream(), { code: 'ERR_INVALID_ARG_TYPE' });
		assert.throws(() => new fs.Utf8Stream({ dest: 'u8-invalid.log', contentMode: 'ascii' as 'utf8' }), { code: 'ERR_INVALID_ARG_VALUE' });
		assert.throws(() => new fs.Utf8Stream({ dest: 'u8-invalid.log', minLength: 100, maxWrite: 50 }), { code: 'ERR_INVALID_ARG_VALUE' });
		assert.throws(() => new fs.Utf8Stream({ dest: 'u8-invalid.log', sync: 'yes' as unknown as boolean }), { code: 'ERR_INVALID_ARG_TYPE' });
		assert.throws(() => new fs.Utf8Stream({ dest: 'u8-invalid.log', fs: { write: 5 } }), { code: 'ERR_INVALID_ARG_TYPE' });
	});

	test('writes asynchronously and emits events', config('async'), async () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-async.log' });

		const events: string[] = [];
		for (const event of ['ready', 'write', 'finish', 'close'] as const) stream.on(event, () => events.push(event));

		assert.equal(stream.write('async hello\n'), true);
		stream.end();
		await new Promise<void>(resolve => stream.on('close', () => resolve()));

		assert.deepEqual(events, ['ready', 'write', 'finish', 'close']);
		assert.equal(fs.readFileSync('u8-async.log', 'utf8'), 'async hello\n');
	});

	test('flush invokes its callback once written', config('async'), async () => {
		const stream = new fs.Utf8Stream({ dest: 'u8-flush.log', minLength: 4096 });
		await new Promise<void>(resolve => stream.on('ready', () => resolve()));

		stream.write('flushed');
		assert.equal(fs.readFileSync('u8-flush.log', 'utf8'), '');

		await new Promise<void>((resolve, reject) => stream.flush(err => (err ? reject(err) : resolve())));
		assert.equal(fs.readFileSync('u8-flush.log', 'utf8'), 'flushed');

		stream.destroy();
	});
});

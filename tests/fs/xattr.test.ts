import { Buffer } from 'buffer';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

suite('Extended Attributes', () => {
	const testFile = 'xattr-test.txt';
	const testValue = 'test value';
	const testName = 'user.test';

	test.before(() => fs.promises.writeFile(testFile, 'test content'));
	test.after(() => fs.promises.unlink(testFile));

	test('Non-user attribute set fails', async () => {
		await assert.rejects(fs.xattr.set(testFile, 'system.test', 'value'), { code: 'ENOTSUP' });
	});

	test('set and get attributes', async () => {
		await fs.xattr.set(testFile, testName, testValue);
		const value = await fs.xattr.get(testFile, testName, { encoding: 'utf8' });
		assert.equal(value, testValue);
	});

	test('get attributes with buffer encoding', async () => {
		await fs.xattr.set(testFile, 'user.buffer', 'buffer value');
		const buffer = await fs.xattr.get(testFile, 'user.buffer', { encoding: 'buffer' });
		assert(buffer instanceof Uint8Array);
		assert.equal(Buffer.from(buffer).toString(), 'buffer value');
	});

	test('remove attributes', async () => {
		await fs.xattr.set(testFile, 'user.to-remove', testValue);
		await fs.xattr.remove(testFile, 'user.to-remove');

		await assert.rejects(fs.xattr.get(testFile, 'user.to-remove', { encoding: 'utf8' }), { code: 'ENODATA' });
	});

	test('list attributes', async () => {
		await fs.xattr.set(testFile, 'user.list1', 'value1');
		await fs.xattr.set(testFile, 'user.list2', 'value2');

		const attrs = await fs.xattr.list(testFile);
		assert(attrs.includes('user.list1'));
		assert(attrs.includes('user.list2'));
	});

	test('handle create and replace options', async () => {
		const flagTestName = 'user.flag-test';

		await fs.xattr.set(testFile, flagTestName, 'original', { create: true });

		await assert.rejects(fs.xattr.set(testFile, flagTestName, 'new value', { create: true }), { code: 'EEXIST' });

		await fs.xattr.set(testFile, flagTestName, 'updated', { replace: true });
		const value = await fs.xattr.get(testFile, flagTestName, { encoding: 'utf8' });
		assert.equal(value, 'updated');

		await assert.rejects(fs.xattr.set(testFile, 'user.nonexistent', 'value', { replace: true }), { code: 'ENODATA' });
	});

	test('file must exist', async () => {
		await assert.rejects(fs.xattr.set('nonexistent-file.txt', testName, 'value'), { code: 'ENOENT' });
	});

	test('synchronous operations', () => {
		const syncAttrName = 'user.sync-test';

		fs.xattr.setSync(testFile, syncAttrName, testValue);
		const value = fs.xattr.getSync(testFile, syncAttrName, { encoding: 'utf8' });
		assert.equal(value, testValue);

		fs.xattr.removeSync(testFile, syncAttrName);

		assert.throws(() => fs.xattr.getSync(testFile, syncAttrName, { encoding: 'utf8' }), { code: 'ENODATA' });

		const syncList1 = 'user.sync-list1';
		const syncList2 = 'user.sync-list2';
		fs.xattr.setSync(testFile, syncList1, 'value1');
		fs.xattr.setSync(testFile, syncList2, 'value2');

		const attrs = fs.xattr.listSync(testFile);
		assert(attrs.includes(syncList1));
		assert(attrs.includes(syncList2));
	});
});

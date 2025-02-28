import { Buffer } from 'buffer';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const { Flags } = fs.xattr;

suite('Extended Attributes', () => {
	const testFile = 'xattr-test.txt';
	const testValue = 'test value';
	const testName = 'user.test';

	test.before(() => fs.promises.writeFile(testFile, 'test content'));
	test.after(() => fs.promises.unlink(testFile));

	test('Non-user attribute set fails', () => {
		assert.rejects(fs.xattr.set(testFile, 'system.test', 'value'), { code: 'EPERM' });
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

		try {
			await fs.xattr.get(testFile, 'user.to-remove', { encoding: 'utf8' });
			assert.fail('Should have thrown ENODATA error');
		} catch (err: any) {
			assert.equal(err.code, 'ENODATA');
		}
	});

	test('list attributes', async () => {
		await fs.xattr.set(testFile, 'user.list1', 'value1');
		await fs.xattr.set(testFile, 'user.list2', 'value2');

		const attrs = await fs.xattr.list(testFile);
		assert(attrs.includes('user.list1'));
		assert(attrs.includes('user.list2'));
	});

	test('handle create and replace flags', async () => {
		const flagTestName = 'user.flag-test';

		await fs.xattr.set(testFile, flagTestName, 'original', { flags: Flags.CREATE });

		try {
			await fs.xattr.set(testFile, flagTestName, 'new value', { flags: Flags.CREATE });
			assert.fail('Should have thrown EEXIST error');
		} catch (err: any) {
			assert.equal(err.code, 'EEXIST');
		}

		await fs.xattr.set(testFile, flagTestName, 'updated', { flags: Flags.REPLACE });
		const value = await fs.xattr.get(testFile, flagTestName, { encoding: 'utf8' });
		assert.equal(value, 'updated');

		try {
			await fs.xattr.set(testFile, 'user.nonexistent', 'value', { flags: Flags.REPLACE });
			assert.fail('Should have thrown ENODATA error');
		} catch (err: any) {
			assert.equal(err.code, 'ENODATA');
		}
	});

	test('file must exist', () => {
		assert.rejects(fs.xattr.set('nonexistent-file.txt', testName, 'value'), { code: 'ENOENT' });
	});

	test('synchronous operations', () => {
		const syncAttrName = 'user.sync-test';

		fs.xattr.setSync(testFile, syncAttrName, testValue);
		const value = fs.xattr.getSync(testFile, syncAttrName, { encoding: 'utf8' });
		assert.equal(value, testValue);

		fs.xattr.removeSync(testFile, syncAttrName);
		try {
			fs.xattr.getSync(testFile, syncAttrName, { encoding: 'utf8' });
			assert.fail('Should have thrown ENODATA error');
		} catch (err: any) {
			assert.equal(err.code, 'ENODATA');
		}

		const syncList1 = 'user.sync-list1';
		const syncList2 = 'user.sync-list2';
		fs.xattr.setSync(testFile, syncList1, 'value1');
		fs.xattr.setSync(testFile, syncList2, 'value2');

		const attrs = fs.xattr.listSync(testFile);
		assert(attrs.includes(syncList1));
		assert(attrs.includes(syncList2));
	});
});

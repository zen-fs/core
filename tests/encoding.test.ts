import { decode, encode } from '../src/utils';

const text = 'Test_ömg',
	encodings: BufferEncoding[] = ['ascii', 'utf8', 'latin1', 'binary', 'utf16le', 'ucs2', 'base64', 'base64url', 'hex'];

describe.each(encodings)('%s encoding test', encoding => {
	const bufferString = Buffer.from(text).toString(encoding);
	const encoded: Uint8Array = encode(bufferString, encoding);

	const decoded = decode(encoded, encoding);

	test('encode() == Buffer.from()', () => {
		expect(Array.from(encoded)).toEqual(Array.from(Buffer.from(bufferString, encoding)));
	});

	test('decode() == buffer.toString()', () => {
		expect(decoded).toEqual(bufferString);
	});
});

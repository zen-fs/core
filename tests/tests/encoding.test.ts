import { decode, encode } from '../../src/utils';

const text = 'Test_ömg',
	encodings: BufferEncoding[] = ['ascii', 'utf8', 'latin1', 'binary', 'utf16le', 'ucs2', 'base64', 'base64url', 'hex'];

describe.each(encodings)('%s encoding test', encoding => {
	const encoded: Uint8Array = encode(text, encoding),
		buffer: Buffer = Buffer.from(Buffer.from(text).toString(encoding), encoding);

	let decoded;
	try {
		decoded = decode(encoded, encoding);
	} catch (e) {
		decoded = '[[error]]';
	}

	let toString;
	try {
		toString = buffer.toString(encoding);
	} catch (e) {
		toString = '[[error]]';
	}

	test('encode() == Buffer.from()', () => {
		expect(Array.from(encoded)).toEqual(Array.from(buffer));
	});

	test('decode() == buffer.toString()', () => {
		expect(decoded).toEqual(toString);
	});
});

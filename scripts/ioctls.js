#!/usr/bin/env node
// This script generates the values used for the various ioctl commands used in enums
// Constant values are needed for enum member types
// See https://www.typescriptlang.org/docs/handbook/enums.html#union-enums-and-enum-member-types

import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean' },
		numbers: { short: 'n', type: 'string', default: 'hex' },
		format: { short: 'f', type: 'string', default: 'enum' },
		verbose: { short: 'v', type: 'boolean' },
	},
});

if (opts.help) {
	console.log(`Options:
		-h, --help     Show this help message
		-n, --numbers  Numeric format for members (hex, decimal, binary)
		-f, --format   How to format the output (enum, json, text, default)
		-v, --verbose  Show verbose output
		`);
	process.exit(0);
}

const _bits_nr = 8;
const _bits_type = 8;
const _bits_size = 14;
const _bits_dir = 2;

const _mask_nr = ((1 << _bits_nr) - 1) >>> 0;
const _mask_type = ((1 << _bits_type) - 1) >>> 0;
const _mask_size = ((1 << _bits_size) - 1) >>> 0;
const _mask_dir = ((1 << _bits_dir) - 1) >>> 0;

const _shift_nr = 0;
const _shift_type = _shift_nr + _bits_nr;
const _shift_size = _shift_type + _bits_type;
const _shift_dir = _shift_size + _bits_size;

if (opts.verbose) {
	console.log('name | bits | mask | shift |           mask (computed)         ');

	for (const [name, bits, mask, shift] of [
		['nr', _bits_nr, _mask_nr, _shift_nr],
		['type', _bits_type, _mask_type, _shift_type],
		['size', _bits_size, _mask_size, _shift_size],
		['dir', _bits_dir, _mask_dir, _shift_dir],
	]) {
		console.log(
			`${name.padEnd(4)} | ${bits.toString().padStart(4)} | ${mask.toString(16).padStart(4, '0')} | ${shift.toString().padStart(5)} | ${((mask << shift) >>> 0).toString(2).padStart(32, '0')}`
		);
	}

	console.log();
}

const _iow = 1;
const _ior = 2;
const _iorw = _iow | _ior;

function _encode(dir, type, nr, size) {
	const value = (dir << _shift_dir) | (type << _shift_type) | (nr << _shift_nr) | (size << _shift_size);
	return value >>> 0; // Why doesn't JS have unsigned left shift?!
}

function _decode(value) {
	return [
		(value >>> _shift_dir) & _mask_dir,
		(value >>> _shift_type) & _mask_type,
		(value >>> _shift_nr) & _mask_nr,
		(value >>> _shift_size) & _mask_size,
	];
}

const _f = 0x66;
const _v = 0x76;
const _X = 0x58;

// Sizes
const sz = {
	fiemap: 32,
	fsuuid2: 17,
	fs_sysfs_path: 129,
	long: 8,
	fsxattr: 28,
	int: 4,
	fs_label_max: 256,
};

const IOC = {
	GetFlags: _encode(_ior, _f, 1, sz.long),
	SetFlags: _encode(_iow, _f, 2, sz.long),
	GetVersion: _encode(_ior, _v, 1, sz.long),
	SetVersion: _encode(_iow, _v, 2, sz.long),
	Fiemap: _encode(_iorw, _f, 11, sz.fiemap),
	GetXattr: _encode(_ior, _X, 31, sz.fsxattr),
	SetXattr: _encode(_iow, _X, 32, sz.fsxattr),
	GetLabel: _encode(_ior, 0x94, 49, sz.fs_label_max),
	SetLabel: _encode(_iow, 0x94, 50, sz.fs_label_max),
	GetUuid: _encode(_ior, 0x15, 0, sz.fsuuid2),
	GetSysfsPath: _encode(_ior, 0x15, 1, sz.fs_sysfs_path),
};

const IOC32 = {
	GetFlags: _encode(_ior, _f, 1, sz.int),
	SetFlags: _encode(_iow, _f, 2, sz.int),
	GetVersion: _encode(_ior, _v, 1, sz.int),
	SetVersion: _encode(_iow, _v, 2, sz.int),
};

const base = opts.numbers === 'hex' ? 16 : opts.numbers === 'binary' ? 2 : 10;
const prefix = opts.numbers === 'hex' ? '0x' : opts.numbers === 'binary' ? '0b' : '';

const _enums = Object.entries({ IOC, IOC32 });

switch (opts.format) {
	case 'enum':
		for (const [name, contents] of _enums) {
			console.log(`export enum ${name} {`);

			const nameColumnLength = Math.max(...Object.keys(contents).map(key => key.length));

			for (const [key, value] of Object.entries(contents)) {
				console.log(`\t${key.padEnd(nameColumnLength)} = ${prefix}${value.toString(base)},`);
			}
			console.log('}');
		}
		break;
	case 'json':
		console.log(JSON.stringify({ IOC, IOC32 }));
		break;
	case 'text':
		for (const [name, contents] of _enums) {
			console.log('-'.repeat(20), name);

			const nameColumnLength = Math.max(...Object.keys(contents).map(key => key.length));

			for (const [key, value] of Object.entries(contents)) {
				const [dir, type, nr, size] = _decode(value);

				console.log(
					key.padEnd(nameColumnLength),
					value.toString(base).padStart(Math.ceil(32 / Math.log2(base)), '0'),
					(dir & _ior ? 'R' : '-') + (dir & _iow ? 'W' : '-'),
					type.toString(16).padStart(2),
					nr.toString(16).padStart(2),
					size.toString(16).padStart(4)
				);
			}
			console.log();
		}
		break;
	default:
		for (const [name, contents] of _enums) {
			console.log(name, contents);
		}
}

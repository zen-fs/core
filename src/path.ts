// SPDX-License-Identifier: LGPL-3.0-or-later

/*
This is derived from the POSIX path code of NodeJS
https://raw.githubusercontent.com/nodejs/node/3907bd1/lib/path.js 
*/

import type { ParsedPath } from 'node:path';
import type { V_Context } from './context.js';
import { contextOf } from './internal/contexts.js';

export type AbsolutePath = `/${string}`;

export const sep = '/';

function validateObject(str: unknown, name: string): void {
	if (typeof str != 'object') {
		throw new TypeError(`"${name}" is not an object`);
	}
}

// Resolves . and .. elements in a path with directory names
export function normalizeString(path: string, allowAboveRoot: boolean): string {
	let res = '';
	let lastSegmentLength = 0;
	let lastSlash = -1;
	let dots = 0;
	let char = '\x00';
	for (let i = 0; i <= path.length; ++i) {
		if (i < path.length) {
			char = path[i];
		} else if (char == '/') {
			break;
		} else {
			char = '/';
		}

		if (char == '/') {
			if (lastSlash === i - 1 || dots === 1) {
				// NOOP
			} else if (dots === 2) {
				if (res.length < 2 || lastSegmentLength !== 2 || res.at(-1) !== '.' || res.at(-2) !== '.') {
					if (res.length > 2) {
						const lastSlashIndex = res.lastIndexOf('/');
						if (lastSlashIndex === -1) {
							res = '';
							lastSegmentLength = 0;
						} else {
							res = res.slice(0, lastSlashIndex);
							lastSegmentLength = res.length - 1 - res.lastIndexOf('/');
						}
						lastSlash = i;
						dots = 0;
						continue;
					} else if (res.length !== 0) {
						res = '';
						lastSegmentLength = 0;
						lastSlash = i;
						dots = 0;
						continue;
					}
				}
				if (allowAboveRoot) {
					res += res.length > 0 ? '/..' : '..';
					lastSegmentLength = 2;
				}
			} else {
				if (res.length > 0) res += '/' + path.slice(lastSlash + 1, i);
				else res = path.slice(lastSlash + 1, i);
				lastSegmentLength = i - lastSlash - 1;
			}
			lastSlash = i;
			dots = 0;
		} else if (char === '.' && dots !== -1) {
			++dots;
		} else {
			dots = -1;
		}
	}
	return res;
}

export function formatExt(ext: string): string {
	return ext ? `${ext[0] === '.' ? '' : '.'}${ext}` : '';
}

export function resolve(this: V_Context, ...parts: (string | undefined)[]): AbsolutePath {
	let resolved = '';

	for (const part of [...parts.reverse(), contextOf(this).pwd]) {
		if (!part?.length) continue;

		resolved = `${part}/${resolved}`;

		if (part.startsWith('/')) {
			break;
		}
	}

	const absolute = resolved.startsWith('/');

	// At this point the path should be resolved to a full absolute path, but
	// handle relative paths to be safe (might happen when cwd fails)

	// Normalize the path
	resolved = normalizeString(resolved, !absolute);

	if (absolute) {
		return `/${resolved}`;
	}
	return resolved.length ? (resolved as AbsolutePath) : '/';
}

export function normalize(path: string): string {
	if (!path.length) return '.';

	const isAbsolute = path[0] === '/';
	const trailingSeparator = path.at(-1)! === '/';

	// Normalize the path
	path = normalizeString(path, !isAbsolute);

	if (!path.length) {
		if (isAbsolute) return '/';
		return trailingSeparator ? './' : '.';
	}
	if (trailingSeparator) path += '/';

	return isAbsolute ? `/${path}` : path;
}

export function isAbsolute(path: string): path is AbsolutePath {
	return path.startsWith('/');
}

export function join(...parts: string[]): string {
	if (!parts.length) return '.';
	const joined = parts.filter(p => p).join('/');
	if (!joined?.length) return '.';
	return normalize(joined);
}

export function relative(this: V_Context, from: string, to: string): string {
	if (from === to) return '';

	// Trim leading forward slashes.
	from = resolve.call(this, from);
	to = resolve.call(this, to);

	if (from === to) return '';

	const fromStart = 1;
	const fromEnd = from.length;
	const fromLen = fromEnd - fromStart;
	const toStart = 1;
	const toLen = to.length - toStart;

	// Compare paths to find the longest common path from root
	const length = fromLen < toLen ? fromLen : toLen;
	let lastCommonSep = -1;
	let i = 0;
	for (; i < length; i++) {
		const fromCode = from[fromStart + i];
		if (fromCode !== to[toStart + i]) break;
		else if (fromCode === '/') lastCommonSep = i;
	}
	if (i === length) {
		if (toLen > length) {
			if (to[toStart + i] === '/') {
				// We get here if `from` is the exact base path for `to`.
				// For example: from='/foo/bar'; to='/foo/bar/baz'
				return to.slice(toStart + i + 1);
			}
			if (i === 0) {
				// We get here if `from` is the root
				// For example: from='/'; to='/foo'
				return to.slice(toStart + i);
			}
		} else if (fromLen > length) {
			if (from[fromStart + i] === '/') {
				// We get here if `to` is the exact base path for `from`.
				// For example: from='/foo/bar/baz'; to='/foo/bar'
				lastCommonSep = i;
			} else if (i === 0) {
				// We get here if `to` is the root.
				// For example: from='/foo/bar'; to='/'
				lastCommonSep = 0;
			}
		}
	}

	let out = '';
	// Generate the relative path based on the path difference between `to`
	// and `from`.
	for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
		if (i === fromEnd || from[i] === '/') {
			out += out.length === 0 ? '..' : '/..';
		}
	}

	// Lastly, append the rest of the destination (`to`) path that comes after
	// the common path parts.
	return `${out}${to.slice(toStart + lastCommonSep)}`;
}

export function dirname(path: string): string {
	if (path.length === 0) return '.';
	const hasRoot = path[0] === '/';
	let end = -1;
	let matchedSlash = true;
	for (let i = path.length - 1; i >= 1; --i) {
		if (path[i] === '/') {
			if (!matchedSlash) {
				end = i;
				break;
			}
		} else {
			// We saw the first non-path separator
			matchedSlash = false;
		}
	}

	if (end === -1) return hasRoot ? '/' : '.';
	if (hasRoot && end === 1) return '//';
	return path.slice(0, end);
}

export function basename(path: string, suffix?: string): string {
	let start = 0;
	let end = -1;
	let matchedSlash = true;

	if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
		if (suffix === path) return '';
		let extIdx = suffix.length - 1;
		let firstNonSlashEnd = -1;
		for (let i = path.length - 1; i >= 0; --i) {
			if (path[i] === '/') {
				// If we reached a path separator that was not part of a set of path
				// separators at the end of the string, stop now
				if (!matchedSlash) {
					start = i + 1;
					break;
				}
			} else {
				if (firstNonSlashEnd === -1) {
					// We saw the first non-path separator, remember this index in case
					// we need it if the extension ends up not matching
					matchedSlash = false;
					firstNonSlashEnd = i + 1;
				}
				if (extIdx >= 0) {
					// Try to match the explicit extension
					if (path[i] === suffix[extIdx]) {
						if (--extIdx === -1) {
							// We matched the extension, so mark this as the end of our path component
							end = i;
						}
					} else {
						// Extension does not match, so our result is the entire path component
						extIdx = -1;
						end = firstNonSlashEnd;
					}
				}
			}
		}

		if (start === end) end = firstNonSlashEnd;
		else if (end === -1) end = path.length;
		return path.slice(start, end);
	}
	for (let i = path.length - 1; i >= 0; --i) {
		if (path[i] === '/') {
			// If we reached a path separator that was not part of a set of path separators at the end of the string, stop now
			if (!matchedSlash) {
				start = i + 1;
				break;
			}
		} else if (end === -1) {
			// We saw the first non-path separator, mark this as the end of our path component
			matchedSlash = false;
			end = i + 1;
		}
	}

	if (end === -1) return '';
	return path.slice(start, end);
}

export function extname(path: string): string {
	let startDot = -1;
	let startPart = 0;
	let end = -1;
	let matchedSlash = true;
	// Track the state of characters (if any) we see before our first dot and
	// after any path separator we find
	let preDotState = 0;
	for (let i = path.length - 1; i >= 0; --i) {
		if (path[i] === '/') {
			// If we reached a path separator that was not part of a set of path
			// separators at the end of the string, stop now
			if (!matchedSlash) {
				startPart = i + 1;
				break;
			}
			continue;
		}
		if (end === -1) {
			// We saw the first non-path separator, mark this as the end of our
			// extension
			matchedSlash = false;
			end = i + 1;
		}
		if (path[i] === '.') {
			// If this is our first dot, mark it as the start of our extension
			if (startDot === -1) startDot = i;
			else if (preDotState !== 1) preDotState = 1;
		} else if (startDot !== -1) {
			// We saw a non-dot and non-path separator before our dot, so we should
			// have a good chance at having a non-empty extension
			preDotState = -1;
		}
	}

	if (
		startDot === -1
		|| end === -1
		// We saw a non-dot character immediately before the dot
		|| preDotState === 0
		// The (right-most) trimmed path component is exactly '..'
		|| (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
	) {
		return '';
	}
	return path.slice(startDot, end);
}

export function format(pathObject: ParsedPath): string {
	validateObject(pathObject, 'pathObject');
	const dir = pathObject.dir || pathObject.root;
	const base = pathObject.base || `${pathObject.name || ''}${formatExt(pathObject.ext)}`;
	if (!dir) {
		return base;
	}
	return dir === pathObject.root ? `${dir}${base}` : `${dir}/${base}`;
}

export function parse(path: string): ParsedPath {
	const isAbsolute = path[0] === '/';

	const ret = { root: isAbsolute ? '/' : '', dir: '', base: '', ext: '', name: '' };
	if (path.length === 0) return ret;

	const start = isAbsolute ? 1 : 0;
	let startDot = -1;
	let startPart = 0;
	let end = -1;
	let matchedSlash = true;
	let i = path.length - 1;

	// Track the state of characters (if any) we see before our first dot and
	// after any path separator we find
	let preDotState = 0;

	// Get non-dir info
	for (; i >= start; --i) {
		if (path[i] === '/') {
			// If we reached a path separator that was not part of a set of path
			// separators at the end of the string, stop now
			if (!matchedSlash) {
				startPart = i + 1;
				break;
			}
			continue;
		}
		if (end === -1) {
			// We saw the first non-path separator, mark this as the end of our
			// extension
			matchedSlash = false;
			end = i + 1;
		}
		if (path[i] === '.') {
			// If this is our first dot, mark it as the start of our extension
			if (startDot === -1) startDot = i;
			else if (preDotState !== 1) preDotState = 1;
		} else if (startDot !== -1) {
			// We saw a non-dot and non-path separator before our dot, so we should
			// have a good chance at having a non-empty extension
			preDotState = -1;
		}
	}

	if (end !== -1) {
		const start = startPart === 0 && isAbsolute ? 1 : startPart;
		if (
			startDot === -1
			// We saw a non-dot character immediately before the dot
			|| preDotState === 0
			// The (right-most) trimmed path component is exactly '..'
			|| (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
		) {
			ret.base = ret.name = path.slice(start, end);
		} else {
			ret.name = path.slice(start, startDot);
			ret.base = path.slice(start, end);
			ret.ext = path.slice(startDot, end);
		}
	}

	if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
	else if (isAbsolute) ret.dir = '/';

	return ret;
}

/**
 * Matches `text` against `pattern`, where a star matches any run of items that `canSkip` allows and every other pattern item matches exactly one.
 * Runs in time proportional to the product of the lengths at worst.
 */
function matchWildcard<P, T>(
	pattern: ArrayLike<P>,
	text: ArrayLike<T>,
	isStar: (item: P) => boolean,
	matchesItem: (item: P, value: T) => boolean,
	canSkip: (value: T) => boolean = () => true,
): boolean {
	let patternIndex = 0,
		textIndex = 0,
		starIndex = -1,
		resumeIndex = 0;

	while (textIndex < text.length) {
		if (patternIndex < pattern.length && isStar(pattern[patternIndex])) {
			starIndex = patternIndex++;
			resumeIndex = textIndex;
			continue;
		}

		if (patternIndex < pattern.length && matchesItem(pattern[patternIndex], text[textIndex])) {
			patternIndex++;
			textIndex++;
			continue;
		}

		if (starIndex == -1 || !canSkip(text[resumeIndex])) return false;

		patternIndex = starIndex + 1;
		textIndex = ++resumeIndex;
	}

	while (patternIndex < pattern.length && isStar(pattern[patternIndex])) patternIndex++;

	return patternIndex == pattern.length;
}

/** POSIX character classes, as Unicode property escapes for use within a character class */
const posixClasses: Record<string, string> = {
	alnum: '\\p{L}\\p{Nl}\\p{Nd}',
	alpha: '\\p{L}\\p{Nl}',
	ascii: '\\x00-\\x7f',
	blank: '\\p{Zs}\\t',
	cntrl: '\\p{Cc}',
	digit: '\\p{Nd}',
	graph: '\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}',
	lower: '\\p{Ll}',
	print: '\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}\\p{Zs}',
	punct: '\\p{P}',
	space: '\\p{Z}\\t\\r\\n\\v\\f',
	upper: '\\p{Lu}',
	word: '\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}',
	xdigit: 'A-Fa-f0-9',
};

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const escapeClass = (char: string): string => (/[\\\]\[^-]/.test(char) ? '\\' + char : char);

/**
 * Expands a brace sequence such as `1..9`, `a..z`, `1..9..3`, or `01..12`.
 */
function expandSequence(body: string): string[] | undefined {
	const numeric = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(body);
	const alphabetic = /^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.(-?\d+))?$/.exec(body);
	const match = numeric ?? alphabetic;
	if (!match) return;

	const [, first, last, increment] = match;
	const start = numeric ? parseInt(first) : first.charCodeAt(0);
	const end = numeric ? parseInt(last) : last.charCodeAt(0);
	const step = Math.abs(parseInt(increment ?? '1')) || 1;
	const padded = numeric && (/^-?0\d/.test(first) || /^-?0\d/.test(last)) ? Math.max(first.length, last.length) : 0;

	const values: string[] = [];
	for (let value = start; start <= end ? value <= end : value >= end; value += start <= end ? step : -step) {
		if (!numeric) values.push(String.fromCharCode(value));
		else if (value < 0) values.push('-' + String(-value).padStart(padded - 1, '0'));
		else values.push(String(value).padStart(padded, '0'));
	}
	return values;
}

/**
 * Expands brace groups into the patterns they stand for, leaving groups with neither a comma nor a sequence as-is.
 */
function expandBraces(pattern: string, from: number = 0): string[] {
	for (let i = pattern.indexOf('{', from); i != -1; i = pattern.indexOf('{', i + 1)) {
		let depth = 0,
			end = -1;
		const commas: number[] = [];
		for (let j = i; j < pattern.length; j++) {
			if (pattern[j] == '{') depth++;
			else if (pattern[j] == '}' && --depth == 0) {
				end = j;
				break;
			} else if (pattern[j] == ',' && depth == 1) commas.push(j);
		}
		if (end == -1) return [pattern];

		const body = pattern.slice(i + 1, end);
		const alternatives = commas.length
			? [i, ...commas].map((comma, index) => pattern.slice(comma + 1, commas[index] ?? end))
			: expandSequence(body);
		if (!alternatives) continue;

		const prefix = pattern.slice(0, i),
			suffix = pattern.slice(end + 1);
		return alternatives.flatMap(alternative => expandBraces(prefix + alternative + suffix, i));
	}
	return [pattern];
}

/**
 * Parses a bracket expression starting at `start`, returning `undefined` if it is not closed.
 */
function parseClass(source: string, start: number): [regex: string, end: number] | undefined {
	let i = start + 1;
	const negate = source[i] == '!' || source[i] == '^';
	if (negate) i++;

	let body = '';
	for (let first = true; i < source.length; first = false) {
		const char = source[i];
		if (char == ']' && !first) return [`[${negate ? '^' : ''}${body}]`, i + 1];

		if (char == '[' && source[i + 1] == ':') {
			const close = source.indexOf(':]', i + 2);
			const posix = close == -1 ? undefined : posixClasses[source.slice(i + 2, close)];
			if (posix) {
				body += posix;
				i = close + 2;
				continue;
			}
		}

		if (source[i + 1] == '-' && i + 2 < source.length && source[i + 2] != ']') {
			body += `${escapeClass(char)}-${escapeClass(source[i + 2])}`;
			i += 3;
			continue;
		}

		body += escapeClass(char);
		i++;
	}
}

/**
 * Parses the alternatives of an extended glob starting after its `(`, returning `undefined` if it is not closed.
 */
function parseGroup(source: string, start: number): [alternatives: string[], end: number] | undefined {
	const alternatives: string[] = [];
	for (let i = start; i < source.length;) {
		const [alternative, end] = parseSegment(source, i, true);
		alternatives.push(alternative);
		if (source[end] == ')') return [alternatives, end + 1];
		if (source[end] != '|') return;
		i = end + 1;
	}
}

const extglobQuantifiers: Record<string, string> = { '?': '?', '*': '*', '+': '+', '@': '' };

/**
 * Compiles part of a glob segment into regular expression source, stopping at `|` or `)` within an extended glob.
 */
function parseSegment(source: string, start: number, inGroup: boolean): [regex: string, end: number] {
	let regex = '';
	let i = start;
	while (i < source.length) {
		const char = source[i];
		if (inGroup && (char == '|' || char == ')')) break;

		const group = '?*+@!'.includes(char) && source[i + 1] == '(' ? parseGroup(source, i + 2) : undefined;
		if (group) {
			const [alternatives, end] = group;
			const body = alternatives.join('|');
			if (char != '!') {
				regex += `(?:${body})${extglobQuantifiers[char]}`;
				i = end;
				continue;
			}
			const [rest, restEnd] = parseSegment(source, end, inGroup);
			return [`${regex}(?:(?!(?:${body})${rest}${inGroup ? '' : '$'})[^/]*?)${rest}`, restEnd];
		}

		const bracket = char == '[' ? parseClass(source, i) : undefined;
		if (bracket) {
			regex += bracket[0];
			i = bracket[1];
			continue;
		}

		regex += char == '*' ? '[^/]*' : char == '?' ? '[^/]' : escapeRegex(char);
		i++;
	}
	return [regex, i];
}

/** A character matcher within a segment, or `true` for `*` */
type GlobToken = true | ((char: string) => boolean);

interface GlobSegment {
	/** Whether the segment starts with a literal `.`, allowing it to match dot files */
	dot: boolean;
	/** Set for segments without wildcards, which are compared directly */
	literal?: string;
	/** Set for segments matched in linear time by tokens */
	tokens?: GlobToken[];
	/** Set for other segments with wildcards */
	regex?: RegExp;
	globstar?: boolean;
}

const isMagic = (segment: string): boolean => /[*?[]|[?*+@!]\(/.test(segment);

/**
 * Splits a segment without extended globs into tokens for `*`, `?`, bracket expressions, and literal characters.
 */
function tokenizeSegment(source: string): GlobToken[] {
	const tokens: GlobToken[] = [];
	for (let i = 0; i < source.length;) {
		const char = source[i];
		const bracket = char == '[' ? parseClass(source, i) : undefined;
		if (bracket) {
			const regex = new RegExp(`^${bracket[0]}$`, 'u');
			tokens.push(value => regex.test(value));
			i = bracket[1];
			continue;
		}
		const codePoint = String.fromCodePoint(source.codePointAt(i)!);
		tokens.push(char == '*' ? true : char == '?' ? () => true : value => value == codePoint);
		i += codePoint.length;
	}
	return tokens;
}

/**
 * Whether a segment can match dot files, because it or one of its leading extended glob's alternatives starts with a literal `.`.
 */
function allowsDot(source: string): boolean {
	if (source.startsWith('.')) return true;
	if (!/^[?*+@]\(/.test(source)) return false;
	return !!parseGroup(source, 2)?.[0].some(alternative => alternative.startsWith('\\.'));
}

function compileSegment(source: string): GlobSegment {
	if (source == '**') return { dot: false, globstar: true };
	const dot = allowsDot(source);
	if (!isMagic(source)) return { dot, literal: source };
	try {
		// Segments without extended globs and with more than one `*` are matched with tokens in linear time
		if (!/[?*+@!]\(/.test(source) && source.split('*').length > 2) return { dot, tokens: tokenizeSegment(source) };
		return { dot, regex: new RegExp(`^${parseSegment(source, 0, false)[0]}$`, 'u') };
	} catch {
		return { dot, literal: source };
	}
}

const compiledGlobs = new Map<string, GlobSegment[][]>();

/**
 * Compiles a glob pattern into the segments of each pattern its braces expand to.
 */
function compileGlob(pattern: string): GlobSegment[][] {
	const cached = compiledGlobs.get(pattern);
	if (cached) return cached;

	const normalized = pattern.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
	const compiled = expandBraces(normalized).map(expanded => {
		const segments = expanded.split('/');
		if (segments.length > 1 && segments.at(-1) == '**') segments.splice(-1, 0, '*');
		return segments.map(compileSegment);
	});

	if (compiledGlobs.size >= 1024) compiledGlobs.clear();
	compiledGlobs.set(pattern, compiled);
	return compiled;
}

function matchesSegment(segment: GlobSegment, name: string): boolean {
	if (name.startsWith('.') && !segment.dot) return false;
	if (segment.literal !== undefined) return segment.literal == name;
	if (segment.tokens)
		return matchWildcard(
			segment.tokens,
			Array.from(name),
			token => token === true,
			(token, char) => token !== true && token(char),
		);
	return !!segment.regex?.test(name);
}

/**
 * Determines whether entries below `directory` could match one of `patterns`:
 * `'literal'` when its last segment is matched by a literal pattern segment, `'pattern'` when matched by a wildcard or `**`.
 * @internal @hidden
 */
export function _globDescent(patterns: readonly string[], directory: string): 'literal' | 'pattern' | undefined {
	const segments = directory.split('/');
	let descent: 'pattern' | undefined;

	for (const patternSegments of patterns.flatMap(compileGlob)) {
		for (let i = 0; i < segments.length; i++) {
			const patternSegment = patternSegments[i];
			if (patternSegment.globstar) {
				descent = 'pattern';
				break;
			}
			if (i >= patternSegments.length - 1 || !matchesSegment(patternSegment, segments[i])) break;
			if (i < segments.length - 1) continue;
			if (patternSegment.literal !== undefined) return 'literal';
			descent = 'pattern';
		}
	}

	return descent;
}

/**
 * Matches `str` against a glob pattern with Node's syntax: brace expansion, character classes, and extended globs.
 * `**` as a whole segment matches any number of segments (at least one when it is the last), and nothing else matches `/`.
 * Names starting with `.` are only matched by pattern segments starting with a literal `.`.
 */
export function matchesGlob(path: string, pattern: string): boolean {
	const names = path.split('/');
	return compileGlob(pattern).some(segments =>
		matchWildcard(
			segments,
			names,
			segment => !!segment.globstar,
			matchesSegment,
			name => !name.startsWith('.'),
		),
	);
}

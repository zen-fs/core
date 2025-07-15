/* eslint-disable @typescript-eslint/no-explicit-any */
// A cross-platform node:readline implementation
import { EventEmitter } from 'eventemitter3';
import { warn } from 'kerium/log';
import type { Abortable } from 'node:events';
import type * as readline from 'node:readline';

interface InterfaceEvents {
	close: [];
	line: [input: string];
	pause: [];
	resume: [];
	SIGCONT: [];
	SIGINT: [];
	SIGTSTP: [];
	history: [history: string[]];
}

export class Interface extends EventEmitter<InterfaceEvents> implements readline.Interface {
	public readonly line: string = '';

	protected _cursor: number = 0;

	public get cursor(): number {
		return this._cursor;
	}

	private _buffer: string = '';
	private _closed: boolean = false;
	private _paused: boolean = false;
	private _prompt: string = '';
	private _history: string[] = [];
	private _historyIndex: number = -1;
	private _currentLine: string = '';

	constructor(
		public readonly input: NodeJS.ReadableStream,
		public readonly output?: NodeJS.WritableStream,
		completer?: readline.Completer | readline.AsyncCompleter,
		public readonly terminal: boolean = false
	) {
		super();

		this.input.on('data', this._onData);
		this.input.on('end', this.close.bind(this));
		this.input.on('close', this.close.bind(this));
	}

	private _onData = (data: Buffer | string): void => {
		if (this._paused || this._closed) return;

		this._buffer += typeof data === 'string' ? data : data.toString('utf8');

		for (let lineEnd = this._buffer.indexOf('\n'); lineEnd >= 0; lineEnd = this._buffer.indexOf('\n')) {
			let line = this._buffer.substring(0, lineEnd);
			if (line.endsWith('\r')) {
				line = line.substring(0, line.length - 1);
			}

			this._buffer = this._buffer.substring(lineEnd + 1);

			(this as any).line = line;

			if (line.trim() && !line.trim().match(/^\s*$/) && this._history.at(-1) != line) {
				this._history.push(line);
				this._historyIndex = this._history.length;
				this.emit('history', this._history);
			}

			this.emit('line', line);
		}
	};

	/**
	 * Closes the interface and removes all event listeners
	 */
	public close(): void {
		if (this._closed) return;

		this._closed = true;
		this.input?.removeAllListeners?.();

		if (this._buffer.length) {
			const line = this._buffer;
			this._buffer = '';
			(this as any).line = line;
			this.emit('line', line);
		}

		this.emit('history', this._history);
		this.emit('close');
		this.removeAllListeners();
	}

	/**
	 * Pauses the input stream
	 */
	public pause(): this {
		if (this._paused) return this;

		this._paused = true;
		if ('pause' in this.input) this.input.pause();
		this.emit('pause');
		return this;
	}

	/**
	 * Resumes the input stream
	 */
	public resume(): this {
		if (!this._paused) return this;

		this._paused = false;
		if ('resume' in this.input) this.input.resume();
		this.emit('resume');
		return this;
	}

	/**
	 * Sets the prompt text
	 */
	public setPrompt(prompt: string): void {
		this._prompt = prompt;
	}

	/**
	 * Gets the current prompt text
	 */
	public getPrompt(): string {
		return this._prompt;
	}

	/**
	 * Displays the prompt to the user
	 */
	public prompt(preserveCursor?: boolean): void {
		if (!this.output) return;

		if (!preserveCursor) {
			this.output.write(this._prompt);
			return;
		}

		const { cols } = this.getCursorPos();
		this.output.write(this._prompt);
		this._cursor = cols;
	}

	/**
	 * Writes data to the interface and handles key events
	 */
	public write(data: string | Buffer, key?: readline.Key): void {
		if (this._closed) return;

		if (data) {
			const str = typeof data === 'string' ? data : data.toString('utf8');
			this._onData(str);
		}

		if (!key || !this.terminal) return;

		switch ((key.ctrl ? '^' : '') + key.name) {
			case '^c':
				this.emit('SIGINT');
				break;
			case '^z':
				this.emit('SIGTSTP');
				break;
			case '^q':
				this.emit('SIGCONT');
				break;
			case 'home':
			case '^a':
				if (!this.output) return;
				moveCursor(this.output, -this._cursor, 0);
				this._cursor = 0;
				this._cursor = 0;
				break;
			case '^e':
			case 'end': {
				if (!this.output) return;

				const dx = this.line.length - this._cursor;

				if (!dx) return;

				moveCursor(this.output, dx, 0);
				this._cursor = this.line.length;
				this._cursor = this.line.length;
				break;
			}
			case '^k': {
				if (!this.output) return;

				if (this._cursor >= this.line.length) return;

				const newLine = this.line.slice(0, this._cursor);

				clearLine(this.output, 1);
				(this as any).line = newLine;
				break;
			}
			case '^u': {
				if (!this.output || !this._cursor) return;

				const newLine = this.line.slice(this._cursor);

				clearLine(this.output, 0);
				moveCursor(this.output, 0, 0);
				this.output.write(this._prompt + newLine);
				(this as any).line = newLine;
				this._cursor = 0;
				this._cursor = 0;
				break;
			}
			case '^w': {
				if (!this.output || !this._cursor) return;

				let i = this._cursor - 1;

				while (i >= 0 && this.line[i] === ' ') i--;
				while (i >= 0 && this.line[i] !== ' ') i--;

				const newLine = this.line.slice(0, i + 1) + this.line.slice(this._cursor);
				const newCursorPos = i + 1;

				this._renderLine(newLine);
				this._cursor = newCursorPos;
				this._cursor = newCursorPos;

				moveCursor(this.output, -newLine.length, 0);
				moveCursor(this.output, newCursorPos, 0);
				break;
			}
			case '^return':
			case '^enter':
				this._onData('\n');
				break;
			case 'return':
			case 'enter':
				this._onData((!data ? '' : typeof data == 'string' ? data : data.toString('utf8')) + '\n');
				break;
			case 'up':
			case 'down': {
				if (!this.output || !this._history.length) return;

				if (this._historyIndex === this._history.length) {
					this._currentLine = (this as any).line || '';
				}

				if (key.name == 'up' && this._historyIndex > 0) {
					this._historyIndex--;
				} else if (key.name == 'down' && this._historyIndex < this._history.length - 1) {
					this._historyIndex++;
				} else if (key.name == 'down' && this._historyIndex == this._history.length - 1) {
					this._historyIndex = this._history.length;
					this._renderLine(this._currentLine);
					return;
				} else {
					return;
				}

				const historyItem = this._history[this._historyIndex];
				this._renderLine(historyItem);
				break;
			}
			case 'left':
			case 'right': {
				const dx = key.name == 'left' ? -1 : 1;
				if (!this.output) return;

				const newPos = Math.max(0, Math.min(this.line.length, this._cursor + dx));

				if (newPos == this._cursor) return;

				moveCursor(this.output, dx, 0);
				this._cursor = newPos;
				this._cursor = newPos;
				break;
			}
			case 'backspace': {
				if (!this.output || !this._cursor) return;

				const newLine = this.line.slice(0, this._cursor - 1) + this.line.slice(this._cursor);

				this._renderLine(newLine);
				this._cursor = --this._cursor;

				if (this._cursor > 0) {
					moveCursor(this.output, -this._cursor, 0);
					moveCursor(this.output, this._cursor, 0);
				}
				break;
			}
			case 'delete': {
				if (!this.output) return;

				if (this._cursor >= this.line.length) return;

				const newLine = this.line.slice(0, this._cursor) + this.line.slice(this._cursor + 1);

				clearLine(this.output, 0);
				moveCursor(this.output, 0, 0);
				this.output.write(this._prompt + newLine);
				(this as any).line = newLine;

				moveCursor(this.output, -newLine.length, 0);
				moveCursor(this.output, this._cursor, 0);
				break;
			}
		}
	}

	private _renderLine(text: string): void {
		if (!this.output) return;

		clearLine(this.output, 0);
		moveCursor(this.output, 0, 0);
		this.output.write(this._prompt + text);
		(this as any).line = text;
		this._cursor = text.length;
		this._cursor = text.length;
	}

	/**
	 * Asks the user for input with a specified prompt
	 */
	public question(query: string, callback: (answer: string) => void): void;
	public question(query: string, options: Abortable, callback: (answer: string) => void): void;
	public question(query: string, optionsOrCallback: ((answer: string) => void) | Abortable, maybeCallback?: (answer: string) => void): void {
		const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;

		if (this._closed || !this.output) {
			callback('');
			return;
		}

		this.output.write(query);
		this.once('line', callback);
	}

	/**
	 * Gets the current cursor position
	 */
	public getCursorPos(): { rows: number; cols: number } {
		return { rows: 0, cols: this.cursor };
	}

	/**
	 * Prepends a listener for the specified event
	 */
	public prependListener(event: keyof InterfaceEvents, listener: (...args: any[]) => void): this {
		const listeners = this.listeners(event);
		this.removeAllListeners(event);
		this.on(event, listener);
		listeners.forEach(this.on.bind(this, event));
		return this;
	}

	/**
	 * Prepends a one-time listener for the specified event
	 */
	public prependOnceListener(event: keyof InterfaceEvents, listener: (...args: any[]) => void): this {
		const listeners = this.listeners(event);
		this.removeAllListeners(event);
		this.once(event, listener);
		listeners.forEach(this.on.bind(this, event));
		return this;
	}

	/**
	 * Sets the maximum number of listeners
	 */
	public setMaxListeners(): this {
		warn('Interface.prototype.setMaxListeners is not supported');
		return this;
	}

	/**
	 * Gets the maximum number of listeners
	 */
	public getMaxListeners(): number {
		warn('Interface.prototype.getMaxListeners is not supported');
		return 10;
	}

	public [Symbol.asyncIterator](): AsyncIteratorObject<string, undefined> {
		let done = false;

		return {
			next: async (): Promise<IteratorResult<string, any>> => {
				if (done) return { done, value: undefined };

				const { resolve, promise } = Promise.withResolvers<IteratorResult<string, any>>();

				this.once('line', (line: string) => resolve({ value: line, done: false }));

				this.once('close', () => {
					done = true;
					resolve({ value: undefined, done });
				});

				return promise;
			},

			return: async (value?: any): Promise<IteratorResult<string, any>> => {
				if (done) return { done, value };
				done = true;
				this.close();
				return { done, value };
			},

			throw: async (error?: any): Promise<IteratorResult<string, any>> => {
				if (!done) {
					done = true;
					this.close();
				}
				throw error;
			},

			[Symbol.asyncIterator](): NodeJS.AsyncIterator<string> {
				return this;
			},

			[Symbol.asyncDispose]: async (): Promise<void> => {
				if (done) return;
				done = true;
				this.close();
			},
		};
	}

	public [Symbol.dispose](): void {
		this.close();
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		if (this._closed) return;

		const { resolve, promise } = Promise.withResolvers<void>();

		this.once('close', () => resolve());
		this.close();

		await promise;
	}

	public rawListeners(event: keyof InterfaceEvents): ((...args: any[]) => void)[] {
		return this.listeners(event);
	}
}

/**
 * Creates a readline interface
 * @param input The readable stream to read from
 * @param output The writable stream to write to
 * @param completer The completer function
 * @param terminal Whether to use terminal features
 * @returns A readline interface
 */
export function createInterface(
	input: NodeJS.ReadableStream,
	output?: NodeJS.WritableStream,
	completer?: readline.Completer | readline.AsyncCompleter,
	terminal?: boolean
): Interface;
/**
 * Creates a readline interface from options
 * @param options The options for the interface
 * @returns A readline interface
 */
export function createInterface(options: readline.ReadLineOptions): Interface;
export function createInterface(
	input: NodeJS.ReadableStream | readline.ReadLineOptions,
	output?: NodeJS.WritableStream,
	completer?: readline.Completer | readline.AsyncCompleter,
	terminal?: boolean
): Interface {
	return 'input' in input
		? new Interface(input.input, input.output, input.completer, input.terminal)
		: new Interface(input, output, completer, terminal);
}
createInterface satisfies typeof readline.createInterface;

/**
 * Clear the current line in the terminal
 * @param stream The stream to clear the line on
 * @param dir The direction to clear: -1 for left, 1 for right, 0 for entire line
 */
export function clearLine(stream: NodeJS.WritableStream, dir: number): boolean {
	stream.write(dir >= 0 ? '\r\x1b[K' : '\x1b[K');
	return true;
}
clearLine satisfies typeof readline.clearLine;

/**
 * Clear the screen down from the current position
 * @param stream The stream to clear the screen on
 */
export function clearScreenDown(stream: NodeJS.WritableStream): boolean {
	if (!stream.write) return false;
	stream.write('\x1b[J');
	return true;
}
clearScreenDown satisfies typeof readline.clearScreenDown;

/**
 * Move the cursor in the terminal
 * @param stream The stream to move the cursor on
 * @param dx The number of characters to move horizontally
 * @param dy The number of lines to move vertically
 */
export function moveCursor(stream: NodeJS.WritableStream, dx: number, dy: number): boolean {
	if (!stream.write) return false;

	let cmd = '';

	if (dx < 0) {
		cmd += `\x1b[${-dx}D`;
	} else if (dx > 0) {
		cmd += `\x1b[${dx}C`;
	}

	if (dy < 0) {
		cmd += `\x1b[${-dy}A`;
	} else if (dy > 0) {
		cmd += `\x1b[${dy}B`;
	}

	if (cmd) stream.write(cmd);

	return true;
}
moveCursor satisfies typeof readline.moveCursor;

const _unescaped = {
	'\r': 'return',
	'\n': 'enter',
	'\t': 'tab',
	'\b': 'backspace',
	'\x7f': 'backspace',
	'\x1b': 'escape',
	' ': 'space',
};

const _escaped: Record<string, Partial<readline.Key>> = {
	/* xterm ESC [ letter */
	'[A': { name: 'up' },
	'[B': { name: 'down' },
	'[C': { name: 'right' },
	'[D': { name: 'left' },
	'[E': { name: 'clear' },
	'[F': { name: 'end' },
	'[H': { name: 'home' },

	/* xterm/gnome ESC [ letter (with modifier) */
	'[P': { name: 'f1' },
	'[Q': { name: 'f2' },
	'[R': { name: 'f3' },
	'[S': { name: 'f4' },

	/* xterm/gnome ESC O letter */
	OA: { name: 'up' },
	OB: { name: 'down' },
	OC: { name: 'right' },
	OD: { name: 'left' },
	OE: { name: 'clear' },
	OF: { name: 'end' },
	OH: { name: 'home' },

	/* xterm/gnome ESC O letter (without modifier) */
	OP: { name: 'f1' },
	OQ: { name: 'f2' },
	OR: { name: 'f3' },
	OS: { name: 'f4' },

	/* xterm/rxvt ESC [ number ~ */
	'[1~': { name: 'home' },
	'[2~': { name: 'insert' },
	'[3~': { name: 'delete' },
	'[4~': { name: 'end' },
	'[5~': { name: 'pageup' },
	'[6~': { name: 'pagedown' },
	'[7~': { name: 'home' },
	'[8~': { name: 'end' },

	/* xterm/rxvt ESC [ number ~ */
	'[11~': { name: 'f1' },
	'[12~': { name: 'f2' },
	'[13~': { name: 'f3' },
	'[14~': { name: 'f4' },
	/* common */
	'[15~': { name: 'f5' },
	'[17~': { name: 'f6' },
	'[18~': { name: 'f7' },
	'[19~': { name: 'f8' },
	'[20~': { name: 'f9' },
	'[21~': { name: 'f10' },
	'[23~': { name: 'f11' },
	'[24~': { name: 'f12' },

	/* paste bracket mode */
	'[200~': { name: 'paste-start' },
	'[201~': { name: 'paste-end' },

	/* rxvt keys with modifiers */
	'[a': { name: 'up', shift: true },
	'[b': { name: 'down', shift: true },
	'[c': { name: 'right', shift: true },
	'[d': { name: 'left', shift: true },
	'[e': { name: 'clear', shift: true },

	/* from Cygwin and used in libuv */
	'[[A': { name: 'f1' },
	'[[B': { name: 'f2' },
	'[[C': { name: 'f3' },
	'[[D': { name: 'f4' },
	'[[E': { name: 'f5' },

	/* putty */
	'[[5~': { name: 'pageup' },
	'[[6~': { name: 'pagedown' },

	'[2$': { name: 'insert', shift: true },
	'[3$': { name: 'delete', shift: true },
	'[5$': { name: 'pageup', shift: true },
	'[6$': { name: 'pagedown', shift: true },
	'[7$': { name: 'home', shift: true },
	'[8$': { name: 'end', shift: true },

	Oa: { name: 'up', ctrl: true },
	Ob: { name: 'down', ctrl: true },
	Oc: { name: 'right', ctrl: true },
	Od: { name: 'left', ctrl: true },
	Oe: { name: 'clear', ctrl: true },

	'[2^': { name: 'insert', ctrl: true },
	'[3^': { name: 'delete', ctrl: true },
	'[5^': { name: 'pageup', ctrl: true },
	'[6^': { name: 'pagedown', ctrl: true },
	'[7^': { name: 'home', ctrl: true },
	'[8^': { name: 'end', ctrl: true },

	/* misc. */
	'[Z': { name: 'tab', shift: true },
	undefined: { name: 'undefined' },
};

/**
 * This is an absolute monstrosity.
 * It's good enough though.
 */
function _parseKey(sequence: string): readline.Key {
	const key: readline.Key = {
		sequence,
		name: undefined,
		ctrl: false,
		meta: false,
		shift: false,
	};

	if (sequence in _unescaped) {
		key.name = _unescaped[sequence as keyof typeof _unescaped];
		key.meta = sequence.startsWith('\x1b');
		return key;
	}

	if (sequence.length == 1 && sequence.charCodeAt(0) >= 32) {
		key.name = sequence.toLowerCase();
		key.shift = sequence >= 'A' && sequence <= 'Z';
		return key;
	}

	if (sequence.length == 1) {
		key.ctrl = true;
		key.name = String.fromCharCode(sequence.charCodeAt(0) + 64).toLowerCase();
		return key;
	}

	if (sequence.length == 2 && sequence[0] == '\x1b' && sequence[1] >= ' ') {
		key.meta = true;
		key.name = sequence[1].toLowerCase();
		key.shift = sequence[1] >= 'A' && sequence[1] <= 'Z';
		return key;
	}

	if (!sequence.startsWith('\x1b')) return key;
	const rest = sequence.slice(1);

	if (rest in _escaped) {
		Object.assign(key, _escaped[rest]);
		return key;
	}

	if ((!rest.startsWith('[') && !rest.startsWith('O')) || !rest.length) {
		key.meta = true;
		return key;
	}

	// Format: \x1b[Num;ModifierChar or \x1b[;ModifierChar
	const match = /^\[((\d+)?(;\d+)?([~^$A-Za-z]))\]?$/.exec(rest);
	if (match) {
		const modifier = match[3] ? parseInt(match[3].slice(1), 10) : 1;

		const baseCode = '[' + (match[2] || '') + match[4];
		if (baseCode in _escaped) {
			Object.assign(key, _escaped[baseCode]);

			key.shift = !!(modifier & 1);
			key.meta = !!(modifier & 2) || !!(modifier & 8);
			key.ctrl = !!(modifier & 4);
			return key;
		}
	}

	// Check for 3-digit codes (paste mode, etc.)
	const [, digits] = /^\[(\d{3})~$/.exec(rest) || [];
	if (digits) {
		const code = `[${digits}~`;
		if (code in _escaped) {
			Object.assign(key, _escaped[code]);
			return key;
		}
	}

	key.meta = true;
	return key;
}

/**
 * The `readline.emitKeypressEvents()` method causes the given Readable stream to begin emitting `'keypress'` events corresponding to received input.
 *
 * Optionally, interface specifies a `readline.Interface` instance for which autocompletion is disabled when copy-pasted input is detected.
 *
 * If the `stream` is a TTY, then it must be in raw mode.
 *
 * This is automatically called by any readline instance on its `input` if the `input` is a terminal. Closing the `readline` instance does not stop the `input` from emitting `'keypress'` events.
 */
export function emitKeypressEvents(stream: NodeJS.ReadableStream, readlineInterface?: Interface | readline.Interface): void {
	stream.on('data', (buffer: Buffer) => {
		const str = buffer.toString('utf8');
		stream.emit('keypress', str, _parseKey(str));
	});

	if (!readlineInterface) return;

	stream.on('data', data => {
		if (data.toString('utf8').includes('\u0003')) {
			readlineInterface.emit('SIGINT');
		}
	});
}
emitKeypressEvents satisfies typeof readline.emitKeypressEvents;

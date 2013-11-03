/// <reference path="../../vendor/DefinitelyTyped/node/node.d.ts" />
import string_util = require('./string_util');
import buffer_static = require('./buffer_static');

/**
 * Emulation of Node's `Buffer` class. Normally, this is declared globally, but I
 * make that behavior optional.
 *
 * The buffer is backed by a `DataView`; we have a polyfill in `vendor` that
 * handles compatibility for us.
 *
 * @see http://nodejs.org/api/buffer.html
 * @todo Add option to add array accessors, if someone doesn't mind the *huge*
 *       speed hit for compatibility.
 * @class
 */
export class Buffer extends buffer_static.BufferStatic implements NodeBuffer {
  /**
   * Added to satisfy TypeScript NodeBuffer typing.
   */
  public static INSPECT_MAX_BYTES: number = 0;
  // XXX: :| HTML5FS directly copies this.
  public buff: DataView;
  public length: number;

  /**
   * Constructs a buffer.
   * @param {(number|DataView|ArrayBuffer|Buffer|string)} arg1 - Instantiate a buffer of the indicated size, or
   *   from the indicated Array or String.
   * @param {string} [arg2=utf8] - Encoding to use if arg1 is a string
   */
  constructor (size: number);
  constructor (data: any[]);
  constructor (data: DataView);
  constructor (data: ArrayBuffer);
  constructor (data: NodeBuffer);
  constructor (data: string, encoding?: string);
  constructor (arg1: any, arg2='utf8') {
    super();
    var i;
    // Node apparently allows you to construct buffers w/o 'new'.
    if (!(this instanceof Buffer)) {
      return new Buffer(arg1, arg2);
    }

    if (typeof arg1 === 'number') {
      // constructor (size: number);
      if (arg1 !== (arg1 >>> 0)) {
        throw new TypeError('Buffer size must be a uint32.');
      }
      this.length = arg1;
      this.buff = new DataView(new ArrayBuffer(this.length));
    } else if (arg1 instanceof DataView) {
      // constructor (data: DataView);
      this.buff = arg1;
      this.length = arg1.byteLength;
    } else if (arg1 instanceof ArrayBuffer) {
      // constructor (data: ArrayBuffer);
      this.buff = new DataView(arg1);
      this.length = arg1.byteLength;
    } else if (arg1 instanceof Buffer) {
      // constructor (data: Buffer);
      this.buff = new DataView(new ArrayBuffer(arg1.length));
      for (i = 0; i < arg1.length; i++) {
        this.buff.setUint8(i, arg1.get(i));
      }
      this.length = arg1.length;
    } else if (Array.isArray(arg1) || (arg1 != null && typeof arg1 === 'object' && typeof arg1[0] === 'number')) {
      // constructor (data: number[]);
      this.buff = new DataView(new ArrayBuffer(arg1.length));
      for (i = 0; i < arg1.length; i++) {
        this.buff.setUint8(i, arg1[i]);
      }
      this.length = arg1.length;
    } else if (typeof arg1 === 'string') {
      // constructor (data: string, encoding?: string);
      this.length = Buffer.byteLength(arg1, arg2);
      this.buff = new DataView(new ArrayBuffer(this.length));
      this.write(arg1, 0, this.length, arg2);
    } else {
      throw new Error("Invalid argument to Buffer constructor: " + arg1);
    }
  }

  /**
   * **NONSTANDARD**: Set the octet at index. The values refer to individual
   * bytes, so the legal range is between 0x00 and 0xFF hex or 0 and 255.
   * @param {number} index - the index to set the value at
   * @param {number} value - the value to set at the given index
   */
  public set(index: number, value: number) {
    return this.buff.setUint8(index, value);
  }

  /**
   * **NONSTANDARD**: Get the octet at index.
   * @param {number} index - index to fetch the value at
   * @return {number} the value at the given index
   */
  public get(index: number): number {
    return this.buff.getUint8(index);
  }

  /**
   * Writes string to the buffer at offset using the given encoding.
   * If buffer did not contain enough space to fit the entire string, it will
   * write a partial amount of the string.
   * @param {string} str - Data to be written to buffer
   * @param {number} [offset=0] - Offset in the buffer to write to
   * @param {number} [length=this.length] - Number of bytes to write
   * @param {string} [encoding=utf8] - Character encoding
   * @return {number} Number of octets written.
   */
  public write(str: string, offset = 0, length = this.length, encoding = 'utf8'): number {
    // I hate Node's optional arguments.
    if (typeof offset === 'string') {
      // 'str' and 'encoding' specified
      encoding = "" + offset;
      offset = 0;
      length = this.length;
    } else if (typeof length === 'string') {
      // 'str', 'offset', and 'encoding' specified
      encoding = "" + length;
      length = this.length;
    }
    // Don't waste our time if the offset is beyond the buffer length
    if (offset >= this.length) {
      return 0;
    }
    var strUtil = string_util.FindUtil(encoding);
    // Are we trying to write past the buffer?
    length = length + offset > this.length ? this.length - offset : length;
    return strUtil.str2byte(this, str, offset, length);
  }

  /**
   * Decodes a portion of the Buffer into a String.
   * @param {string} encoding - Character encoding to decode to
   * @param {number} [start=0] - Start position in the buffer
   * @param {number} [end=this.length] - Ending position in the buffer
   * @return {string} A string from buffer data encoded with encoding, beginning
   *   at start, and ending at end.
   */
  public toString(encoding = 'utf8', start = 0, end = this.length): string {
    if (!(start <= end)) {
      throw new Error("Invalid start/end positions: " + start + " - " + end);
    }
    if (start === end) {
      return '';
    }
    if (end > this.length) {
      end = this.length;
    }
    var strUtil = string_util.FindUtil(encoding);
    var len = end - start;
    // Create a byte array of the needed characters.
    var byteArr = new Array(len);
    for (var i = 0; i < len; i++) {
      byteArr[i] = this.readUInt8(start + i);
    }
    return strUtil.byte2str(byteArr);
  }

  /**
   * Returns a JSON-representation of the Buffer instance, which is identical to
   * the output for JSON Arrays. JSON.stringify implicitly calls this function
   * when stringifying a Buffer instance.
   * @return {object} An object that can be used for JSON stringification.
   */
  public toJSON(): {type: string; data: number[]} {
    var arr = new Array(this.length);
    for (var i = 0; i < this.length; i++) {
      arr[i] = this.buff.getUint8(i);
    }
    return {
      type: 'Buffer',
      data: arr
    };
  }

  /**
   * Does copy between buffers. The source and target regions can be overlapped.
   * All values passed that are undefined/NaN or are out of bounds are set equal
   * to their respective defaults.
   * @param {Buffer} target - Buffer to copy into
   * @param {number} [targetStart=0] - Index to start copying to in the targetBuffer
   * @param {number} [sourceStart=0] - Index in this buffer to start copying from
   * @param {number} [sourceEnd=this.length] - Index in this buffer stop copying at
   * @return {number} The number of bytes copied into the target buffer.
   */
  public copy(target: NodeBuffer, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    // The Node code is weird. It sets some out-of-bounds args to their defaults
    // and throws exceptions for others (sourceEnd).
    targetStart = targetStart < 0 ? 0 : targetStart;
    sourceStart = sourceStart < 0 ? 0 : sourceStart;

    // Need to sanity check all of the input. Node has really odd rules regarding
    // when to apply default arguments. I decided to copy Node's logic.
    if (sourceEnd < sourceStart) {
      throw new RangeError('sourceEnd < sourceStart');
    }
    if (sourceEnd === sourceStart) {
      return 0;
    }
    if (targetStart >= target.length) {
      throw new RangeError('targetStart out of bounds');
    }
    if (sourceStart >= this.length) {
      throw new RangeError('sourceStart out of bounds');
    }
    if (sourceEnd > this.length) {
      throw new RangeError('sourceEnd out of bounds');
    }
    var bytesCopied = Math.min(sourceEnd - sourceStart, target.length - targetStart, this.length - sourceStart);
    for (var i = 0; i < bytesCopied; i++) {
      target.writeUInt8(this.readUInt8(sourceStart + i), targetStart + i);
    }
    return bytesCopied;
  }

  /**
   * Returns a slice of this buffer.
   * @param {number} [start=0] - Index to start slicing from
   * @param {number} [end=this.length] - Index to stop slicing at
   * @return {Buffer} A new buffer which references the same
   *   memory as the old, but offset and cropped by the start (defaults to 0) and
   *   end (defaults to buffer.length) indexes. Negative indexes start from the end
   *   of the buffer.
   */
  public slice(start = 0, end = this.length): NodeBuffer {
    // Translate negative indices to positive ones.
    if (start < 0) {
      start += this.length;
      if (start < 0) {
        start = 0;
      }
    }
    if (end < 0) {
      end += this.length;
      if (end < 0) {
        end = 0;
      }
    }
    if (end > this.length) {
      end = this.length;
    }
    if (start > end) {
      start = end;
    }

    // Sanity check.
    if (start < 0 || end < 0 || start >= this.length || end > this.length) {
      throw new Error("Invalid slice indices.");
    }
    return new Buffer(new DataView(this.buff.buffer, this.buff.byteOffset + start, end - start));
  }

  /**
   * Fills the buffer with the specified value. If the offset and end are not
   * given it will fill the entire buffer.
   * @param {(string|number)} value - The value to fill the buffer with
   * @param {number} [offset=0]
   * @param {number} [end=this.length]
   */
  public fill(value: any, offset = 0, end = this.length): void {
    var i;
    var valType = typeof value;
    switch (valType) {
      case "string":
        // Trim to a byte.
        value = value.charCodeAt(0) & 0xFF;
        break;
      case "number":
        break;
      default:
        throw new Error('Invalid argument to fill.');
    }
    var val32 = value | (value << 8) | (value << 16) | (value << 24);
    var num32 = Math.floor((end - offset) / 4);
    var remSt = offset + num32 * 4;
    // OPTIMIZATION: 4X faster to write 32 bits at a time.
    for (i = 0; i < num32; i++) {
      this.writeUInt32LE(val32, offset + i * 4);
    }
    for (i = remSt; i < end; i++) {
      this.writeUInt8(value, i);
    }
  }

  // Numerical read/write methods
  // @todo Actually care about noAssert.

  public readUInt8(offset: number, noAssert = false): number {
    return this.buff.getUint8(offset);
  }

  public readUInt16LE(offset: number, noAssert = false): number {
    return this.buff.getUint16(offset, true);
  }

  public readUInt16BE(offset: number, noAssert = false): number {
    return this.buff.getUint16(offset, false);
  }

  public readUInt32LE(offset: number, noAssert = false): number {
    return this.buff.getUint32(offset, true);
  }

  public readUInt32BE(offset: number, noAssert = false): number {
    return this.buff.getUint32(offset, false);
  }

  public readInt8(offset: number, noAssert = false): number {
    return this.buff.getInt8(offset);
  }

  public readInt16LE(offset: number, noAssert = false): number {
    return this.buff.getInt16(offset, true);
  }

  public readInt16BE(offset: number, noAssert = false): number {
    return this.buff.getInt16(offset, false);
  }

  public readInt32LE(offset: number, noAssert = false): number {
    return this.buff.getInt32(offset, true);
  }

  public readInt32BE(offset: number, noAssert = false): number {
    return this.buff.getInt32(offset, false);
  }

  public readFloatLE(offset: number, noAssert = false): number {
    return this.buff.getFloat32(offset, true);
  }

  public readFloatBE(offset: number, noAssert = false): number {
    return this.buff.getFloat32(offset, false);
  }

  public readDoubleLE(offset: number, noAssert = false): number {
    return this.buff.getFloat64(offset, true);
  }

  public readDoubleBE(offset: number, noAssert = false): number {
    return this.buff.getFloat64(offset, false);
  }

  public writeUInt8(value: number, offset: number, noAssert = false): void {
    this.buff.setUint8(offset, value);
  }

  public writeUInt16LE(value: number, offset: number, noAssert = false): void {
    this.buff.setUint16(offset, value, true);
  }

  public writeUInt16BE(value: number, offset: number, noAssert = false): void {
    this.buff.setUint16(offset, value, false);
  }

  public writeUInt32LE(value: number, offset: number, noAssert = false): void {
    this.buff.setUint32(offset, value, true);
  }

  public writeUInt32BE(value: number, offset: number, noAssert = false): void {
    this.buff.setUint32(offset, value, false);
  }

  public writeInt8(value: number, offset: number, noAssert = false): void {
    this.buff.setInt8(offset, value);
  }

  public writeInt16LE(value: number, offset: number, noAssert = false): void {
    this.buff.setInt16(offset, value, true);
  }

  public writeInt16BE(value: number, offset: number, noAssert = false): void {
    this.buff.setInt16(offset, value, false);
  }

  public writeInt32LE(value: number, offset: number, noAssert = false): void {
    this.buff.setInt32(offset, value, true);
  }

  public writeInt32BE(value: number, offset: number, noAssert = false): void {
    this.buff.setInt32(offset, value, false);
  }

  public writeFloatLE(value: number, offset: number, noAssert = false): void {
    this.buff.setFloat32(offset, value, true);
  }

  public writeFloatBE(value: number, offset: number, noAssert = false): void {
    this.buff.setFloat32(offset, value, false);
  }

  public writeDoubleLE(value: number, offset: number, noAssert = false): void {
    this.buff.setFloat64(offset, value, true);
  }

  public writeDoubleBE(value: number, offset: number, noAssert = false): void {
    this.buff.setFloat64(offset, value, false);
  }
}

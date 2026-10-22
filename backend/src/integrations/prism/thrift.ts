/**
 * Minimal Apache Thrift implementation: TBinaryProtocol (strict) over
 * TFramedTransport - exactly what the Prism token API speaks. Hand-rolled so
 * the three RPCs TokenPap needs don't drag in the full `thrift` npm runtime
 * and its generated-code toolchain.
 *
 * Spec: https://github.com/apache/thrift/blob/master/doc/specs/thrift-binary-protocol.md
 */

export const TType = {
  STOP: 0,
  BOOL: 2,
  BYTE: 3,
  DOUBLE: 4,
  I16: 6,
  I32: 8,
  I64: 10,
  STRING: 11,
  STRUCT: 12,
  MAP: 13,
  SET: 14,
  LIST: 15,
} as const;
export type TTypeId = (typeof TType)[keyof typeof TType];

export const TMessageType = { CALL: 1, REPLY: 2, EXCEPTION: 3, ONEWAY: 4 } as const;

const VERSION_1 = 0x80010000;

/** A field to write: omitted entirely when `value` is null/undefined (Thrift optional semantics). */
export interface FieldSpec {
  id: number;
  type: TTypeId;
  value: unknown;
  /** For STRUCT fields: the nested fields. */
  fields?: FieldSpec[];
}

/** Decoded struct: field id → value (nested structs are DecodedStruct, lists are arrays). */
export type DecodedStruct = Map<number, unknown>;

// ── Writer ───────────────────────────────────────────────────────────────────

export class ThriftWriter {
  private chunks: Buffer[] = [];

  private push(buf: Buffer) {
    this.chunks.push(buf);
  }

  byte(v: number) {
    const b = Buffer.alloc(1);
    b.writeInt8(v, 0);
    this.push(b);
  }

  bool(v: boolean) {
    this.byte(v ? 1 : 0);
  }

  i16(v: number) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(v, 0);
    this.push(b);
  }

  i32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v | 0, 0);
    this.push(b);
  }

  i64(v: number | bigint) {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(BigInt(v), 0);
    this.push(b);
  }

  double(v: number) {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(v, 0);
    this.push(b);
  }

  string(v: string) {
    const data = Buffer.from(v, 'utf8');
    this.i32(data.length);
    this.push(data);
  }

  messageBegin(name: string, type: number, seqId: number) {
    this.i32((VERSION_1 | type) >> 0);
    this.string(name);
    this.i32(seqId);
  }

  struct(fields: FieldSpec[]) {
    for (const field of fields) {
      if (field.value === null || field.value === undefined) continue;
      this.byte(field.type);
      this.i16(field.id);
      this.value(field);
    }
    this.byte(TType.STOP);
  }

  private value(field: FieldSpec) {
    const v = field.value;
    switch (field.type) {
      case TType.BOOL: return this.bool(Boolean(v));
      case TType.BYTE: return this.byte(Number(v));
      case TType.I16: return this.i16(Number(v));
      case TType.I32: return this.i32(Number(v));
      case TType.I64: return this.i64(v as number | bigint);
      case TType.DOUBLE: return this.double(Number(v));
      case TType.STRING: return this.string(String(v));
      case TType.STRUCT: return this.struct(field.fields ?? []);
      default:
        throw new Error(`ThriftWriter: unsupported field type ${field.type}`);
    }
  }

  /** The payload wrapped in a TFramedTransport frame (4-byte big-endian length prefix). */
  toFrame(): Buffer {
    const payload = Buffer.concat(this.chunks);
    const header = Buffer.alloc(4);
    header.writeInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
  }
}

// ── Reader ───────────────────────────────────────────────────────────────────

export class ThriftReader {
  private offset = 0;

  constructor(private buf: Buffer) {}

  private ensure(n: number) {
    if (this.offset + n > this.buf.length) throw new Error('ThriftReader: unexpected end of frame');
  }

  byte(): number {
    this.ensure(1);
    const v = this.buf.readInt8(this.offset);
    this.offset += 1;
    return v;
  }

  bool(): boolean {
    return this.byte() !== 0;
  }

  i16(): number {
    this.ensure(2);
    const v = this.buf.readInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  i32(): number {
    this.ensure(4);
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  i64(): bigint {
    this.ensure(8);
    const v = this.buf.readBigInt64BE(this.offset);
    this.offset += 8;
    return v;
  }

  double(): number {
    this.ensure(8);
    const v = this.buf.readDoubleBE(this.offset);
    this.offset += 8;
    return v;
  }

  string(): string {
    const len = this.i32();
    this.ensure(len);
    const v = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return v;
  }

  messageBegin(): { name: string; type: number; seqId: number } {
    const first = this.i32();
    if (first < 0) {
      // Strict: version | type, then name, then seqid.
      const version = first & 0xffff0000;
      if (version >> 0 !== VERSION_1 >> 0) throw new Error('ThriftReader: bad protocol version');
      const type = first & 0x000000ff;
      const name = this.string();
      const seqId = this.i32();
      return { name, type, seqId };
    }
    // Non-strict: `first` was the name length.
    this.offset -= 4;
    const name = this.string();
    const type = this.byte();
    const seqId = this.i32();
    return { name, type, seqId };
  }

  struct(): DecodedStruct {
    const out: DecodedStruct = new Map();
    for (;;) {
      const type = this.byte();
      if (type === TType.STOP) break;
      const id = this.i16();
      out.set(id, this.value(type));
    }
    return out;
  }

  value(type: number): unknown {
    switch (type) {
      case TType.BOOL: return this.bool();
      case TType.BYTE: return this.byte();
      case TType.I16: return this.i16();
      case TType.I32: return this.i32();
      case TType.I64: return this.i64();
      case TType.DOUBLE: return this.double();
      case TType.STRING: return this.string();
      case TType.STRUCT: return this.struct();
      case TType.LIST:
      case TType.SET: {
        const elemType = this.byte();
        const size = this.i32();
        const items: unknown[] = [];
        for (let i = 0; i < size; i++) items.push(this.value(elemType));
        return items;
      }
      case TType.MAP: {
        const keyType = this.byte();
        const valType = this.byte();
        const size = this.i32();
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < size; i++) map.set(this.value(keyType), this.value(valType));
        return map;
      }
      default:
        throw new Error(`ThriftReader: unsupported type ${type}`);
    }
  }
}

/** Reads a string field from a decoded struct, or undefined. */
export function str(s: DecodedStruct | undefined, id: number): string | undefined {
  const v = s?.get(id);
  return typeof v === 'string' ? v : undefined;
}

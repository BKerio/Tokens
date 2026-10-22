import tls from 'node:tls';
import crypto from 'node:crypto';
import type { Logger } from '../../lib/logger.js';
import { DecodedStruct, FieldSpec, TMessageType, TType, ThriftReader, ThriftWriter, str } from './thrift.js';

/**
 * Client for the Prism STS token vending API (Thrift binary/framed over TLS) -
 * the Node port of the legacy PrismTokenService + generated PHP TokenApiClient.
 *
 * Only the three RPCs TokenPap uses are implemented: signInWithPassword,
 * issueCreditToken and issueSetControlToken. Field ids/types mirror the
 * PrismToken1 IDL exactly.
 */

/** STS meter key data sent with every vend (Prism `MeterConfigIn`). */
export interface MeterConfigIn {
  drn: string; // meter number
  ea: number;
  tct: number;
  sgc: number;
  krn: number;
  ti: number;
  ken: number;
  allowKrnUpdate?: boolean;
}

/** The fields of a Prism `Token` TokenPap cares about. */
export interface IssuedToken {
  drn?: string;
  tokenDec?: string;
  tokenHex?: string;
  description?: string;
  stsUnitName?: string;
  scaledAmount?: string;
  scaledUnitName?: string;
  transferAmount?: number;
}

/** Prism's declared `ApiException` (business error, e.g. unknown meter, bad SGC). */
export class PrismApiError extends Error {
  constructor(public readonly eCode: string, public readonly eMsgEn: string) {
    super(`Prism error ${eCode}: ${eMsgEn}`);
    this.name = 'PrismApiError';
  }
}

export interface PrismClientOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  realm: string;
  /** Verify the server certificate chain. The legacy client accepted self-signed certs. */
  rejectUnauthorized: boolean;
  connectTimeoutMs?: number;
  recvTimeoutMs?: number;
  log?: Logger;
}

function generateMessageId(): string {
  // Same shape as the PHP client: "%10d-%s" (unix time, 16 hex chars).
  const time = Math.floor(Date.now() / 1000).toString().padStart(10, ' ');
  return `${time}-${crypto.randomBytes(8).toString('hex')}`;
}

function meterConfigFields(m: MeterConfigIn): FieldSpec[] {
  return [
    { id: 1, type: TType.STRING, value: m.drn },
    { id: 2, type: TType.I16, value: m.ea },
    { id: 3, type: TType.I16, value: m.tct },
    { id: 10, type: TType.I32, value: m.sgc },
    { id: 11, type: TType.I16, value: m.krn },
    { id: 12, type: TType.I16, value: m.ti },
    { id: 21, type: TType.BOOL, value: m.allowKrnUpdate ?? false },
    { id: 30, type: TType.I16, value: m.ken },
  ];
}

function decodeToken(s: DecodedStruct): IssuedToken {
  const transfer = s.get(13);
  return {
    drn: str(s, 1),
    transferAmount: typeof transfer === 'number' ? transfer : undefined,
    description: str(s, 20),
    stsUnitName: str(s, 21),
    scaledAmount: str(s, 22),
    scaledUnitName: str(s, 23),
    tokenDec: str(s, 30),
    tokenHex: str(s, 31),
  };
}

/** Normalizes a configured host ("https://host:9443" → "host"). */
function cleanHost(raw: string): string {
  let host = raw.trim().replace(/^https?:\/\//i, '');
  const m = host.match(/^([^:/]+)(:\d+)?/);
  if (m) host = m[1]!;
  return host;
}

export class PrismClient {
  private socket: tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private pending: { resolve: (frame: Buffer) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  private seqId = 0;
  private accessToken: string | null = null;
  private _lastMessageId: string | null = null;

  constructor(private opts: PrismClientOptions) {}

  get lastMessageId(): string | null {
    return this._lastMessageId;
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    const host = cleanHost(this.opts.host);
    const port = this.opts.port;
    this.opts.log?.info(`Connecting to Prism API at ${host}:${port}`);

    this.socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: this.opts.rejectUnauthorized,
        // Legacy client disabled peer-name verification.
        checkServerIdentity: this.opts.rejectUnauthorized ? undefined : () => undefined,
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Prism connection timed out (${host}:${port})`));
      }, this.opts.connectTimeoutMs ?? 15_000);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Prism socket error: ${err.message}`));
      });
    });

    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('error', (err) => this.failPending(new Error(`Prism socket error: ${err.message}`)));
    this.socket.on('close', () => {
      this.failPending(new Error('Prism connection closed'));
      this.socket = null;
    });
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readInt32BE(0);
      if (this.buffer.length < 4 + len) return;
      const frame = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      const p = this.pending;
      this.pending = null;
      if (p) {
        clearTimeout(p.timer);
        p.resolve(Buffer.from(frame));
      }
    }
  }

  private failPending(err: Error) {
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  /** Sends one RPC and returns the decoded result struct (field 0 = success, 1 = ex1). */
  private async call(method: string, args: FieldSpec[]): Promise<DecodedStruct> {
    await this.connect();
    const socket = this.socket!;
    const seqId = ++this.seqId;

    const writer = new ThriftWriter();
    writer.messageBegin(method, TMessageType.CALL, seqId);
    writer.struct(args);

    const frame = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Prism ${method} timed out`));
      }, this.opts.recvTimeoutMs ?? 15_000);
      this.pending = { resolve, reject, timer };
      socket.write(writer.toFrame());
    });

    const reader = new ThriftReader(frame);
    const header = reader.messageBegin();
    if (header.type === TMessageType.EXCEPTION) {
      const ex = reader.struct();
      throw new Error(`Prism ${method} application exception: ${str(ex, 1) ?? 'unknown'}`);
    }
    if (header.seqId !== seqId) throw new Error(`Prism ${method}: out-of-order reply`);

    const result = reader.struct();
    const ex1 = result.get(1) as DecodedStruct | undefined;
    if (ex1) throw new PrismApiError(str(ex1, 1) ?? 'UNKNOWN', str(ex1, 2) ?? 'Unknown Prism error');
    return result;
  }

  async signIn(): Promise<string> {
    const result = await this.call('signInWithPassword', [
      { id: 1, type: TType.STRING, value: generateMessageId() },
      { id: 2, type: TType.STRING, value: this.opts.realm },
      { id: 3, type: TType.STRING, value: this.opts.username },
      { id: 4, type: TType.STRING, value: this.opts.password },
      // SessionOptions with no fields set - matches `new SessionOptions()` in PHP.
      { id: 5, type: TType.STRUCT, value: {}, fields: [] },
    ]);
    const success = result.get(0) as DecodedStruct | undefined;
    const token = str(success, 1);
    if (!token) throw new Error('Prism signInWithPassword returned no access token');
    this.accessToken = token;
    return token;
  }

  private async ensureSignedIn(): Promise<string> {
    return this.accessToken ?? this.signIn();
  }

  async issueCreditToken(meter: MeterConfigIn, amount: number, subclass = 0): Promise<IssuedToken[]> {
    const accessToken = await this.ensureSignedIn();
    this._lastMessageId = generateMessageId();
    const result = await this.call('issueCreditToken', [
      { id: 1, type: TType.STRING, value: this._lastMessageId },
      { id: 2, type: TType.STRING, value: accessToken },
      { id: 3, type: TType.STRUCT, value: {}, fields: meterConfigFields(meter) },
      { id: 4, type: TType.I16, value: subclass },
      { id: 5, type: TType.DOUBLE, value: amount },
      { id: 6, type: TType.I64, value: 0 }, // tokenTime: now
      { id: 7, type: TType.I64, value: 0 }, // flags
    ]);
    return ((result.get(0) as DecodedStruct[] | undefined) ?? []).map(decodeToken);
  }

  async issueSetControlToken(meter: MeterConfigIn, isFlag: boolean, index: number, value: number): Promise<IssuedToken[]> {
    const accessToken = await this.ensureSignedIn();
    this._lastMessageId = generateMessageId();
    const result = await this.call('issueSetControlToken', [
      { id: 1, type: TType.STRING, value: this._lastMessageId },
      { id: 2, type: TType.STRING, value: accessToken },
      { id: 3, type: TType.STRUCT, value: {}, fields: meterConfigFields(meter) },
      { id: 4, type: TType.BOOL, value: isFlag },
      { id: 5, type: TType.I16, value: index },
      { id: 6, type: TType.I16, value: value },
      { id: 7, type: TType.I64, value: 0 },
      { id: 8, type: TType.I64, value: 0 },
    ]);
    return ((result.get(0) as DecodedStruct[] | undefined) ?? []).map(decodeToken);
  }

  close(): void {
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
    this.accessToken = null;
  }
}

/** Token digits as stored/sent to customers (decimal preferred, hex fallback). */
export function tokenStrings(tokens: IssuedToken[]): string[] {
  return tokens.map((t) => t.tokenDec ?? t.tokenHex).filter((t): t is string => !!t);
}

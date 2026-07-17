// SPDX-License-Identifier: Apache-2.0

// A browser-side ModDef Transport (spec §32.3) that speaks Modbus RTU directly
// over the Web Serial API. `@moddef/transport-modbus-serial` is Node-only, so
// the docs live-dashboard needs its own client: RTU framing + CRC16 over a
// navigator.serial port. Offsets are 0-based wire addresses (spec §7.1).
//
// Web Serial is half-duplex and gives one reader/writer lock at a time, so every
// transaction is serialized through a FIFO promise queue.

import {TransportError, type Transport, type TransportOpts} from '@moddef/core';

// Minimal Web Serial typings (avoids a dependency on @types/w3c-web-serial).
type SerialParity = 'none' | 'even' | 'odd';
interface SerialOpenOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: SerialParity;
}
interface SerialPortLike {
  open(options: SerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(options?: unknown): Promise<SerialPortLike>;
}

export function webSerialAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export interface WebSerialOptions {
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: SerialParity;
  /** Default Modbus unit/slave id (per-call override via TransportOpts). */
  unitId?: number;
  /** Response timeout in milliseconds (default 1500). */
  timeoutMs?: number;
  /** Cap on registers per read request (default 125, the Modbus maximum). */
  maxReadWords?: number;
}

// Modbus RTU CRC16 (poly 0xA001, init 0xFFFF), returned low byte first.
function crc16(bytes: Uint8Array, len: number): [number, number] {
  let crc = 0xffff;
  for (let i = 0; i < len; i++) {
    crc ^= bytes[i]!;
    for (let b = 0; b < 8; b++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return [crc & 0xff, (crc >> 8) & 0xff];
}

const EXCEPTION_TEXT: Record<number, string> = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'slave device failure',
  6: 'slave device busy',
};

export class WebSerialTransport implements Transport {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly port: SerialPortLike,
    private readonly opts: Required<Omit<WebSerialOptions, 'unitId'>> & {unitId: number},
  ) {}

  /** Prompt the user to pick a serial port, open it, and wrap it. */
  static async open(options: WebSerialOptions = {}): Promise<WebSerialTransport> {
    if (!webSerialAvailable()) {
      throw new TransportError('Web Serial is not available in this browser (use Chrome or Edge)');
    }
    const serial = (navigator as unknown as {serial: SerialLike}).serial;
    const port = await serial.requestPort();
    const resolved = {
      baudRate: options.baudRate ?? 9600,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? 'none',
      timeoutMs: options.timeoutMs ?? 1500,
      maxReadWords: options.maxReadWords ?? 125,
      unitId: options.unitId ?? 1,
    };
    await port.open({
      baudRate: resolved.baudRate,
      dataBits: resolved.dataBits,
      stopBits: resolved.stopBits,
      parity: resolved.parity,
    });
    return new WebSerialTransport(port, resolved);
  }

  async close(): Promise<void> {
    try {
      await this.port.close();
    } catch {
      /* already closed */
    }
  }

  // Serialize every transaction: RTU is half-duplex and Web Serial hands out one
  // reader/writer lock at a time.
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async transact(unitId: number, pdu: number[], expected: number): Promise<Uint8Array> {
    // ADU = unit id + PDU + CRC16.
    const frame = new Uint8Array(1 + pdu.length + 2);
    frame[0] = unitId & 0xff;
    frame.set(pdu, 1);
    const [lo, hi] = crc16(frame, 1 + pdu.length);
    frame[1 + pdu.length] = lo;
    frame[frame.length - 1] = hi;

    if (!this.port.writable) throw new TransportError('serial port is not writable');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(frame);
    } finally {
      writer.releaseLock();
    }

    return this.readResponse(unitId, pdu[0]!, expected);
  }

  private async readResponse(unitId: number, fc: number, expected: number): Promise<Uint8Array> {
    if (!this.port.readable) throw new TransportError('serial port is not readable');
    const reader = this.port.readable.getReader();
    const chunks: number[] = [];
    // Full frame length: `expected` PDU/CRC bytes, unless it's an exception (5).
    let need = expected;
    const deadline = Date.now() + this.opts.timeoutMs;
    try {
      while (chunks.length < need) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new TransportError('modbus response timed out');
        const {value, done} = await withTimeout(reader.read(), remaining);
        if (done) break;
        if (value) {
          for (const b of value) chunks.push(b);
          // Detect an exception response as soon as the function code arrives.
          if (chunks.length >= 2 && (chunks[1]! & 0x80) !== 0) need = 5;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const buf = Uint8Array.from(chunks);
    if (buf.length < 5) throw new TransportError('short modbus response');
    // CRC check over everything but the trailing 2 CRC bytes.
    const [lo, hi] = crc16(buf, need - 2);
    if (buf[need - 2] !== lo || buf[need - 1] !== hi) {
      throw new TransportError('modbus CRC mismatch');
    }
    if (buf[0] !== unitId) throw new TransportError(`unexpected unit id ${buf[0]}`);
    if ((buf[1]! & 0x80) !== 0) {
      const code = buf[2]!;
      throw new TransportError(`modbus exception: ${EXCEPTION_TEXT[code] ?? `code ${code}`}`, code);
    }
    if (buf[1] !== fc) throw new TransportError(`unexpected function code ${buf[1]}`);
    return buf.subarray(0, need);
  }

  private async readRegisters(
    fc: 0x03 | 0x04,
    offset: number,
    quantity: number,
    opts?: TransportOpts,
  ): Promise<Uint16Array> {
    const unitId = opts?.unitId ?? this.opts.unitId;
    const out = new Uint16Array(quantity);
    let done = 0;
    while (done < quantity) {
      const q = Math.min(quantity - done, this.opts.maxReadWords);
      const addr = offset + done;
      const pdu = [fc, (addr >> 8) & 0xff, addr & 0xff, (q >> 8) & 0xff, q & 0xff];
      const resp = await this.run(() => this.transact(unitId, pdu, 5 + q * 2));
      // resp = [unit, fc, byteCount, data...]
      for (let i = 0; i < q; i++) {
        out[done + i] = (resp[3 + i * 2]! << 8) | resp[4 + i * 2]!;
      }
      done += q;
    }
    return out;
  }

  readHolding(offset: number, quantity: number, opts?: TransportOpts): Promise<Uint16Array> {
    return this.readRegisters(0x03, offset, quantity, opts);
  }

  readInput(offset: number, quantity: number, opts?: TransportOpts): Promise<Uint16Array> {
    return this.readRegisters(0x04, offset, quantity, opts);
  }

  private async readBits(
    fc: 0x01 | 0x02,
    offset: number,
    quantity: number,
    opts?: TransportOpts,
  ): Promise<boolean[]> {
    const unitId = opts?.unitId ?? this.opts.unitId;
    const nBytes = Math.ceil(quantity / 8);
    const pdu = [fc, (offset >> 8) & 0xff, offset & 0xff, (quantity >> 8) & 0xff, quantity & 0xff];
    const resp = await this.run(() => this.transact(unitId, pdu, 5 + nBytes));
    const out: boolean[] = [];
    for (let i = 0; i < quantity; i++) {
      out.push((resp[3 + (i >> 3)]! & (1 << (i & 7))) !== 0);
    }
    return out;
  }

  readCoils(offset: number, quantity: number, opts?: TransportOpts): Promise<boolean[]> {
    return this.readBits(0x01, offset, quantity, opts);
  }

  readDiscrete(offset: number, quantity: number, opts?: TransportOpts): Promise<boolean[]> {
    return this.readBits(0x02, offset, quantity, opts);
  }

  async writeHolding(offset: number, values: ArrayLike<number>, opts?: TransportOpts): Promise<void> {
    const unitId = opts?.unitId ?? this.opts.unitId;
    const n = values.length;
    if (n === 1) {
      // FC06 write single register; echoed response (8 bytes).
      const v = values[0]! & 0xffff;
      const pdu = [0x06, (offset >> 8) & 0xff, offset & 0xff, (v >> 8) & 0xff, v & 0xff];
      await this.run(() => this.transact(unitId, pdu, 8));
      return;
    }
    // FC16 write multiple registers; response is 8 bytes.
    const pdu = [0x10, (offset >> 8) & 0xff, offset & 0xff, (n >> 8) & 0xff, n & 0xff, n * 2];
    for (let i = 0; i < n; i++) {
      const v = values[i]! & 0xffff;
      pdu.push((v >> 8) & 0xff, v & 0xff);
    }
    await this.run(() => this.transact(unitId, pdu, 8));
  }

  async writeCoil(offset: number, value: boolean, opts?: TransportOpts): Promise<void> {
    const unitId = opts?.unitId ?? this.opts.unitId;
    const v = value ? 0xff00 : 0x0000;
    const pdu = [0x05, (offset >> 8) & 0xff, offset & 0xff, (v >> 8) & 0xff, v & 0xff];
    await this.run(() => this.transact(unitId, pdu, 8));
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TransportError('modbus response timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

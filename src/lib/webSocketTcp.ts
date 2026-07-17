// SPDX-License-Identifier: Apache-2.0

// A browser-side ModDef Transport (spec §32.3) speaking Modbus TCP over a
// *transparent* WebSocket-to-TCP proxy such as websockify
// (https://github.com/novnc/websockify):
//
//   pip install websockify
//   websockify 8502 192.168.1.50:502   # proxy -> the device's Modbus TCP port
//
// The browser can't open raw TCP, but the proxy is a plain byte pipe, so we
// build real Modbus TCP ADUs (MBAP header + PDU, no CRC) and send them as
// binary WebSocket frames. Transactions are serialized through a FIFO queue and
// matched by MBAP transaction id.

import {TransportError, type Transport, type TransportOpts} from '@moddef/core';

export interface WebSocketTcpOptions {
  unitId?: number;
  timeoutMs?: number;
  maxReadWords?: number;
}

const EXCEPTION_TEXT: Record<number, string> = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'slave device failure',
  6: 'slave device busy',
};

export class WebSocketTcpTransport implements Transport {
  private queue: Promise<unknown> = Promise.resolve();
  private txn = 0;
  private rxBuf = new Uint8Array(0);
  private waiter: {resolve: (f: Uint8Array) => void; reject: (e: Error) => void} | null = null;

  private constructor(
    private readonly ws: WebSocket,
    private readonly opts: Required<Omit<WebSocketTcpOptions, 'unitId'>> & {unitId: number},
  ) {
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => this.onBytes(ev.data);
    ws.onclose = () => this.waiter?.reject(new TransportError('proxy connection closed'));
  }

  /** Open a binary WebSocket to a websockify-style proxy. */
  static connect(url: string, options: WebSocketTcpOptions = {}): Promise<WebSocketTcpTransport> {
    return new Promise((resolve, reject) => {
      // Ask for the raw `binary` subprotocol so the proxy forwards bytes
      // untouched; base64 text frames are also tolerated (see onBytes).
      const ws = new WebSocket(url, ['binary']);
      ws.onopen = () =>
        resolve(
          new WebSocketTcpTransport(ws, {
            unitId: options.unitId ?? 1,
            timeoutMs: options.timeoutMs ?? 2000,
            maxReadWords: options.maxReadWords ?? 125,
          }),
        );
      ws.onerror = () => reject(new TransportError(`cannot connect to proxy at ${url}`));
    });
  }

  close(): void {
    this.ws.close();
  }

  private onBytes(data: unknown): void {
    let chunk: Uint8Array;
    if (typeof data === 'string') {
      // websockify base64 fallback.
      const bin = atob(data);
      chunk = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } else if (data instanceof ArrayBuffer) {
      chunk = new Uint8Array(data);
    } else {
      return;
    }
    const merged = new Uint8Array(this.rxBuf.length + chunk.length);
    merged.set(this.rxBuf);
    merged.set(chunk, this.rxBuf.length);
    this.rxBuf = merged;
    this.tryDeliver();
  }

  // A complete MBAP frame is 6 header bytes + the length field (unit id + PDU).
  private tryDeliver(): void {
    if (!this.waiter || this.rxBuf.length < 6) return;
    const len = (this.rxBuf[4]! << 8) | this.rxBuf[5]!;
    const total = 6 + len;
    if (this.rxBuf.length < total) return;
    const frame = this.rxBuf.subarray(0, total);
    this.rxBuf = this.rxBuf.slice(total);
    const w = this.waiter;
    this.waiter = null;
    w.resolve(frame);
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private transact(unitId: number, pdu: number[]): Promise<Uint8Array> {
    return this.run(
      () =>
        new Promise<Uint8Array>((resolve, reject) => {
          const tid = (this.txn = (this.txn + 1) & 0xffff);
          const len = pdu.length + 1; // unit id + PDU
          const adu = new Uint8Array(6 + len);
          adu[0] = (tid >> 8) & 0xff;
          adu[1] = tid & 0xff;
          adu[2] = 0; // protocol id hi
          adu[3] = 0; // protocol id lo
          adu[4] = (len >> 8) & 0xff;
          adu[5] = len & 0xff;
          adu[6] = unitId & 0xff;
          adu.set(pdu, 7);

          const timer = setTimeout(() => {
            if (this.waiter) this.waiter = null;
            reject(new TransportError('modbus/tcp response timed out'));
          }, this.opts.timeoutMs);

          this.waiter = {
            resolve: (frame) => {
              clearTimeout(timer);
              try {
                resolve(this.parse(frame, tid, pdu[0]!));
              } catch (e) {
                reject(e as Error);
              }
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          };
          try {
            this.ws.send(adu);
          } catch (e) {
            clearTimeout(timer);
            this.waiter = null;
            reject(e as Error);
          }
          // A prior partial frame may already complete this request.
          this.tryDeliver();
        }),
    );
  }

  private parse(frame: Uint8Array, tid: number, fc: number): Uint8Array {
    const gotTid = (frame[0]! << 8) | frame[1]!;
    if (gotTid !== tid) throw new TransportError(`unexpected transaction id ${gotTid}`);
    const respFc = frame[7]!;
    if ((respFc & 0x80) !== 0) {
      const code = frame[8]!;
      throw new TransportError(`modbus exception: ${EXCEPTION_TEXT[code] ?? `code ${code}`}`, code);
    }
    if (respFc !== fc) throw new TransportError(`unexpected function code ${respFc}`);
    return frame.subarray(7); // PDU (fc + data)
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
      const resp = await this.transact(unitId, pdu); // [fc, byteCount, data...]
      for (let i = 0; i < q; i++) out[done + i] = (resp[2 + i * 2]! << 8) | resp[3 + i * 2]!;
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
    const pdu = [fc, (offset >> 8) & 0xff, offset & 0xff, (quantity >> 8) & 0xff, quantity & 0xff];
    const resp = await this.transact(unitId, pdu); // [fc, byteCount, data...]
    const out: boolean[] = [];
    for (let i = 0; i < quantity; i++) out.push((resp[2 + (i >> 3)]! & (1 << (i & 7))) !== 0);
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
      const v = values[0]! & 0xffff;
      await this.transact(unitId, [0x06, (offset >> 8) & 0xff, offset & 0xff, (v >> 8) & 0xff, v & 0xff]);
      return;
    }
    const pdu = [0x10, (offset >> 8) & 0xff, offset & 0xff, (n >> 8) & 0xff, n & 0xff, n * 2];
    for (let i = 0; i < n; i++) {
      const v = values[i]! & 0xffff;
      pdu.push((v >> 8) & 0xff, v & 0xff);
    }
    await this.transact(unitId, pdu);
  }

  async writeCoil(offset: number, value: boolean, opts?: TransportOpts): Promise<void> {
    const unitId = opts?.unitId ?? this.opts.unitId;
    const v = value ? 0xff00 : 0x0000;
    await this.transact(unitId, [0x05, (offset >> 8) & 0xff, offset & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
}

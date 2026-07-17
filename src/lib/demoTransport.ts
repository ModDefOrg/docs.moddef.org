// SPDX-License-Identifier: Apache-2.0

// A hardware-free ModDef Transport for the live dashboard's demo mode. It seeds
// an in-memory register image from the selected profile itself: for every point
// it picks a plausible engineering value (by measurand/unit) and encodes it with
// the runtime's own `encodePoint`, so each point decodes back to a sensible,
// typed value. A timer applies gentle jitter so tiles update like a live device.

import {
  emptyContext,
  encodePoint,
  schema,
  words,
  type Device,
  type Transport,
  type TransportOpts,
} from '@moddef/core';

const {AddressSpace, StorageType} = schema;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return h;
}

// A representative base value per measurand base-quantity, falling back to unit.
function baseValue(baseQuantity: string, unit: string): number {
  switch (baseQuantity) {
    case 'voltage':
      return 230;
    case 'current':
      return 4.8;
    case 'active_power':
      return 1150;
    case 'reactive_power':
      return 210;
    case 'apparent_power':
      return 1180;
    case 'power_factor':
      return 0.95;
    case 'frequency':
      return 50;
    case 'temperature':
    case 'inverter_temperature':
      return 27;
    case 'state_of_charge':
      return 62;
    case 'state_of_health':
      return 98;
    case 'battery_power':
      return 850;
    case 'pv_power':
    case 'pv_voltage':
      return baseQuantity === 'pv_power' ? 2600 : 480;
    case 'pv_current':
      return 6.2;
    case 'battery_voltage':
      return 51.2;
    case 'charge_limit':
    case 'discharge_limit':
      return 5000;
  }
  switch (unit) {
    case 'V':
      return 230;
    case 'A':
      return 4.8;
    case 'W':
      return 1000;
    case 'kW':
      return 1.15;
    case 'VA':
    case 'kVA':
      return unit === 'VA' ? 1180 : 1.18;
    case 'var':
    case 'kvar':
      return unit === 'var' ? 210 : 0.21;
    case 'Hz':
      return 50;
    case '%':
      return 55;
    case 'degC':
      return 25;
    case '1':
      return 0.95;
    case 's':
      return 3600;
    default:
      return 1;
  }
}

export class DemoTransport implements Transport {
  private input = new Uint16Array(0);
  private holding = new Uint16Array(0);
  private dev: Device | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly t0 = Date.now();

  /** Bind the device and start producing synthetic values. */
  seed(dev: Device): void {
    this.dev = dev;
    this.reseed();
    this.timer = setInterval(() => this.reseed(), 700);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private bufFor(space: number): 'input' | 'holding' {
    return space === AddressSpace.HOLDING_REGISTER ? 'holding' : 'input';
  }

  private ensure(which: 'input' | 'holding', end: number): Uint16Array {
    let buf = which === 'holding' ? this.holding : this.input;
    if (buf.length < end) {
      const grown = new Uint16Array(end + 16);
      grown.set(buf);
      buf = grown;
      if (which === 'holding') this.holding = grown;
      else this.input = grown;
    }
    return buf;
  }

  private valueFor(baseQuantity: string, unit: string, pointId: string): number {
    const el = (Date.now() - this.t0) / 1000;
    // Energy counters climb monotonically; everything else wobbles a little.
    if (baseQuantity.startsWith('energy') || unit === 'kWh' || unit === 'kvarh' || unit === 'kVAh') {
      return Math.round((1200 + el * 0.05) * 1000) / 1000;
    }
    const base = baseValue(baseQuantity, unit);
    const wob = 1 + 0.03 * Math.sin(el * 0.7 + hash(pointId));
    const v = base * wob;
    if (baseQuantity === 'power_factor' || unit === '1') return Math.min(1, Math.max(0.8, v));
    if (baseQuantity === 'frequency' || unit === 'Hz') return Math.round((50 + 0.05 * Math.sin(el)) * 100) / 100;
    return Math.round(v * 1000) / 1000;
  }

  private reseed(): void {
    const dev = this.dev;
    if (!dev) return;
    for (const pi of dev.points()) {
      const p = pi.point;
      if (p.storageType === StorageType.COMPOSED) continue;
      const space = p.mapping?.space || pi.block.space;
      const offset = p.mapping?.offset ?? 0;
      const isString =
        p.storageType === StorageType.STRING_ASCII || p.storageType === StorageType.STRING_UTF8;
      const value: number | string = isString
        ? 'DEMO'
        : this.valueFor(p.measurand?.baseQuantity ?? '', p.unit ?? '', p.pointId);
      let regs: Uint16Array;
      try {
        regs = encodePoint(p, value, emptyContext());
      } catch {
        continue; // e.g. scale_ref points without a resolvable context — leave 0
      }
      const which = this.bufFor(space);
      const len = regs.length || words(p, p.storageType);
      const buf = this.ensure(which, offset + len);
      buf.set(regs.subarray(0, len), offset);
    }
  }

  private slice(which: 'input' | 'holding', offset: number, quantity: number): Uint16Array {
    const buf = this.ensure(which, offset + quantity);
    return buf.slice(offset, offset + quantity);
  }

  async readInput(offset: number, quantity: number, _opts?: TransportOpts): Promise<Uint16Array> {
    return this.slice('input', offset, quantity);
  }
  async readHolding(offset: number, quantity: number, _opts?: TransportOpts): Promise<Uint16Array> {
    return this.slice('holding', offset, quantity);
  }
  async readCoils(_offset: number, quantity: number): Promise<boolean[]> {
    return new Array(quantity).fill(false);
  }
  async readDiscrete(_offset: number, quantity: number): Promise<boolean[]> {
    return new Array(quantity).fill(false);
  }
  async writeHolding(offset: number, values: ArrayLike<number>): Promise<void> {
    const buf = this.ensure('holding', offset + values.length);
    for (let i = 0; i < values.length; i++) buf[offset + i] = values[i]! & 0xffff;
  }
  async writeCoil(): Promise<void> {
    /* no-op in demo mode */
  }
}

// SPDX-License-Identifier: Apache-2.0

import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  Device,
  isUnavailable,
  parseDocument,
  schema,
  type DecodedValue,
  type Transport,
} from '@moddef/core';
import {DemoTransport} from '@site/src/lib/demoTransport';
import {WebSerialTransport, webSerialAvailable} from '@site/src/lib/webSerialModbus';
import {WebSocketTcpTransport} from '@site/src/lib/webSocketTcp';
import {WsTransport} from '@site/src/lib/wsTransport';
import styles from './styles.module.css';

type ManifestEntry = {
  docId: string;
  vendor: string;
  model: string;
  category: string;
  transports: string[];
  rtuCapable: boolean;
  points: number;
  status: string;
  href: string;
};

type Mode = 'demo' | 'serial' | 'tcp' | 'ws';

// A readable point plus its owning block, for grouped display.
type Row = {id: string; name: string; unit: string; blockId: string; blockName: string};

const BAUD_RATES = [2400, 4800, 9600, 19200, 38400, 57600, 115200];

// Category display labels, mirroring the docs sidebar / device browser.
const CATEGORY_LABELS: Record<string, string> = {
  'solar-inverter': 'Solar inverters',
  'energy-meter': 'Energy meters',
  'battery-storage': 'Battery storage',
  'ev-charger': 'EV chargers',
  hvac: 'HVAC',
};

function categoryLabel(slug: string): string {
  return (
    CATEGORY_LABELS[slug] ??
    slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

function formatValue(v: DecodedValue): string {
  if (isUnavailable(v)) return 'n/a';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1000) / 1000);
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(', ');
  if (v instanceof Uint8Array) return Array.from(v, (b) => b.toString(16).padStart(2, '0')).join(' ');
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

export type LiveDashboardProps = {
  /** Preselected device doc id (from the ?device= deep link). */
  initialDeviceId?: string;
};

export default function LiveDashboard({initialDeviceId}: LiveDashboardProps): ReactNode {
  const manifestUrl = useBaseUrl('/profiles/manifest.json');
  const profilesBase = useBaseUrl('/profiles/');

  const [devices, setDevices] = useState<ManifestEntry[]>([]);
  const [docId, setDocId] = useState(initialDeviceId ?? '');

  const [mode, setMode] = useState<Mode>('demo');
  const [baudRate, setBaudRate] = useState(9600);
  const [parity, setParity] = useState<'none' | 'even' | 'odd'>('none');
  const [tcpUrl, setTcpUrl] = useState('ws://localhost:8502');
  const [wsUrl, setWsUrl] = useState('ws://localhost:8502');
  const [unitId, setUnitId] = useState(1);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [showControls, setShowControls] = useState(false);

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [writable, setWritable] = useState<Row[]>([]);
  const [values, setValues] = useState<Map<string, DecodedValue>>(new Map());
  const [pointErrors, setPointErrors] = useState<Map<string, string>>(new Map());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const transportRef = useRef<Transport & {close: () => void | Promise<void>}>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

  const serialSupported = webSerialAvailable();

  // Load the device manifest once.
  useEffect(() => {
    fetch(manifestUrl)
      .then((r) => r.json())
      .then((list: ManifestEntry[]) => setDevices(list))
      .catch(() => setError('Could not load the device list.'));
  }, [manifestUrl]);

  // Group by category and order like the docs sidebar: categories A→Z by label,
  // devices A→Z by doc id (which sorts vendor-then-model within a category).
  const deviceGroups = useMemo(() => {
    const byCat = new Map<string, ManifestEntry[]>();
    for (const d of devices) {
      const list = byCat.get(d.category) ?? [];
      list.push(d);
      byCat.set(d.category, list);
    }
    return [...byCat.keys()]
      .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))
      .map(
        (c) =>
          [categoryLabel(c), byCat.get(c)!.slice().sort((a, b) => a.docId.localeCompare(b.docId))] as const,
      );
  }, [devices]);

  // Default the picker to the first device in sidebar order.
  useEffect(() => {
    if (!docId && deviceGroups.length) setDocId(deviceGroups[0][1][0].docId);
  }, [deviceGroups, docId]);

  const selected = useMemo(() => devices.find((d) => d.docId === docId), [devices, docId]);

  // If the chosen device is TCP-only, default to Modbus TCP.
  useEffect(() => {
    if (selected && !selected.rtuCapable && mode === 'serial') setMode('tcp');
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const disconnect = useCallback(async () => {
    stopPolling();
    const t = transportRef.current;
    transportRef.current = null;
    deviceRef.current = null;
    inFlight.current = false;
    try {
      await t?.close();
    } catch {
      /* ignore */
    }
    setStatus('idle');
    setRows([]);
    setWritable([]);
    setValues(new Map());
    setPointErrors(new Map());
    setUpdatedAt(null);
  }, [stopPolling]);

  useEffect(() => () => void disconnect(), [disconnect]);

  const pollOnce = useCallback(async () => {
    const dev = deviceRef.current;
    if (!dev || inFlight.current) return;
    inFlight.current = true;
    const nextValues = new Map<string, DecodedValue>();
    const nextErrors = new Map<string, string>();
    try {
      for (const row of rows) {
        try {
          nextValues.set(row.id, await dev.readPoint(row.id, {unitId}));
        } catch (e) {
          nextErrors.set(row.id, e instanceof Error ? e.message : String(e));
        }
      }
      setValues(nextValues);
      setPointErrors(nextErrors);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
    }
  }, [rows, unitId]);

  // Drive the poll loop whenever we're connected (and the interval changes).
  useEffect(() => {
    if (status !== 'connected') return;
    void pollOnce();
    timerRef.current = setInterval(() => void pollOnce(), Math.max(250, intervalMs));
    return stopPolling;
  }, [status, pollOnce, intervalMs, stopPolling]);

  const connect = useCallback(async () => {
    if (!selected) return;
    if (mode === 'serial' && !serialSupported) {
      setError('Web Serial is not supported in this browser — use Chrome or Edge, or pick Demo or Modbus TCP.');
      setStatus('idle');
      return;
    }
    setError(null);
    setStatus('connecting');
    try {
      const transport =
        mode === 'demo'
          ? new DemoTransport()
          : mode === 'serial'
            ? await WebSerialTransport.open({baudRate, parity, unitId})
            : mode === 'tcp'
              ? await WebSocketTcpTransport.connect(tcpUrl, {unitId})
              : await WsTransport.connect(wsUrl);
      transportRef.current = transport as Transport & {close: () => void};

      const text = await fetch(`${profilesBase}${selected.docId}.moddef.yaml`).then((r) => {
        if (!r.ok) throw new Error(`profile ${selected.docId} not found`);
        return r.text();
      });
      const doc = parseDocument(text, 'yaml');
      const dev = Device.create(doc, undefined, transport);
      // Demo mode fills a synthetic register image from the profile itself.
      if (transport instanceof DemoTransport) transport.seed(dev);
      deviceRef.current = dev;

      const readable: Row[] = [];
      const writes: Row[] = [];
      for (const pi of dev.points()) {
        const p = pi.point;
        const row: Row = {
          id: p.pointId,
          name: p.name || p.pointId,
          unit: p.unit ?? '',
          blockId: pi.block.blockId,
          blockName: pi.block.name || pi.block.blockId,
        };
        const composed = p.storageType === schema.StorageType.COMPOSED;
        if (
          !composed &&
          (p.access === schema.AccessMode.READ_ONLY || p.access === schema.AccessMode.READ_WRITE)
        ) {
          readable.push(row);
        }
        if (
          p.access === schema.AccessMode.READ_WRITE ||
          p.access === schema.AccessMode.WRITE_ONLY ||
          p.access === schema.AccessMode.COMMAND
        ) {
          writes.push(row);
        }
      }
      setRows(readable);
      setWritable(writes);
      setStatus('connected');
    } catch (e) {
      await disconnect();
      setError(e instanceof Error ? e.message : String(e));
      setStatus('idle');
    }
  }, [selected, mode, serialSupported, baudRate, parity, unitId, tcpUrl, wsUrl, profilesBase, disconnect]);

  const doWrite = useCallback(
    async (row: Row, raw: string) => {
      const dev = deviceRef.current;
      if (!dev) return;
      const num = Number(raw);
      if (raw.trim() === '' || Number.isNaN(num)) {
        setError(`"${raw}" is not a number`);
        return;
      }
      if (!window.confirm(`Write ${num}${row.unit ? ' ' + row.unit : ''} to "${row.name}"?`)) return;
      try {
        await dev.writePoint(row.id, num, {unitId});
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [unitId],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const list = map.get(r.blockName) ?? [];
      list.push(r);
      map.set(r.blockName, list);
    }
    return [...map.entries()];
  }, [rows]);

  const connected = status === 'connected';

  return (
    <div>
      <div className={styles.panel}>
        <div className={styles.field}>
          <label className={styles.label}>Device</label>
          <select
            className={styles.select}
            value={docId}
            disabled={connected}
            onChange={(e) => setDocId(e.target.value)}>
            {deviceGroups.map(([label, list]) => (
              <optgroup key={label} label={label}>
                {list.map((d) => (
                  <option key={d.docId} value={d.docId}>
                    {d.vendor} {d.model}
                    {d.rtuCapable ? '' : ' (TCP only)'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Transport</label>
          <div className={styles.modeRow}>
            <label className={styles.radio}>
              <input
                type="radio"
                checked={mode === 'demo'}
                disabled={connected}
                onChange={() => setMode('demo')}
              />{' '}
              Demo
            </label>
            <label
              className={styles.radio}
              title={serialSupported ? undefined : 'Web Serial needs Chrome or Edge'}>
              <input
                type="radio"
                checked={mode === 'serial'}
                disabled={connected || !serialSupported}
                onChange={() => setMode('serial')}
              />{' '}
              Web Serial{!serialSupported && <span className={styles.muted}> (needs Chrome/Edge)</span>}
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                checked={mode === 'tcp'}
                disabled={connected}
                onChange={() => setMode('tcp')}
              />{' '}
              Modbus TCP
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                checked={mode === 'ws'}
                disabled={connected}
                onChange={() => setMode('ws')}
              />{' '}
              WS bridge
            </label>
          </div>
        </div>

        {mode === 'serial' ? (
          <>
            <div className={styles.field}>
              <label className={styles.label}>Baud</label>
              <select
                className={styles.select}
                value={baudRate}
                disabled={connected}
                onChange={(e) => setBaudRate(Number(e.target.value))}>
                {BAUD_RATES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Parity</label>
              <select
                className={styles.select}
                value={parity}
                disabled={connected}
                onChange={(e) => setParity(e.target.value as 'none' | 'even' | 'odd')}>
                <option value="none">none</option>
                <option value="even">even</option>
                <option value="odd">odd</option>
              </select>
            </div>
          </>
        ) : mode === 'tcp' ? (
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label}>Proxy URL</label>
            <input
              className={styles.input}
              value={tcpUrl}
              disabled={connected}
              onChange={(e) => setTcpUrl(e.target.value)}
            />
          </div>
        ) : mode === 'ws' ? (
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label}>Bridge URL</label>
            <input
              className={styles.input}
              value={wsUrl}
              disabled={connected}
              onChange={(e) => setWsUrl(e.target.value)}
            />
          </div>
        ) : null}

        {mode !== 'demo' && (
          <div className={styles.field}>
            <label className={styles.label}>Unit id</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={247}
              value={unitId}
              disabled={connected}
              onChange={(e) => setUnitId(Number(e.target.value))}
            />
          </div>
        )}
        <div className={styles.field}>
          <label className={styles.label}>Poll (ms)</label>
          <input
            className={styles.input}
            type="number"
            min={250}
            step={250}
            value={intervalMs}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
          />
        </div>

        <div className={styles.actions}>
          {connected ? (
            <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              className={styles.btn}
              disabled={!selected || status === 'connecting'}
              onClick={() => void connect()}>
              {status === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {mode === 'demo' && !connected && (
        <p className={styles.notice}>
          Demo mode fills the dashboard with synthetic, live-updating values decoded straight from the
          selected profile — no device, proxy, or Chromium browser needed. Great for exploring what a
          profile exposes.
        </p>
      )}

      {mode === 'serial' && !serialSupported && (
        <p className={styles.notice}>
          Web Serial needs a Chromium browser (Chrome or Edge). For a networked device, switch the
          transport to <strong>Modbus TCP</strong> or <strong>WS bridge</strong>.
        </p>
      )}

      {mode === 'tcp' && !connected && (
        <p className={styles.notice}>
          Browsers can&apos;t open raw TCP, so point a transparent WebSocket&#8202;&#8594;&#8202;TCP proxy
          at the device and connect to it above. With{' '}
          <a href="https://github.com/novnc/websockify">websockify</a>:{' '}
          <code>websockify 8502 &lt;device-ip&gt;:502</code>, then use{' '}
          <code>ws://localhost:8502</code>.
        </p>
      )}

      {mode === 'ws' && !connected && (
        <p className={styles.notice}>
          Runs Modbus on a small local relay that speaks the moddef JSON protocol — see the{' '}
          <a href="https://github.com/ModDefOrg/moddef-ts/tree/main/examples/browser-ws-bridge">
            browser-ws-bridge example
          </a>{' '}
          (<code>npx tsx bridge.ts --tcp &lt;device-ip&gt;</code>).
        </p>
      )}

      {error && <p className={styles.error}>⚠ {error}</p>}

      {connected && (
        <div className={styles.statusBar}>
          <span className={styles.live}>● live</span>
          <span>
            {rows.length} points ·{' '}
            {mode === 'demo'
              ? 'synthetic data'
              : mode === 'serial'
                ? `unit ${unitId} · ${baudRate} ${parity}`
                : `unit ${unitId} · ${mode === 'tcp' ? tcpUrl : wsUrl}`}
          </span>
          {updatedAt && (
            <span className={styles.muted}>updated {new Date(updatedAt).toLocaleTimeString()}</span>
          )}
          {writable.length > 0 && (
            <label className={styles.radio}>
              <input
                type="checkbox"
                checked={showControls}
                onChange={(e) => setShowControls(e.target.checked)}
              />{' '}
              controls
            </label>
          )}
        </div>
      )}

      {connected &&
        grouped.map(([block, list]) => (
          <section key={block} className={styles.section}>
            <h3 className={styles.sectionTitle}>{block}</h3>
            <div className={styles.grid}>
              {list.map((r) => {
                const err = pointErrors.get(r.id);
                const v = values.get(r.id);
                return (
                  <div key={r.id} className={styles.tile}>
                    <div className={styles.tileName}>{r.name}</div>
                    {err ? (
                      <div className={styles.tileError}>err</div>
                    ) : (
                      <div className={styles.tileValue}>
                        {v === undefined ? '—' : formatValue(v)}
                        {r.unit && <span className={styles.tileUnit}> {r.unit}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

      {connected && showControls && writable.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Controls (guarded writes)</h3>
          <div className={styles.writeGrid}>
            {writable.map((r) => (
              <WriteRow key={r.id} row={r} onWrite={doWrite} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function WriteRow({row, onWrite}: {row: Row; onWrite: (r: Row, raw: string) => void}): ReactNode {
  const [val, setVal] = useState('');
  return (
    <div className={styles.writeRow}>
      <span className={styles.writeName}>
        {row.name}
        {row.unit && <span className={styles.tileUnit}> ({row.unit})</span>}
      </span>
      <input
        className={styles.input}
        type="number"
        value={val}
        placeholder="value"
        onChange={(e) => setVal(e.target.value)}
      />
      <button className={`${styles.btn} ${styles.btnSmall}`} onClick={() => onWrite(row, val)}>
        Write
      </button>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0

import {useMemo, useState, type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

export type DeviceEntry = {
  vendor: string;
  model: string;
  category: string;
  docId: string;
  profile: string;
  transports: string[];
  points: number;
  status: string;
  sourceUrl: string;
  measurands: string[];
};

const REPO = 'https://github.com/ModDefOrg/devices';

// Display labels for the category slugs used in registry.yaml. An unknown
// slug falls back to a title-cased version of the slug itself.
const CATEGORY_LABELS: Record<string, string> = {
  'solar-inverter': 'Solar inverters',
  'energy-meter': 'Energy meters',
  'battery-storage': 'Battery storage',
  'ev-charger': 'EV chargers',
  hvac: 'HVAC',
};

// Status determines the colour of the status pill. Anything not listed here
// renders in the neutral style.
const STATUS_CLASS: Record<string, string> = {
  'vendor-confirmed': styles.statusConfirmed,
  'hardware-verified': styles.statusVerified,
  draft: styles.statusDraft,
  experimental: styles.statusDraft,
};

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? titleCase(slug);
}

function transportLabel(t: string): string {
  return t.replace(/^MODBUS_/, 'Modbus ');
}

function statusLabel(s: string): string {
  return titleCase(s);
}

function DeviceCard({device}: {device: DeviceEntry}): ReactNode {
  const profileUrl = `${REPO}/blob/main/${device.profile}`;
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.vendor}>{device.vendor}</div>
          <div className={styles.model}>{device.model}</div>
        </div>
        <span className={`${styles.status} ${STATUS_CLASS[device.status] ?? ''}`}>
          {statusLabel(device.status)}
        </span>
      </div>

      <div className={styles.badges}>
        <span className={styles.badge}>{device.points} points</span>
        {device.transports.map((t) => (
          <span key={t} className={`${styles.badge} ${styles.badgeTransport}`}>
            {transportLabel(t)}
          </span>
        ))}
        <span className={styles.badge}>{device.measurands.length} measurands</span>
      </div>

      {device.measurands.length > 0 && (
        <details className={styles.measurands}>
          <summary>Measurands</summary>
          <div className={styles.measurandList}>
            {device.measurands.map((m) => (
              <code key={m} className={styles.measurand}>
                {m}
              </code>
            ))}
          </div>
        </details>
      )}

      <div className={styles.cardFoot}>
        <Link className={styles.link} to={profileUrl}>
          Profile
        </Link>
        {device.sourceUrl && (
          <Link className={styles.link} to={device.sourceUrl}>
            Register map source
          </Link>
        )}
      </div>
    </div>
  );
}

export default function DeviceBrowser({devices}: {devices: DeviceEntry[]}): ReactNode {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [transport, setTransport] = useState('all');

  const categories = useMemo(
    () => Array.from(new Set(devices.map((d) => d.category))).sort(),
    [devices],
  );
  const transports = useMemo(
    () => Array.from(new Set(devices.flatMap((d) => d.transports))).sort(),
    [devices],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (category !== 'all' && d.category !== category) return false;
      if (transport !== 'all' && !d.transports.includes(transport)) return false;
      if (!q) return true;
      const hay = `${d.vendor} ${d.model} ${d.measurands.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [devices, query, category, transport]);

  // Group the filtered devices by category, preserving the sorted category order.
  const grouped = useMemo(() => {
    const map = new Map<string, DeviceEntry[]>();
    for (const d of filtered) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return categories
      .filter((c) => map.has(c))
      .map((c) => [c, map.get(c)!] as const);
  }, [filtered, categories]);

  const totalPoints = devices.reduce((n, d) => n + d.points, 0);

  return (
    <div>
      <p className={styles.summary}>
        {devices.length} devices across {categories.length} categories,{' '}
        {totalPoints.toLocaleString()} register points total. Every profile lints
        clean and comes from a vendor-confirmed register map. Add one by opening a
        pull request against{' '}
        <Link to={REPO}>the registry</Link>.
      </p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search vendor, model, or measurand"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search devices"
        />
        <div className={styles.filters}>
          <select
            className={styles.select}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category">
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            aria-label="Filter by transport">
            <option value="all">All transports</option>
            {transports.map((t) => (
              <option key={t} value={t}>
                {transportLabel(t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {grouped.length === 0 && (
        <p className={styles.empty}>No devices match those filters.</p>
      )}

      {grouped.map(([cat, list]) => (
        <section key={cat} className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {categoryLabel(cat)} <span className={styles.count}>{list.length}</span>
          </h2>
          <div className={styles.grid}>
            {list.map((d) => (
              <DeviceCard key={d.docId} device={d} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

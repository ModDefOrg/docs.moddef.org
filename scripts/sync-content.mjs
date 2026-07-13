// SPDX-License-Identifier: Apache-2.0

// Generate docs pages from the moddef repo: the versioned spec, the stdlib
// measurand catalog, and the CLI reference. Run before `docusaurus build`
// (npm run sync). Outputs are committed so the site builds anywhere; CI
// re-runs this and could drift-check. Single source of truth stays upstream.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const moddef = join(root, '..', 'moddef');
const devices = join(root, '..', 'devices');

function write(rel, content) {
  const path = join(root, rel);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, content);
  console.log('wrote', rel);
}

// --- Specification ---------------------------------------------------------
function syncSpec() {
  const src = join(moddef, 'spec', 'moddef_spec_v0_4.md');
  if (!existsSync(src)) {
    console.warn('spec source not found, skipping:', src);
    return;
  }
  let body = readFileSync(src, 'utf8');
  // Drop the leading H1; the frontmatter title supplies it.
  body = body.replace(/^#\s+.*\n/, '');

  // §27 dumps the whole ~500-line protobuf schema inline. The canonical
  // schema is the .proto files; replace the code block with a link so the
  // rendered spec stays readable (heading + intro kept).
  const protoBase = 'https://github.com/ModDefOrg/moddef/blob/main/proto/moddef/v1';
  const schemaLink = [
    'The canonical schema is the Protobuf definition in',
    `[\`moddef/proto/moddef/v1\`](https://github.com/ModDefOrg/moddef/tree/main/proto/moddef/v1):`,
    '',
    `- [\`types.proto\`](${protoBase}/types.proto): primitive and value types, enums, transports`,
    `- [\`mapping.proto\`](${protoBase}/mapping.proto): physical mapping, transforms, fields, strings, write semantics`,
    `- [\`device.proto\`](${protoBase}/device.proto): device profiles, register blocks, points, variants`,
    `- [\`measurand.proto\`](${protoBase}/measurand.proto): the measurand model and aliases`,
    `- [\`document.proto\`](${protoBase}/document.proto): the top-level document and imports`,
    '',
    'The full schema is omitted here to keep the rendered spec readable; the',
    '`.proto` files above are the source of truth.',
  ].join('\n');
  body = body.replace(
    /(## 27\. Protobuf Schema Draft\n[\s\S]*?\n)```[ ]*proto\b[\s\S]*?\n```/,
    (_m, head) => head + '\n' + schemaLink,
  );
  // `format: md` keeps the spec as CommonMark so its `{`, `<`, and `§`
  // content is not parsed as MDX/JSX.
  const front = [
    '---',
    'title: Specification v0.4',
    'sidebar_label: v0.4 (current)',
    'slug: /spec/v0.4',
    'format: md',
    '---',
    '',
    ':::info',
    'This is the rendered normative specification, synced from ' +
      '[`moddef/spec`](https://github.com/ModDefOrg/moddef/tree/main/spec). ' +
      'The Markdown source is the source of truth.',
    ':::',
    '',
  ].join('\n');
  write('docs/spec/v0.4.md', front + body + '\n');
}

// --- Measurand catalog -----------------------------------------------------
function syncMeasurands() {
  const src = join(moddef, 'stdlib', 'measurands', '1.0.0', 'measurands.moddef.yaml');
  if (!existsSync(src)) {
    console.warn('measurands source not found, skipping:', src);
    return;
  }
  const doc = yaml.load(readFileSync(src, 'utf8'));
  const rows = (doc.measurands || [])
    .map((m) => {
      const unit = m.canonical_unit === '1' ? '`1` (ratio)' : `\`${m.canonical_unit}\``;
      const desc = (m.description || '').replace(/\|/g, '\\|');
      return `| \`${m.base_quantity}\` | ${m.name} | ${unit} | ${desc} |`;
    })
    .join('\n');
  const out = [
    '---',
    'title: Measurand catalog',
    'sidebar_label: Measurands',
    'slug: /stdlib/measurands',
    '---',
    '',
    '# Measurand catalog',
    '',
    'The standard measurand catalog (`moddef:stdlib:measurands:1.0.0`). Each',
    'point references one of these base quantities and adds inline qualifiers',
    '(direction, phase, aggregation, location, accumulation). See',
    '[Measurands](/guide/concepts/measurands) for how querying works.',
    '',
    `Synced from [\`moddef/stdlib\`](https://github.com/ModDefOrg/moddef/tree/main/stdlib/measurands). ${
      doc.measurands?.length ?? 0
    } entries.`,
    '',
    '| Base quantity | Name | Canonical unit | Description |',
    '| --- | --- | --- | --- |',
    rows,
    '',
  ].join('\n');
  write('docs/stdlib/measurands.mdx', out);
}

// --- OCPP alias catalog ----------------------------------------------------
function syncOcppAliases() {
  const src = join(moddef, 'stdlib', 'ocpp-aliases', '1.0.0', 'ocpp-aliases.moddef.yaml');
  if (!existsSync(src)) return console.warn('ocpp-aliases not found, skipping');
  const doc = yaml.load(readFileSync(src, 'utf8'));
  const aliases = doc.measurand_aliases || [];
  const qualifiers = (m) =>
    ['direction', 'phase_ref', 'aggregation', 'location', 'accumulation']
      .map((k) => m[k])
      .filter(Boolean)
      .map((v) => `\`${v}\``)
      .join(' · ') || 'none';
  const rows = aliases
    .map((a) => {
      const m = a.maps_to || {};
      return `| \`${a.alias}\` | \`${m.base_quantity || ''}\` | ${qualifiers(m)} |`;
    })
    .join('\n');
  const out = [
    '---',
    'title: OCPP aliases',
    'sidebar_label: OCPP aliases',
    'slug: /stdlib/ocpp-aliases',
    '---',
    '',
    '# OCPP alias catalog',
    '',
    'Maps OCPP 1.6 measurand names onto the ModDef semantic tuple model (spec',
    '§24), so ModDef stays compatible with OCPP terminology without adopting it',
    'as the core namespace. Import as `moddef:stdlib:ocpp-aliases:1.0.0` and',
    'resolve OCPP names to [measurands](/stdlib/measurands).',
    '',
    `Synced from [\`moddef/stdlib\`](https://github.com/ModDefOrg/moddef/tree/main/stdlib/ocpp-aliases). ${aliases.length} aliases.`,
    '',
    '| OCPP name | Base quantity | Qualifiers |',
    '| --- | --- | --- |',
    rows,
    '',
  ].join('\n');
  write('docs/stdlib/ocpp-aliases.mdx', out);
}

// --- Core enum library -----------------------------------------------------
function syncCore() {
  const src = join(moddef, 'stdlib', 'core', '1.0.0', 'core.moddef.yaml');
  if (!existsSync(src)) return console.warn('core not found, skipping');
  const doc = yaml.load(readFileSync(src, 'utf8'));
  const enums = doc.enums || [];
  const esc = (s) => (s || '').replace(/\|/g, '\\|');
  const sections = enums
    .map((e) => {
      const head = `### \`${e.type_id}\`${e.name ? ` (${e.name})` : ''}`;
      const desc = e.description ? `\n${e.description}\n` : '';
      const rows = (e.values || [])
        .map((v) => `| ${v.value} | \`${v.name}\` | ${esc(v.description)} |`)
        .join('\n');
      return `${head}\n${desc}\n| Value | Name | Description |\n| --- | --- | --- |\n${rows}\n`;
    })
    .join('\n');
  const out = [
    '---',
    'title: Core library',
    'sidebar_label: Core enums',
    'slug: /stdlib/core',
    '---',
    '',
    '# Core library',
    '',
    'Common, reusable enum types (spec §20.1). Import as',
    '`moddef:stdlib:core:1.0.0` and reference these by id from a point&apos;s',
    '`value_type.enum_ref`.',
    '',
    `Synced from [\`moddef/stdlib\`](https://github.com/ModDefOrg/moddef/tree/main/stdlib/core). ${enums.length} enums.`,
    '',
    sections,
  ].join('\n');
  write('docs/stdlib/core.mdx', out);
}

// --- SunSpec starter library -----------------------------------------------
function syncSunspec() {
  const src = join(moddef, 'stdlib', 'sunspec', '1.0.0', 'sunspec.moddef.yaml');
  if (!existsSync(src)) return console.warn('sunspec not found, skipping');
  const doc = yaml.load(readFileSync(src, 'utf8'));
  const esc = (s) => (s || '').replace(/\|/g, '\\|');
  const blocks = (doc.devices || []).flatMap((d) => d.blocks || []);
  const sections = blocks
    .map((b) => {
      const model = b.discovery?.model_id;
      const head = `### ${b.name || b.block_id}${model != null ? ` (model ${model})` : ''}`;
      const rows = (b.points || [])
        .map((p) => {
          const off =
            p.mapping?.model_relative_offset ?? p.mapping?.offset ?? '';
          return `| \`${p.point_id}\` | ${esc(p.name)} | \`${p.storage_type || ''}\` | ${p.unit ? `\`${p.unit}\`` : 'none'} | ${off} |`;
        })
        .join('\n');
      return `${head}\n\n| Point | Name | Storage | Unit | Offset* |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
    })
    .join('\n');
  const out = [
    '---',
    'title: SunSpec library',
    'sidebar_label: SunSpec',
    'slug: /stdlib/sunspec',
    '---',
    '',
    '# SunSpec starter library',
    '',
    'A starter SunSpec mapping (spec §20.3) demonstrating the v0.4 constructs',
    'the SunSpec ecosystem needs: model-chain [discovery](/guide/concepts/discovery)',
    'with model-relative offsets, and register-referenced',
    '[scale factors](/guide/concepts/transforms#register-referenced-scale-factors-sunspec).',
    'Import as `moddef:stdlib:sunspec:1.0.0`. Covers the Common model (1) and the',
    'single-phase inverter model (103); more models are future work.',
    '',
    `Synced from [\`moddef/stdlib\`](https://github.com/ModDefOrg/moddef/tree/main/stdlib/sunspec).`,
    '',
    sections,
    '\\* Offset is relative to the model&apos;s ID register (spec §7.3).',
    '',
  ].join('\n');
  write('docs/stdlib/sunspec.mdx', out);
}

// --- Linter rules reference ------------------------------------------------
function syncLintRules() {
  const src = join(moddef, 'fixtures', 'manifest.yaml');
  if (!existsSync(src)) {
    console.warn('fixtures manifest not found, skipping lint rules:', src);
    return;
  }
  const manifest = yaml.load(readFileSync(src, 'utf8'));
  const invalid = manifest.invalid || [];

  // Deduplicate by rule; the manifest lists one fixture per rule.
  const byRule = new Map();
  for (const e of invalid) {
    if (!byRule.has(e.rule)) byRule.set(e.rule, e);
  }
  const all = [...byRule.values()];
  const esc = (s) => (s || '').replace(/\|/g, '\\|');
  const table = (entries) =>
    [
      '| Code | Description |',
      '| --- | --- |',
      ...entries.map((e) => `| \`${e.rule}\` | ${esc(e.description)} |`),
    ].join('\n');

  const errors = all.filter((e) => e.severity === 'error' && /^MDE/.test(e.rule));
  const warnings = all.filter((e) => e.severity === 'warning' || /^MDW/.test(e.rule));
  const parse = all.filter((e) => /^PARSE/.test(e.rule));

  const out = [
    '---',
    'title: Linter rules',
    'sidebar_label: Linter rules',
    'slug: /cli/lint-rules',
    '---',
    '',
    '# Linter rules',
    '',
    'Every rule `moddef lint` can report. Codes are stable identifiers:',
    '',
    '- **`MDE***`**: errors; a document that trips one is invalid (exit code 1).',
    '- **`MDW***`**: warnings; advisory, the document still validates (exit code 0).',
    '- **`PARSE_*`**: schema-level parse failures (unknown field, bad enum, malformed oneof).',
    '',
    'See [§28 Validation Rules](/spec/v0.4#28-validation-rules) for the normative',
    'descriptions, and the [`moddef` CLI](/cli/reference) for running the linter.',
    '',
    `Generated from the [conformance fixtures](https://github.com/ModDefOrg/moddef/tree/main/fixtures). ${all.length} rules.`,
    '',
    '## Errors',
    '',
    table(errors),
    '',
    '## Warnings',
    '',
    table(warnings),
    '',
    '## Schema parse errors',
    '',
    table(parse),
    '',
  ].join('\n');
  write('docs/cli/lint-rules.mdx', out);
}

// --- CLI reference ---------------------------------------------------------
function syncCli() {
  let help;
  try {
    const bin = '/tmp/moddef-docs-cli';
    // The CLI imports the generated protobuf package (go/genpb), which is a
    // build artifact, so run `buf generate` in the moddef checkout first
    // (CI does; locally the dev tree usually already has it).
    execFileSync('go', ['build', '-o', bin, './cmd/moddef'], {cwd: join(moddef, 'go')});
    help = execFileSync(bin, ['--help'], {encoding: 'utf8'});
  } catch (e) {
    console.warn('CLI build/help failed, writing a fallback page:', e.message);
  }
  const body = help
    ? ['The reference command-line tool (Go). Synced from its `--help` output.', '', '```text', help.trimEnd(), '```']
    : [
        ':::note',
        'The generated CLI reference is unavailable in this build. See the',
        '[`moddef` repository](https://github.com/ModDefOrg/moddef) for the',
        'command-line tool.',
        ':::',
      ];
  // Always write the page so `/cli/` links to it resolve (a missing page is a
  // hard build error under onBrokenLinks: throw).
  const out = [
    '---',
    'title: Full --help output',
    'sidebar_label: --help output',
    'slug: /cli/reference',
    '---',
    '',
    '# Full `moddef --help`',
    '',
    'The verbatim top-level help. See the [command reference](/cli/) for each',
    'subcommand with examples.',
    '',
    ...body,
    '',
  ].join('\n');
  write('docs/cli/reference.mdx', out);
}

// --- Device registry -------------------------------------------------------
const CATEGORY_LABELS = {
  'solar-inverter': 'Solar inverters',
  'energy-meter': 'Energy meters',
  'battery-storage': 'Battery storage',
  'ev-charger': 'EV chargers',
  hvac: 'HVAC',
};

function titleCaseSlug(slug) {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function transportLabel(t) {
  return t.replace(/^MODBUS_/, 'Modbus ');
}

// Pull the device selector id and a representative readable point out of a
// profile, for the per-device code examples.
function profileSample(profileRel) {
  const abs = join(devices, profileRel);
  if (!existsSync(abs)) return {deviceId: null, point: null};
  const prof = yaml.load(readFileSync(abs, 'utf8'));
  const dev0 = (prof.devices || [])[0] || {};
  let withMeasurand = null;
  let firstReadable = null;
  for (const blk of dev0.blocks || []) {
    for (const p of blk.points || []) {
      if ((p.access || 'READ') === 'WRITE_ONLY') continue;
      if (!firstReadable) firstReadable = p.point_id;
      if (p.measurand && !withMeasurand) withMeasurand = p.point_id;
    }
  }
  return {deviceId: dev0.device_id || null, point: withMeasurand || firstReadable};
}

// measurand base_quantity -> catalog entry (name, unit, description).
function measurandCatalog() {
  const src = join(moddef, 'stdlib', 'measurands', '1.0.0', 'measurands.moddef.yaml');
  if (!existsSync(src)) return new Map();
  const doc = yaml.load(readFileSync(src, 'utf8'));
  return new Map((doc.measurands || []).map((m) => [m.measurand_id, m]));
}

function deviceSlug(docId) {
  return docId.replace(/\./g, '-');
}

// The vendor folder slug is the doc_id namespace (the part before the first
// dot), e.g. `carlogavazzi.em24` -> `carlogavazzi`. This groups every device
// from one vendor under a stable, collision-free path.
function vendorSlug(docId) {
  return docId.split('.')[0];
}

function syncDevices() {
  const src = join(devices, 'registry.yaml');
  if (!existsSync(src)) return console.warn('devices registry not found, skipping');
  const reg = yaml.load(readFileSync(src, 'utf8'));
  const catalog = measurandCatalog();
  const repo = 'https://github.com/ModDefOrg/devices';

  const entries = (reg.devices || []).map((d) => {
    const slug = deviceSlug(d.doc_id);
    return {
      vendor: d.vendor,
      model: d.model,
      category: d.category,
      docId: d.doc_id,
      profile: d.profile,
      transports: d.transports || [],
      points: d.points ?? 0,
      status: d.status || 'unknown',
      sourceUrl: d.source_url || '',
      measurands: d.measurands || [],
      href: `/devices/${d.category}/${slug}`,
    };
  });

  // Index page: the filterable browser.
  write(
    'docs/devices/index.mdx',
    [
      '---',
      'title: Device browser',
      'sidebar_label: All devices',
      'sidebar_position: 0',
      'slug: /devices',
      '---',
      '',
      "import DeviceBrowser from '@site/src/components/DeviceBrowser';",
      '',
      '# Device browser',
      '',
      'Ready-to-use ModDef profiles for real hardware, curated in the',
      `[\`devices\`](${repo}) registry (v${reg.version ?? 1}). Pick a device for its`,
      'measurands and per-language usage, or browse by category in the sidebar.',
      '',
      `export const DEVICES = ${JSON.stringify(entries)};`,
      '',
      '<DeviceBrowser devices={DEVICES} />',
      '',
    ].join('\n'),
  );

  // Regenerate the tree from scratch so removed devices (and the pre-vendor
  // flat layout) don't leave orphaned pages that would collide on slug.
  for (const c of new Set((reg.devices || []).map((d) => d.category))) {
    rmSync(join(root, 'docs/devices', c), {recursive: true, force: true});
  }

  // Nested folders: category -> vendor -> device page. The category folder
  // carries a generated index; each vendor folder is a collapsible group.
  const seenCategories = new Set();
  const seenVendors = new Set();
  for (const d of reg.devices || []) {
    if (!seenCategories.has(d.category)) {
      seenCategories.add(d.category);
      write(
        `docs/devices/${d.category}/_category_.json`,
        JSON.stringify(
          {
            label: CATEGORY_LABELS[d.category] || titleCaseSlug(d.category),
            collapsible: true,
            collapsed: false,
            link: {type: 'generated-index', slug: `/devices/${d.category}`},
          },
          null,
          2,
        ) + '\n',
      );
    }

    const vendor = vendorSlug(d.doc_id);
    const vendorKey = `${d.category}/${vendor}`;
    if (!seenVendors.has(vendorKey)) {
      seenVendors.add(vendorKey);
      write(
        `docs/devices/${d.category}/${vendor}/_category_.json`,
        JSON.stringify(
          {
            label: d.vendor,
            collapsible: true,
            collapsed: false,
          },
          null,
          2,
        ) + '\n',
      );
    }

    const slug = deviceSlug(d.doc_id);
    const {deviceId, point} = profileSample(d.profile);
    const profileFile = d.profile.split('/').pop();
    const profileUrl = `${repo}/blob/main/${d.profile}`;

    // Measurand table joined against the catalog.
    const rows = (d.measurands || []).map((q) => {
      const m = catalog.get(q);
      const name = m ? m.name : titleCaseSlug(q);
      const unit = m ? (m.canonical_unit === '1' ? '`1` (ratio)' : `\`${m.canonical_unit}\``) : '';
      const desc = m ? (m.description || '').replace(/\|/g, '\\|') : '';
      return `| \`${q}\` | ${name} | ${unit} | ${desc} |`;
    });

    const meta = [
      `**Status:** ${titleCaseSlug(d.status)}`,
      `**Register points:** ${d.points}`,
      `**Transports:** ${(d.transports || []).map(transportLabel).join(', ')}`,
    ].join(' · ');

    const usage =
      deviceId && point
        ? [
            '## Usage',
            '',
            'Load the profile, bind a transport, and read a point by name. The runtime',
            'applies the offset, scaling, byte order, and sentinels from the definition.',
            '',
            "import DeviceUsage from '@site/src/components/DeviceUsage';",
            '',
            `<DeviceUsage profile="${profileFile}" deviceId="${deviceId}" point="${point}" />`,
            '',
          ]
        : [];

    const body = [
      '---',
      `title: ${d.vendor} ${d.model}`,
      `sidebar_label: ${d.model}`,
      `slug: /devices/${d.category}/${slug}`,
      '---',
      '',
      `# ${d.vendor} ${d.model}`,
      '',
      meta,
      '',
      `A curated ModDef profile for the ${d.vendor} ${d.model}. Import it as`,
      `\`${d.doc_id}\` or load the [\`.moddef.yaml\`](${profileUrl}) directly.`,
      '',
      ...usage,
      '## Measurands',
      '',
      `The ${(d.measurands || []).length} semantic quantities this device reports, each`,
      'linked to the [measurand catalog](/stdlib/measurands). Query a device by',
      'measurand instead of a raw point when you want portable code.',
      '',
      '| Base quantity | Name | Unit | Description |',
      '| --- | --- | --- | --- |',
      ...rows,
      '',
      '## Source',
      '',
      `- Profile: [\`${d.profile}\`](${profileUrl})`,
      ...(d.source_url ? [`- Register map: [vendor documentation](${d.source_url})`] : []),
      '',
    ].join('\n');
    write(`docs/devices/${d.category}/${vendor}/${slug}.mdx`, body);
  }
}

syncSpec();
syncMeasurands();
syncOcppAliases();
syncCore();
syncSunspec();
syncLintRules();
syncCli();
syncDevices();

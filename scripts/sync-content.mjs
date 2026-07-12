// Generate docs pages from the moddef repo: the versioned spec, the stdlib
// measurand catalog, and the CLI reference. Run before `docusaurus build`
// (npm run sync). Outputs are committed so the site builds anywhere; CI
// re-runs this and could drift-check. Single source of truth stays upstream.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const moddef = join(root, '..', 'moddef');

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
  // Drop the leading H1 — the frontmatter title supplies it.
  body = body.replace(/^#\s+.*\n/, '');

  // §27 dumps the whole ~500-line protobuf schema inline. The canonical
  // schema is the .proto files; replace the code block with a link so the
  // rendered spec stays readable (heading + intro kept).
  const protoBase = 'https://github.com/ModDefOrg/moddef/blob/main/proto/moddef/v1';
  const schemaLink = [
    'The canonical schema is the Protobuf definition in',
    `[\`moddef/proto/moddef/v1\`](https://github.com/ModDefOrg/moddef/tree/main/proto/moddef/v1):`,
    '',
    `- [\`types.proto\`](${protoBase}/types.proto) — primitive/value types, enums, transports`,
    `- [\`mapping.proto\`](${protoBase}/mapping.proto) — physical mapping, transforms, fields, strings, write semantics`,
    `- [\`device.proto\`](${protoBase}/device.proto) — device profiles, register blocks, points, variants`,
    `- [\`measurand.proto\`](${protoBase}/measurand.proto) — the measurand model and aliases`,
    `- [\`document.proto\`](${protoBase}/document.proto) — the top-level document and imports`,
    '',
    'The full schema is omitted here to keep the rendered spec readable — the',
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
      const unit = m.canonical_unit === '1' ? '— (ratio)' : `\`${m.canonical_unit}\``;
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
      .join(' · ') || '—';
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
      const head = `### \`${e.type_id}\`${e.name ? ` — ${e.name}` : ''}`;
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
          return `| \`${p.point_id}\` | ${esc(p.name)} | \`${p.storage_type || ''}\` | ${p.unit ? `\`${p.unit}\`` : '—'} | ${off} |`;
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
    '- **`MDE***`** — errors; a document that trips one is invalid (exit code 1).',
    '- **`MDW***`** — warnings; advisory, the document still validates (exit code 0).',
    '- **`PARSE_*`** — schema-level parse failures (unknown field, bad enum, malformed oneof).',
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
    // build artifact — run `buf generate` in the moddef checkout first
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
    '# `moddef` — full `--help`',
    '',
    'The verbatim top-level help. See the [command reference](/cli/) for each',
    'subcommand with examples.',
    '',
    ...body,
    '',
  ].join('\n');
  write('docs/cli/reference.mdx', out);
}

syncSpec();
syncMeasurands();
syncOcppAliases();
syncCore();
syncSunspec();
syncLintRules();
syncCli();

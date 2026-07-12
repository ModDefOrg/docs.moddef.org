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
syncLintRules();
syncCli();

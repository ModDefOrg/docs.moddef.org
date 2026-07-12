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

// --- CLI reference ---------------------------------------------------------
function syncCli() {
  let help;
  try {
    const bin = '/tmp/moddef-docs-cli';
    execFileSync('go', ['build', '-o', bin, './cmd/moddef'], {cwd: join(moddef, 'go')});
    help = execFileSync(bin, ['--help'], {encoding: 'utf8'});
  } catch (e) {
    console.warn('CLI build/help failed, skipping:', e.message);
    return;
  }
  const out = [
    '---',
    'title: CLI reference',
    'sidebar_label: moddef CLI',
    'slug: /cli/reference',
    '---',
    '',
    '# `moddef` CLI',
    '',
    'The reference command-line tool (Go). Synced from its `--help` output.',
    '',
    '```text',
    help.trimEnd(),
    '```',
    '',
  ].join('\n');
  write('docs/cli/reference.mdx', out);
}

syncSpec();
syncMeasurands();
syncCli();

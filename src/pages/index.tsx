// SPDX-License-Identifier: Apache-2.0

import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <img
          className={styles.heroLogo}
          src={useBaseUrl('/moddef-logo-dark.svg')}
          alt="ModDef logo"
          width={128}
          height={128}
        />
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/guide/getting-started">
            Get started
          </Link>
          <Link className="button button--secondary button--lg" to="/spec/">
            Read the spec
          </Link>
        </div>
      </div>
    </header>
  );
}

const SDKS: {name: string; to: string; lang: string}[] = [
  {name: 'Go', to: 'pathname:///sdk/go/', lang: 'reference'},
  {name: 'TypeScript', to: 'pathname:///sdk/typescript/', lang: 'node + browser'},
  {name: 'Rust', to: 'pathname:///sdk/rust/', lang: 'no_std'},
  {name: 'Python', to: 'pathname:///sdk/python/', lang: 'asyncio'},
  {name: 'C', to: 'pathname:///sdk/c/', lang: 'embedded'},
  {name: 'C++', to: 'pathname:///sdk/cpp/', lang: 'C++23'},
];

const SAMPLE = `# growatt-sph.moddef.yaml: one definition, every runtime
- point_id: pv1_voltage
  storage_type: U16
  value_type: { primitive: DECIMAL }
  mapping: { space: INPUT_REGISTER, offset: 3 }
  transform: { scale: { numerator: 1, denominator: 10 } }
  measurand: { base_quantity: voltage }`;

function Pitch() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className="row">
          <div className="col col--6">
            <Heading as="h2">Describe the device once</Heading>
            <p>
              A ModDef document is a declarative map of a device&apos;s Modbus registers:
              storage types, byte order, scaling, sentinels, write constraints, and the
              semantic measurand each point reports. It is the same file whether you read it
              from Go, TypeScript, Rust, Python, C, or C++.
            </p>
            <p>
              No hand-written register offsets scattered across firmware. No re-deriving the
              scale factor in three codebases. The definition is the source of truth; every
              runtime decodes it identically.
            </p>
          </div>
          <div className="col col--6">
            <CodeBlock language="yaml">{SAMPLE}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

const USAGE: {value: string; label: string; lang: string; code: string}[] = [
  {
    value: 'go',
    label: 'Go',
    lang: 'go',
    code: `doc, _ := moddef.Load("growatt-sph.moddef.yaml")
dev, _ := client.New(doc, "growatt-sph", transport)
v, _ := dev.ReadPoint(ctx, "pv1_voltage")
fmt.Println(v) // 230.5`,
  },
  {
    value: 'ts',
    label: 'TypeScript',
    lang: 'ts',
    code: `const doc = await loadDocument("growatt-sph.moddef.yaml");
const dev = Device.create(doc, "growatt-sph", transport);
console.log(await dev.readPoint("pv1_voltage")); // 230.5`,
  },
  {
    value: 'rust',
    label: 'Rust',
    lang: 'rust',
    code: `let doc = moddef_core::load("growatt-sph.moddef.yaml")?;
let mut dev = Device::new(&doc, Some("growatt-sph"), transport)?;
let v = dev.read_point("pv1_voltage").await?; // 230.5`,
  },
  {
    value: 'python',
    label: 'Python',
    lang: 'python',
    code: `doc = load("growatt-sph.moddef.yaml")
dev = Device.create(doc, "growatt-sph", transport)
print(await dev.read_point("pv1_voltage"))  # 230.5`,
  },
  {
    value: 'c',
    label: 'C',
    lang: 'c',
    code: `md_doc_t doc;
md_doc_init(&doc, flash_ptr, flash_len);   /* zero-copy view */
md_dev_t dev;
md_dev_init(&dev, &doc, MD_STR("growatt-sph"), &transport);
md_value_t v;
md_dev_read(&dev, MD_STR("pv1_voltage"), &v); /* v.v.f64 == 230.5 */`,
  },
  {
    value: 'cpp',
    label: 'C++',
    lang: 'cpp',
    code: `auto doc = moddef::Document::view(flash_bytes).value();
auto dev = moddef::Device::open(doc, "growatt-sph", transport).value();
if (auto v = dev->read("pv1_voltage"); v && v->as_f64())
    printf("%.1f V\\n", *v->as_f64()); // 230.5`,
  },
];

function Usage() {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <div className="row">
          <div className="col col--5">
            <Heading as="h2">Use it from your stack</Heading>
            <p>
              Load the definition, bind a transport, and read a point by name. The runtime
              applies the offset, scaling, byte order, and sentinels from the document, so you
              never repeat them in code. The same call returns <code>230.5</code> in every
              language.
            </p>
            <p>
              Or query by meaning with a measurand (&ldquo;grid frequency&rdquo;,
              &ldquo;L1-N voltage&rdquo;) and let the runtime find the point.
            </p>
          </div>
          <div className="col col--7">
            <Tabs groupId="lang">
              {USAGE.map((u) => (
                <TabItem key={u.value} value={u.value} label={u.label}>
                  <CodeBlock language={u.lang}>{u.code}</CodeBlock>
                </TabItem>
              ))}
            </Tabs>
          </div>
        </div>
      </div>
    </section>
  );
}

function SdkGrid() {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <Heading as="h2" className="text--center">
          Idiomatic in every language
        </Heading>
        <p className="text--center">
          One schema, six implementations that share a conformance suite. Pick the SDK your
          stack already speaks.
        </p>
        <div className={clsx('row', styles.sdkRow)}>
          {SDKS.map((s) => (
            <div key={s.name} className="col col--4">
              <Link className={styles.sdkCard} to={s.to}>
                <span className={styles.sdkName}>{s.name}</span>
                <span className={styles.sdkLang}>{s.lang}</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Declarative Modbus device definitions: one schema, every language.">
      <HomepageHeader />
      <main>
        <Pitch />
        <Usage />
        <SdkGrid />
      </main>
    </Layout>
  );
}

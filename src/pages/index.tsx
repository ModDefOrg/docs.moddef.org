import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
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
];

const SAMPLE = `# growatt-sph.moddef.yaml — one definition, every runtime
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
              A ModDef document is a declarative map of a device&apos;s Modbus registers —
              storage types, byte order, scaling, sentinels, write constraints, and the
              semantic measurand each point reports. It is the same file whether you read it
              from Go, TypeScript, Rust, Python, or C.
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

function SdkGrid() {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <Heading as="h2" className="text--center">
          Idiomatic in every language
        </Heading>
        <p className="text--center">
          One schema, five implementations that share a conformance suite. Pick the SDK your
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
      description="Declarative Modbus device definitions — one schema, every language.">
      <HomepageHeader />
      <main>
        <Pitch />
        <SdkGrid />
      </main>
    </Layout>
  );
}

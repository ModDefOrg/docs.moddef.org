// SPDX-License-Identifier: Apache-2.0

import type {ReactNode} from 'react';
import CodeBlock from '@theme/CodeBlock';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

export type DeviceUsageProps = {
  // Profile file name, e.g. "growatt-sph.moddef.yaml".
  profile: string;
  // Device selector inside the profile, e.g. "growatt-sph".
  deviceId: string;
  // A representative readable point id to show in the snippets.
  point: string;
};

// One entry per SDK. `code` is a template over the device's profile file,
// device id, and a sample point, mirroring the getting-started guide so the
// per-device examples read the same way across the docs.
const SNIPPETS: {value: string; label: string; lang: string; code: (p: DeviceUsageProps) => string}[] = [
  {
    value: 'go',
    label: 'Go',
    lang: 'go',
    code: ({profile, deviceId, point}) => `doc, _ := moddef.Load("${profile}")
dev, _ := client.New(doc, "${deviceId}", transport) // your modbus.Transport
v, _ := dev.ReadPoint(ctx, "${point}")
fmt.Println(v)`,
  },
  {
    value: 'ts',
    label: 'TypeScript',
    lang: 'ts',
    code: ({profile, deviceId, point}) => `import {Device} from '@moddef/core';
import {loadDocument} from '@moddef/core/node';

const doc = await loadDocument('${profile}');
const dev = Device.create(doc, '${deviceId}', transport);
console.log(await dev.readPoint('${point}'));`,
  },
  {
    value: 'rust',
    label: 'Rust',
    lang: 'rust',
    code: ({profile, deviceId, point}) => `let doc = moddef_core::load("${profile}")?;
let mut dev = Device::new(&doc, Some("${deviceId}"), transport)?;
let v = dev.read_point("${point}").await?;`,
  },
  {
    value: 'python',
    label: 'Python',
    lang: 'python',
    code: ({profile, deviceId, point}) => `from moddef import Device, load
from moddef.pymodbus import Options, PymodbusTransport

doc = load("${profile}")
transport = await PymodbusTransport.tcp("192.168.1.50", options=Options())
dev = Device.create(doc, "${deviceId}", transport)
print(await dev.read_point("${point}"))`,
  },
  {
    value: 'c',
    label: 'C',
    lang: 'c',
    code: ({deviceId, point}) => `md_doc_t doc;
md_doc_init(&doc, flash_ptr, flash_len);        /* zero-copy view */

md_dev_t dev;
md_dev_init(&dev, &doc, MD_STR("${deviceId}"), &transport);

md_value_t v;
md_dev_read(&dev, MD_STR("${point}"), &v);`,
  },
  {
    value: 'cpp',
    label: 'C++',
    lang: 'cpp',
    code: ({deviceId, point}) => `auto doc = moddef::Document::view(flash_bytes).value();   // zero-copy over flash
auto dev = moddef::Device::open(doc, "${deviceId}", transport).value();

if (auto v = dev->read("${point}"); v)
    std::cout << v->to_string() << '\\n';`,
  },
];

export default function DeviceUsage(props: DeviceUsageProps): ReactNode {
  return (
    <Tabs groupId="lang" queryString>
      {SNIPPETS.map((s) => (
        <TabItem key={s.value} value={s.value} label={s.label}>
          <CodeBlock language={s.lang}>{s.code(props)}</CodeBlock>
        </TabItem>
      ))}
    </Tabs>
  );
}

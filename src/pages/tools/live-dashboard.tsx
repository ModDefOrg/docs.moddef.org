// SPDX-License-Identifier: Apache-2.0

import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

// The live dashboard talks to hardware via the Web Serial API (and a WebSocket
// bridge), so it must render client-side only — none of those globals exist
// during SSR.
export default function LiveDashboardPage(): ReactNode {
  return (
    <Layout
      title="Live dashboard"
      description="Connect to a device over Web Serial and watch its ModDef profile values live in the browser.">
      <main className="container margin-vert--lg">
        <h1>Live dashboard</h1>
        <p>
          Connect to a Modbus device straight from your browser and watch the values from its ModDef
          profile update live. Use <strong>Web Serial</strong> (Chrome/Edge) for Modbus RTU devices, or
          a <strong>WebSocket bridge</strong> for Modbus TCP devices. Everything runs locally — no data
          leaves your machine.
        </p>
        <BrowserOnly>
          {() => {
            const LiveDashboard = require('@site/src/components/LiveDashboard').default;
            const params = new URLSearchParams(window.location.search);
            return <LiveDashboard initialDeviceId={params.get('device') ?? undefined} />;
          }}
        </BrowserOnly>
      </main>
    </Layout>
  );
}

// SPDX-License-Identifier: Apache-2.0

import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const GITHUB_ORG = 'https://github.com/ModDefOrg';

const config: Config = {
  title: 'ModDef',
  tagline: 'Declarative Modbus device definitions: one schema, every language',
  favicon: 'img/favicon.ico',

  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'https://docs.moddef.org',
  baseUrl: '/',

  organizationName: 'ModDefOrg',
  projectName: 'docs.moddef.org',

  onBrokenLinks: 'throw',
  // The imported spec and generated SDK docs carry anchors we can't resolve
  // at build time; don't fail the build on them.
  onBrokenAnchors: 'ignore',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // .md → CommonMark, .mdx → MDX. The synced spec is .md so its `{`, `<`,
  // and `§` content is never parsed as JSX.
  markdown: {
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/', // docs are the site; the React homepage owns '/'
          sidebarPath: './sidebars.ts',
          editUrl: `${GITHUB_ORG}/docs.moddef.org/tree/main/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ModDef',
      logo: {
        alt: 'ModDef',
        src: 'img/logo.svg',
      },
      items: [
        {to: '/guide/getting-started', label: 'Guide', position: 'left'},
        {to: '/spec/', label: 'Spec', position: 'left'},
        {to: '/stdlib/measurands', label: 'Measurands', position: 'left'},
        {to: '/cli/', label: 'CLI', position: 'left'},
        {to: '/sdk/', label: 'SDKs', position: 'left'},
        {href: GITHUB_ORG, label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting started', to: '/guide/getting-started'},
            {label: 'Specification', to: '/spec/'},
            {label: 'Measurand catalog', to: '/stdlib/measurands'},
          ],
        },
        {
          title: 'SDKs',
          items: [
            {label: 'Overview', to: '/sdk/'},
            {label: 'Go', to: 'pathname:///sdk/go/'},
            {label: 'TypeScript', to: 'pathname:///sdk/typescript/'},
            {label: 'Rust', to: 'pathname:///sdk/rust/'},
            {label: 'Python', to: 'pathname:///sdk/python/'},
            {label: 'C', to: 'pathname:///sdk/c/'},
            {label: 'C++', to: 'pathname:///sdk/cpp/'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: GITHUB_ORG},
            {label: 'Device registry', href: `${GITHUB_ORG}/devices`},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ModDef. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'protobuf', 'rust', 'go', 'toml', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

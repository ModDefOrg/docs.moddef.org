# Contributing to moddef.org

Thanks for improving the documentation.

## No CLA

There is no Contributor License Agreement. You keep the copyright to your
contribution and license it to the project under Apache-2.0, the same license
as the rest of this repository.

## Developer Certificate of Origin

Every commit must carry a `Signed-off-by` trailer certifying that you wrote the
change or have the right to submit it. This is the
[Developer Certificate of Origin](https://developercertificate.org/) 1.1.
Commit with `-s`:

```bash
git commit -s -m "Your message"
```

A DCO check runs on each pull request.

## Notes

- The spec, CLI reference, measurand catalog, and per-language API docs are
  generated from sibling repositories at build time; edit them there.
- New tooling source files (`.ts`, `.tsx`, `.mjs`, shell) start with an SPDX
  header. The MDX content pages do not.

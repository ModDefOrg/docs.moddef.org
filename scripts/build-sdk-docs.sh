#!/usr/bin/env bash
# Build each language's API reference with its native tool and drop the HTML
# into static/sdk/<lang>/, which the Docusaurus site serves same-origin at
# /sdk/<lang>/. "Coupled" build: the per-tool config lives here for now (later
# it can migrate into each SDK repo's own CI, publishing artifacts we pull).
#
# Expects sibling checkouts one level up: ../moddef, ../moddef-ts,
# ../moddef-rs, ../moddef-py, ../moddef-c. Each language is best-effort: a
# missing repo or tool logs a warning and leaves the committed placeholder.
set -u

here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/.." && pwd)"
sdk="$here/static/sdk"

log() { printf '\n=== %s ===\n' "$1"; }
warn() { printf 'SKIP: %s\n' "$1" >&2; }

redirect_html() {
  # $1 = target path (relative to the same dir)
  printf '<!doctype html><meta charset=utf-8><meta http-equiv=refresh content="0; url=%s"><link rel=canonical href="%s"><title>Redirecting…</title><a href="%s">Continue to the API reference</a>\n' "$1" "$1" "$1"
}

build_go() {
  log "Go (redirect to pkg.go.dev)"
  mkdir -p "$sdk/go"
  # pkg.go.dev hosts Go module docs for free once the repo is public; a
  # self-hosted pkgsite is the alternative if you need it behind the domain.
  redirect_html "https://pkg.go.dev/github.com/ModDefOrg/moddef/go" > "$sdk/go/index.html"
}

build_rust() {
  command -v cargo >/dev/null || { warn "rust: cargo not found"; return; }
  [ -d "$root/moddef-rs" ] || { warn "rust: ../moddef-rs missing"; return; }
  log "Rust (cargo doc)"
  ( cd "$root/moddef-rs" && cargo doc --no-deps -p moddef-core -p moddef-codegen ) || {
    warn "rust: cargo doc failed"; return; }
  rm -rf "$sdk/rust"
  mkdir -p "$sdk/rust"
  cp -r "$root/moddef-rs/target/doc/." "$sdk/rust/"
  redirect_html "moddef_core/index.html" > "$sdk/rust/index.html"
}

build_typescript() {
  [ -d "$root/moddef-ts" ] || { warn "ts: ../moddef-ts missing"; return; }
  log "TypeScript (TypeDoc)"
  rm -rf "$sdk/typescript"
  ( cd "$root/moddef-ts" && npx --yes typedoc@0.27 \
      --entryPoints packages/core/src/index.ts \
      --tsconfig packages/core/tsconfig.json \
      --out "$sdk/typescript" \
      --name "@moddef/core" --readme none ) || {
    warn "ts: typedoc failed"; return; }
}

build_python() {
  command -v sphinx-build >/dev/null || { warn "python: sphinx-build not found"; return; }
  [ -d "$root/moddef-py" ] || { warn "python: ../moddef-py missing"; return; }
  log "Python (Sphinx)"
  local tmp
  tmp="$(mktemp -d)"
  cat > "$tmp/conf.py" <<'PY'
project = "moddef"
extensions = ["sphinx.ext.autodoc", "sphinx.ext.napoleon", "sphinx.ext.viewcode"]
autodoc_mock_imports = ["pymodbus"]
html_theme = "furo"
html_title = "moddef (Python)"
PY
  cat > "$tmp/index.rst" <<'RST'
moddef — Python API
===================

.. autosummary::
   :toctree: _api
   :recursive:

   moddef
RST
  PYTHONPATH="$root/moddef-py/src" sphinx-build -q -b html "$tmp" "$sdk/python" || {
    warn "python: sphinx-build failed"; rm -rf "$tmp"; return; }
  rm -rf "$tmp"
}

build_c() {
  command -v doxygen >/dev/null || { warn "c: doxygen not found"; return; }
  [ -d "$root/moddef-c" ] || { warn "c: ../moddef-c missing"; return; }
  log "C (Doxygen)"
  rm -rf "$sdk/c"
  mkdir -p "$sdk/c"
  ( cd "$root/moddef-c" && doxygen - >/dev/null <<DOXY
PROJECT_NAME    = "moddef-c"
INPUT           = include/moddef
FILE_PATTERNS   = *.h
RECURSIVE       = YES
GENERATE_LATEX  = NO
GENERATE_HTML   = YES
HTML_OUTPUT     = $sdk/c
QUIET           = YES
JAVADOC_AUTOBRIEF = YES
OPTIMIZE_OUTPUT_FOR_C = YES
DOXY
  ) || { warn "c: doxygen failed"; return; }
}

mkdir -p "$sdk"
build_go
build_rust
build_typescript
build_python
build_c
log "SDK docs done"

#!/usr/bin/env bash
# Build each language's API reference with its native tool and drop the HTML
# into static/sdk/<lang>/, which the Docusaurus site serves same-origin at
# /sdk/<lang>/. "Coupled" build: the per-tool config lives here for now (later
# it can migrate into each SDK repo's own CI, publishing artifacts we pull).
#
# Expects sibling checkouts one level up: ../moddef, ../moddef-ts, ../moddef-rs,
# ../moddef-py, ../moddef-c, ../moddef-cpp. Each language is best-effort: a
# missing repo or tool logs a warning and, crucially, leaves the committed
# placeholder in place. Every tool builds into a temp dir that is swapped into
# static/sdk/<lang>/ only on success, so a failing build never wipes the route.
set -u

here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/.." && pwd)"
sdk="$here/static/sdk"

log() { printf '\n=== %s ===\n' "$1"; }
warn() { printf 'SKIP: %s\n' "$1" >&2; }

redirect_html() {
  printf '<!doctype html><meta charset=utf-8><meta http-equiv=refresh content="0; url=%s"><link rel=canonical href="%s"><title>Redirecting…</title><a href="%s">Continue to the API reference</a>\n' "$1" "$1" "$1"
}

# publish <lang> <tmpdir>: swap tmpdir into static/sdk/<lang> iff it has an
# index.html; otherwise keep the placeholder.
publish() {
  local lang="$1" src="$2"
  if [ -s "$src/index.html" ]; then
    rm -rf "${sdk:?}/$lang"
    mv "$src" "$sdk/$lang"
    printf 'published %s\n' "$lang"
  else
    warn "$lang: no index.html produced; keeping placeholder"
    rm -rf "$src"
  fi
}

build_go() {
  log "Go (redirect to pkg.go.dev)"
  local tmp; tmp="$(mktemp -d)"
  # pkg.go.dev hosts Go module docs for free once the repo is public.
  redirect_html "https://pkg.go.dev/github.com/ModDefOrg/moddef/go" > "$tmp/index.html"
  publish go "$tmp"
}

build_rust() {
  command -v cargo >/dev/null || { warn "rust: cargo not found"; return; }
  [ -d "$root/moddef-rs" ] || { warn "rust: ../moddef-rs missing"; return; }
  log "Rust (cargo doc)"
  ( cd "$root/moddef-rs" && cargo doc --no-deps -p moddef-core -p moddef-codegen ) ||
    { warn "rust: cargo doc failed"; return; }
  local tmp; tmp="$(mktemp -d)"
  cp -r "$root/moddef-rs/target/doc/." "$tmp/"
  redirect_html "moddef_core/index.html" > "$tmp/index.html"
  publish rust "$tmp"
}

build_typescript() {
  [ -d "$root/moddef-ts" ] || { warn "ts: ../moddef-ts missing"; return; }
  command -v npm >/dev/null || { warn "ts: npm not found"; return; }
  log "TypeScript (TypeDoc)"
  # TypeDoc runs the TS compiler, which needs the package's dependencies.
  if [ ! -d "$root/moddef-ts/node_modules" ]; then
    ( cd "$root/moddef-ts" && npm ci --ignore-scripts ) ||
      { warn "ts: npm ci failed"; return; }
  fi
  local tmp; tmp="$(mktemp -d)"
  ( cd "$root/moddef-ts" && npx --yes typedoc@0.27 \
      --entryPoints packages/core/src/index.ts \
      --tsconfig packages/core/tsconfig.json \
      --out "$tmp" \
      --name "@moddef/core" --readme none --skipErrorChecking ) ||
    { warn "ts: typedoc failed"; rm -rf "$tmp"; return; }
  publish typescript "$tmp"
}

build_python() {
  command -v sphinx-build >/dev/null || { warn "python: sphinx-build not found"; return; }
  command -v sphinx-apidoc >/dev/null || { warn "python: sphinx-apidoc not found"; return; }
  [ -d "$root/moddef-py/src/moddef" ] || { warn "python: ../moddef-py missing"; return; }
  log "Python (Sphinx)"
  local src out; src="$(mktemp -d)"; out="$(mktemp -d)"
  # Per-module .rst from the package, excluding the generated protobuf modules.
  sphinx-apidoc -q -f -e -M -o "$src" \
    "$root/moddef-py/src/moddef" "$root/moddef-py/src/moddef/v1" ||
    { warn "python: sphinx-apidoc failed"; rm -rf "$src" "$out"; return; }
  cat > "$src/conf.py" <<'PY'
project = "moddef"
extensions = ["sphinx.ext.autodoc", "sphinx.ext.napoleon", "sphinx.ext.viewcode"]
autodoc_mock_imports = ["pymodbus"]
autodoc_default_options = {"members": True, "undoc-members": True, "show-inheritance": True}
html_theme = "furo"
html_title = "moddef (Python)"
PY
  cat > "$src/index.rst" <<'RST'
moddef Python API
=================

The Python runtime for ModDef. See the `guide </guide/getting-started>`_ for
usage; this is the generated API reference.

.. toctree::
   :maxdepth: 2

   modules
RST
  PYTHONPATH="$root/moddef-py/src" sphinx-build -q -b html "$src" "$out" ||
    { warn "python: sphinx-build failed"; rm -rf "$src" "$out"; return; }
  rm -rf "$src"
  publish python "$out"
}

build_c() {
  command -v doxygen >/dev/null || { warn "c: doxygen not found"; return; }
  [ -d "$root/moddef-c" ] || { warn "c: ../moddef-c missing"; return; }
  log "C (Doxygen)"
  local tmp; tmp="$(mktemp -d)"
  # moddef-c has no committed Doxyfile; README.md is the main page, headers
  # supply the reference.
  ( cd "$root/moddef-c" && doxygen - >/dev/null <<DOXY
PROJECT_NAME       = "moddef-c"
INPUT              = include/moddef README.md
FILE_PATTERNS      = *.h *.md
USE_MDFILE_AS_MAINPAGE = README.md
RECURSIVE          = YES
GENERATE_LATEX     = NO
GENERATE_HTML      = YES
HTML_OUTPUT        = $tmp
GENERATE_TREEVIEW  = YES
QUIET              = YES
WARN_IF_UNDOCUMENTED = NO
EXTRACT_ALL        = YES
JAVADOC_AUTOBRIEF  = YES
OPTIMIZE_OUTPUT_FOR_C = YES
HAVE_DOT           = NO
DOXY
  ) || { warn "c: doxygen failed"; rm -rf "$tmp"; return; }
  publish c "$tmp"
}

build_cpp() {
  command -v doxygen >/dev/null || { warn "cpp: doxygen not found"; return; }
  [ -f "$root/moddef-cpp/Doxyfile" ] || { warn "cpp: ../moddef-cpp/Doxyfile missing"; return; }
  log "C++ (Doxygen)"
  local tmp; tmp="$(mktemp -d)"
  # Use the repo's committed Doxyfile; override only the output location
  # (later assignments win when config is piped to `doxygen -`).
  ( cd "$root/moddef-cpp" && { cat Doxyfile; printf 'OUTPUT_DIRECTORY=\nHTML_OUTPUT=%s\n' "$tmp"; } | doxygen - >/dev/null ) ||
    { warn "cpp: doxygen failed"; rm -rf "$tmp"; return; }
  publish cpp "$tmp"
}

mkdir -p "$sdk"
build_go
build_rust
build_typescript
build_python
build_c
build_cpp
log "SDK docs done"

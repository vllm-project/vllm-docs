#!/usr/bin/env bash
# Build a single-version content bundle from external/vllm/docs.
#
# Usage:
#   VERSION=latest scripts/build-bundle.sh
#   VERSION=stable VLLM_REF=v0.6.4 scripts/build-bundle.sh
#
# Inputs:
#   VERSION         stable | latest | nightly        (required)
#   VLLM_REF        git ref to checkout in external/vllm  (default: leave alone)
#   VLLM_REPO_PATH  override path to vllm repo            (default: external/vllm)
#
# Output:
#   bundle/<version>/bundle.json
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:?VERSION env var required: stable|latest|nightly}"
DEFAULT_VLLM_REPO_PATH="$ROOT/external/vllm"
VLLM_REPO_PATH="${VLLM_REPO_PATH:-$DEFAULT_VLLM_REPO_PATH}"

case "$VERSION" in
  stable|latest|nightly) ;;
  *) echo "VERSION must be one of: stable, latest, nightly" >&2; exit 2 ;;
esac

# Keep the bundled submodule lean. We need:
#   docs/                  — markdown source (the page bodies)
#   examples/              — runnable scripts surfaced as example pages
#   vllm/benchmarks/       — AST extractor reads bench_*.add_cli_args
#   vllm/config/           — AST extractor reads *Config dataclasses
#   vllm/engine/           — AST extractor reads EngineArgs / AsyncEngineArgs
#   vllm/entrypoints/      — `--8<-- "vllm/entrypoints/.../protocol.py:X"`
#                            + AST extractor reads serve / chat / complete /
#                              run-batch CLI parsers
#   vllm/envs.py           — `--8<-- "vllm/envs.py"`
#   vllm/pooling_params.py — `--8<-- "vllm/pooling_params.py:X"`
#
# `vllm/model_executor/` is deliberately omitted (~14M for one Internals
# page) — the snippet resolver falls back to a GitHub link for missing
# source-file includes, which is the right UX for "look at the canonical
# PyTorch reference impl of this op" anyway.
# Skip when VLLM_REPO_PATH points elsewhere — that's the user's own checkout
# and we shouldn't touch it.
SPARSE_PATHS=(
  '/docs/*'
  '/examples/*'
  '/vllm/benchmarks/*'
  '/vllm/config/*'
  '/vllm/engine/*'
  '/vllm/entrypoints/*'
  '/vllm/envs.py'
  '/vllm/pooling_params.py'
)
if [[ "$VLLM_REPO_PATH" == "$DEFAULT_VLLM_REPO_PATH" && -e "$VLLM_REPO_PATH/.git" ]]; then
  # `|| true` keeps the diagnostic pipeline from terminating the script
  # under `set -euo pipefail` when git exits non-zero on a partial/cached
  # working tree. If the read fails we just reconfigure unconditionally.
  current="$(git -C "$VLLM_REPO_PATH" sparse-checkout list 2>/dev/null | sort | tr '\n' ' ' || true)"
  expected="$(printf '%s\n' "${SPARSE_PATHS[@]}" | sort | tr '\n' ' ')"
  enabled="$(git -C "$VLLM_REPO_PATH" config core.sparseCheckout 2>/dev/null || true)"
  if [[ "$enabled" != "true" || "$current" != "$expected" ]]; then
    echo "==> Configuring sparse-checkout on $VLLM_REPO_PATH (docs, examples, vllm)"
    git -C "$VLLM_REPO_PATH" sparse-checkout set --no-cone "${SPARSE_PATHS[@]}"
  fi
fi

if [[ ! -d "$VLLM_REPO_PATH/docs" ]]; then
  echo "vllm docs not found at $VLLM_REPO_PATH/docs" >&2
  echo "  run: git submodule update --init --recursive" >&2
  echo "  or:  set VLLM_REPO_PATH to a local checkout" >&2
  exit 1
fi

if [[ -n "${VLLM_REF:-}" ]]; then
  echo "==> Checking out $VLLM_REF in $VLLM_REPO_PATH"
  git -C "$VLLM_REPO_PATH" fetch --depth=1 origin "$VLLM_REF" || true
  git -C "$VLLM_REPO_PATH" checkout FETCH_HEAD 2>/dev/null || git -C "$VLLM_REPO_PATH" checkout "$VLLM_REF"
fi

VLLM_SHA="$(git -C "$VLLM_REPO_PATH" rev-parse HEAD)"
VLLM_REF_NAME="${VLLM_REF:-$(git -C "$VLLM_REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)}"
OUT_DIR="$ROOT/bundle/$VERSION"
mkdir -p "$OUT_DIR"

echo "==> Building bundle: version=$VERSION ref=$VLLM_REF_NAME sha=${VLLM_SHA:0:12}"
echo "==> Source: $VLLM_REPO_PATH/docs"
echo "==> Output: $OUT_DIR/bundle.json"

# Generate the argparse tables the docs reference via
# `--8<-- "docs/generated/argparse/<name>.inc.md"`. Two AST-based
# extractors land output in the same path the upstream mkdocs hook
# (`generate_argparse.py`) would have used, so the snippet resolver
# in extract-pages.ts picks it up transparently:
#
#   extract-vllm-configs.py    EngineArgs, AsyncEngineArgs (dataclass-driven)
#   extract-vllm-argparse.py   serve, chat, complete, run-batch, bench_* (12 CLIs)
#
# Both read source directly via `ast` — no `import vllm`, no torch /
# transformers / pydantic_core install needed.
#
# Metrics is the remaining hook that still needs upstream tooling (or
# the snippet resolver renders a graceful placeholder in its place).
if [[ -d "$VLLM_REPO_PATH/vllm/config" && -f "$VLLM_REPO_PATH/vllm/engine/arg_utils.py" ]] \
   && command -v python3 >/dev/null 2>&1; then
  echo "==> Generating EngineArgs argparse tables (AST-based, no vllm import)"
  python3 "$ROOT/scripts/extract-vllm-configs.py" "$VLLM_REPO_PATH" \
    || echo "==> extract-vllm-configs failed (non-fatal — placeholder notes will render)"
fi

if [[ -d "$VLLM_REPO_PATH/vllm/entrypoints" && -d "$VLLM_REPO_PATH/vllm/benchmarks" ]] \
   && command -v python3 >/dev/null 2>&1; then
  echo "==> Generating CLI / bench argparse tables (AST-based, no vllm import)"
  python3 "$ROOT/scripts/extract-vllm-argparse.py" "$VLLM_REPO_PATH" \
    || echo "==> extract-vllm-argparse failed (non-fatal — placeholder notes will render)"
fi

VERSION="$VERSION" \
VLLM_REF="$VLLM_REF_NAME" \
VLLM_SHA="$VLLM_SHA" \
VLLM_DOCS_DIR="$VLLM_REPO_PATH/docs" \
VLLM_REPO_DIR="$VLLM_REPO_PATH" \
OUT_FILE="$OUT_DIR/bundle.json" \
  pnpm --silent --filter @vllm-docs/app exec tsx scripts/extract-pages.ts

# Optional Python extractor pass (CLI / API / metrics / examples).
# Skipped silently if the extractor or vllm itself is unimportable; CI handles
# the real run on a CPU-only ubuntu runner with vllm installed.
if command -v python3 >/dev/null 2>&1 && python3 -c "import extractor" >/dev/null 2>&1; then
  echo "==> Running Python extractors"
  python3 -m extractor.cli \
    --vllm-repo "$VLLM_REPO_PATH" \
    --bundle "$OUT_DIR/bundle.json" \
    --output "$OUT_DIR/bundle.json" \
    || echo "==> Python extractors failed (non-fatal)"
else
  echo "==> Skipping Python extractors (vllm-docs-extractor not installed)"
fi

# Mirror upstream docs/assets/ into apps/docs/public/_vllm-assets/ so img tags
# in markdown (e.g. ../assets/design/foo.png) resolve to /_vllm-assets/foo.png
# at request time. Done once per build; later versions overwrite — fine because
# all three versions ship the same physical site.
ASSETS_SRC="$VLLM_REPO_PATH/docs/assets"
ASSETS_DST="$ROOT/apps/docs/public/_vllm-assets"
if [[ -d "$ASSETS_SRC" ]]; then
  echo "==> Copying assets: $(du -sh "$ASSETS_SRC" | cut -f1) → public/_vllm-assets"
  mkdir -p "$ASSETS_DST"
  # Clean out previous upstream mirror but preserve the `_site/` subtree —
  # site-authored hero SVGs live there and are tracked in git.
  find "$ASSETS_DST" -mindepth 1 -maxdepth 1 -not -name '_site' -exec rm -rf {} +
  cp -R "$ASSETS_SRC"/. "$ASSETS_DST"/
fi

# Build the per-version search index from the bundle.
pnpm --silent --filter @vllm-docs/app exec tsx scripts/build-search-index.ts

echo "==> Done."

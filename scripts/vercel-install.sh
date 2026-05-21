#!/usr/bin/env bash
# Install hook for Vercel.
#
# Vercel strips the parent repo's .git directory after clone, so the usual
# `git submodule update --init` fails ("not a git repository"). Instead,
# clone vllm directly into external/vllm if it isn't already there. This is
# equivalent to what `git submodule update` would have done, but works in an
# environment without parent .git metadata.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VLLM_DIR="external/vllm"

# Keep in sync with SPARSE_PATHS in scripts/build-bundle.sh. The AST-based
# extractors read source directly from vllm/{config,engine,entrypoints,
# benchmarks}/ + envs.py + pooling_params.py, and the snippet resolver
# inlines fenced sections from those same paths. Excluding `vllm/` here
# would force build-bundle.sh to reconfigure sparse-checkout post-cache,
# which previously crashed on Vercel's cached working trees.
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

if [[ ! -d "$VLLM_DIR/docs" ]]; then
  echo "==> Vendoring vllm source via shallow + filtered clone"
  rm -rf "$VLLM_DIR"
  mkdir -p external
  # --filter=blob:none + --sparse keeps the clone tiny: only metadata + tree
  # objects, blobs fetched on demand. Sparse-checkout then materializes
  # exactly the paths we need.
  git clone \
    --depth=1 \
    --filter=blob:none \
    --sparse \
    https://github.com/vllm-project/vllm.git \
    "$VLLM_DIR"
  git -C "$VLLM_DIR" sparse-checkout set --no-cone "${SPARSE_PATHS[@]}"
  echo "==> vllm vendored: $(du -sh "$VLLM_DIR" | cut -f1)"
elif [[ -e "$VLLM_DIR/.git" ]]; then
  # Cached working tree from a previous deploy may have a narrower sparse
  # config. Reconcile it here (network is guaranteed at install time;
  # `set` lazily fetches any newly-included blobs).
  current="$(git -C "$VLLM_DIR" sparse-checkout list 2>/dev/null | sort | tr '\n' ' ' || true)"
  expected="$(printf '%s\n' "${SPARSE_PATHS[@]}" | sort | tr '\n' ' ')"
  if [[ "$current" != "$expected" ]]; then
    echo "==> Reconciling sparse-checkout on cached $VLLM_DIR"
    git -C "$VLLM_DIR" sparse-checkout set --no-cone "${SPARSE_PATHS[@]}"
  fi
fi

pnpm install --frozen-lockfile

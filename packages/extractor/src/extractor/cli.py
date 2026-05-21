"""Entry CLI for the docs extractor.

Usage:
    python -m extractor.cli \
        --vllm-repo /path/to/vllm \
        --bundle bundle/latest/bundle.json \
        --output bundle/latest/bundle.json

Reads the existing bundle (produced by apps/docs/scripts/extract-pages.ts),
augments it with extractor outputs (cli, api, metrics, examples), and writes
the merged bundle back. Each extractor is best-effort: failures are logged
and the bundle is preserved.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from . import api_dump, argparse_dump, examples_dump, metrics_dump

log = logging.getLogger("extractor")
logging.basicConfig(format="%(levelname)s %(name)s: %(message)s", level=logging.INFO)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--vllm-repo", type=Path, required=True, help="path to vllm checkout")
    p.add_argument("--bundle", type=Path, required=True, help="input bundle.json")
    p.add_argument("--output", type=Path, required=True, help="output bundle.json")
    args = p.parse_args()

    bundle_path: Path = args.bundle
    if not bundle_path.exists():
        log.error("bundle not found: %s", bundle_path)
        return 1

    bundle = json.loads(bundle_path.read_text())

    runners = [
        ("cli", lambda: argparse_dump.run(args.vllm_repo)),
        ("api", lambda: api_dump.run(args.vllm_repo)),
        ("metrics", lambda: metrics_dump.run(args.vllm_repo)),
        ("examples", lambda: examples_dump.run(args.vllm_repo)),
    ]

    for key, fn in runners:
        try:
            data = fn()
            if data is None:
                log.warning("[%s] extractor produced no data; skipping", key)
                continue
            bundle[key] = data
            log.info("[%s] OK", key)
        except Exception as e:  # noqa: BLE001
            log.warning("[%s] failed: %s", key, e)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, indent=2))
    log.info("wrote %s", args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())

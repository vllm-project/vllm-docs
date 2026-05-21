"""Dump vllm metrics registry to JSON, AST-only.

The upstream `docs/mkdocs/hooks/generate_metrics.py` works by importing the
metrics module. We avoid the import for the same CUDA/torch reasons as
api_dump and instead scan vllm/v1/metrics/* for `Metric(...)` constructor
calls, harvesting name + documentation.

This is best-effort; if the source uses dynamic registration patterns we
miss those. Real validation belongs to the hook in CI.
"""
from __future__ import annotations

import ast
import logging
from pathlib import Path

log = logging.getLogger("extractor.metrics")

CANDIDATE_GLOBS = (
    "vllm/v1/metrics/**/*.py",
    "vllm/engine/metrics*.py",
    "vllm/metrics/**/*.py",
)


def run(vllm_repo: Path) -> dict | None:
    metrics: list[dict] = []
    seen: set[str] = set()
    for pattern in CANDIDATE_GLOBS:
        for py in sorted(vllm_repo.glob(pattern)):
            try:
                tree = ast.parse(py.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                continue
            for node in ast.walk(tree):
                m = _extract_metric(node)
                if m and m["name"] not in seen:
                    seen.add(m["name"])
                    metrics.append(m)

    log.info("metrics_dump: %d unique metrics", len(metrics))
    return {"metrics": metrics}


def _extract_metric(node: ast.AST) -> dict | None:
    if not isinstance(node, ast.Call):
        return None
    func_name = ""
    if isinstance(node.func, ast.Name):
        func_name = node.func.id
    elif isinstance(node.func, ast.Attribute):
        func_name = node.func.attr
    if not (func_name.endswith("Metric") or func_name in {"Counter", "Gauge", "Histogram"}):
        return None

    name = _kw(node, "name")
    docs = _kw(node, "documentation") or _kw(node, "description")
    if not name:
        return None
    return {"name": name, "documentation": docs or "", "kind": func_name}


def _kw(call: ast.Call, key: str) -> str | None:
    for kw in call.keywords:
        if kw.arg == key and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
            return kw.value.value
    return None

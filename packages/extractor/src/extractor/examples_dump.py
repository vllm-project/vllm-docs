"""Dump examples/ directory to a structured JSON list.

Mirrors `docs/mkdocs/hooks/generate_examples.py` but without writing markdown
to disk. Each example is keyed by relative path and gets:
  - title (derived from filename)
  - kind ("python" | "shell" | "markdown" | "notebook")
  - summary (first non-empty line of the file)
  - source URL (raw github)

The renderer can use this to build a reference page or to link guide pages
to runnable examples without duplicating content.
"""
from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger("extractor.examples")

KIND_BY_EXT = {
    ".py": "python",
    ".sh": "shell",
    ".md": "markdown",
    ".ipynb": "notebook",
    ".yaml": "yaml",
    ".yml": "yaml",
}


def run(vllm_repo: Path) -> dict | None:
    ex_dir = vllm_repo / "examples"
    if not ex_dir.exists():
        log.warning("examples/ not found at %s", ex_dir)
        return None

    out: list[dict] = []
    for f in sorted(ex_dir.rglob("*")):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext not in KIND_BY_EXT:
            continue
        rel = f.relative_to(vllm_repo).as_posix()
        out.append(
            {
                "path": rel,
                "title": _titleize(f.stem),
                "kind": KIND_BY_EXT[ext],
                "summary": _summary(f),
            }
        )
    log.info("examples_dump: %d files", len(out))
    return {"examples": out}


def _titleize(stem: str) -> str:
    return stem.replace("_", " ").replace("-", " ").title()


def _summary(p: Path) -> str:
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#!"):
            continue
        # Strip common comment markers.
        for prefix in ("#", "//", '"""', "'''"):
            if line.startswith(prefix):
                line = line[len(prefix) :].strip()
                break
        if line:
            return line[:200]
    return ""

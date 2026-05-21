"""Dump a Python API surface tree to JSON, AST-only.

We deliberately avoid `import vllm` here — it requires CUDA, torch, and
runtime initialization that isn't always available on docs build runners.
Instead we walk the source via `ast`, harvesting public module / class /
function names and their leading docstring summaries.

Resolution depth is shallow but stable enough to drive a reference index and
the autoref symbol table (`vllm.foo.Bar` -> /<version>/api/...).
"""
from __future__ import annotations

import ast
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("extractor.api")

EXCLUDE_DIRS = {"tests", "test", "_C", "_C_stable_libtorch", "third_party"}


def run(vllm_repo: Path) -> dict | None:
    pkg_dir = vllm_repo / "vllm"
    if not pkg_dir.exists():
        log.warning("vllm package dir missing: %s", pkg_dir)
        return None

    modules: dict[str, dict] = {}
    for py in sorted(pkg_dir.rglob("*.py")):
        rel = py.relative_to(pkg_dir).as_posix()
        if any(part in EXCLUDE_DIRS for part in rel.split("/")):
            continue
        if py.name.startswith("_") and py.name != "__init__.py":
            continue
        mod_name = _module_name(rel)
        if mod_name is None:
            continue
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        info = _harvest(tree)
        if info["classes"] or info["functions"]:
            modules[f"vllm.{mod_name}"] = info

    log.info("api_dump: %d public modules", len(modules))
    return {"modules": modules}


def _module_name(rel: str) -> str | None:
    if rel == "__init__.py":
        return ""
    if rel.endswith("/__init__.py"):
        return rel[: -len("/__init__.py")].replace("/", ".")
    if rel.endswith(".py"):
        return rel[:-3].replace("/", ".")
    return None


def _is_public(name: str) -> bool:
    return not name.startswith("_")


def _summary(node: ast.AST) -> str:
    doc = ast.get_docstring(node)  # type: ignore[arg-type]
    if not doc:
        return ""
    first = doc.strip().split("\n", 1)[0]
    return first.strip()


def _harvest(tree: ast.Module) -> dict[str, Any]:
    classes: list[dict] = []
    functions: list[dict] = []
    module_doc = _summary(tree)

    for node in tree.body:
        if isinstance(node, ast.ClassDef) and _is_public(node.name):
            methods = []
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)) and _is_public(sub.name):
                    methods.append({"name": sub.name, "summary": _summary(sub)})
            classes.append({"name": node.name, "summary": _summary(node), "methods": methods})
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and _is_public(node.name):
            functions.append({"name": node.name, "summary": _summary(node)})

    return {"summary": module_doc, "classes": classes, "functions": functions}

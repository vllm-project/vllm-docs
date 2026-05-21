"""Dump CLI argument schemas to JSON.

Strategy: invoke the upstream `docs/mkdocs/hooks/generate_argparse.py` as a
subprocess from within the vllm repo. It writes `.inc.md` files to
`docs/generated/argparse/`. We then parse those into a structured JSON form
the docs renderer can consume directly.

This keeps the heavy mocking machinery (torch / pydantic_core / runtime
imports) in the upstream hook where it lives close to the source, and our
extractor stays a thin adapter.
"""
from __future__ import annotations

import logging
import re
import subprocess
import sys
from pathlib import Path

log = logging.getLogger("extractor.cli")


def run(vllm_repo: Path) -> dict | None:
    hook = vllm_repo / "docs" / "mkdocs" / "hooks" / "generate_argparse.py"
    if not hook.exists():
        log.warning("upstream argparse hook not found at %s", hook)
        return None

    out_dir = vllm_repo / "docs" / "generated" / "argparse"
    proc = subprocess.run(
        [sys.executable, str(hook)],
        cwd=vllm_repo,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if proc.returncode != 0:
        log.warning("argparse hook exited %d: %s", proc.returncode, proc.stderr[-500:])
        return None
    if not out_dir.exists():
        log.warning("argparse output dir missing after hook ran")
        return None

    commands: dict[str, dict] = {}
    for inc in sorted(out_dir.glob("*.inc.md")):
        commands[inc.stem] = _parse_inc(inc.read_text(encoding="utf-8"))
    return {"commands": commands}


def _parse_inc(md: str) -> dict:
    """Parse a `.inc.md` file produced by MarkdownFormatter into structured form.

    The upstream formatter emits sections like:
        ## Section heading
        #### `--flag1`, `--flag2`
        :   help text
        :   Default: `value`
    """
    lines = md.splitlines()
    sections: list[dict] = []
    current_section: dict | None = None
    current_arg: dict | None = None

    arg_header_re = re.compile(r"^####\s+`(.+?)`\s*$")
    section_header_re = re.compile(r"^###\s+(.*)$")

    def flush_arg() -> None:
        nonlocal current_arg
        if current_arg and current_section:
            current_section["args"].append(current_arg)
            current_arg = None

    def flush_section() -> None:
        nonlocal current_section
        flush_arg()
        if current_section:
            sections.append(current_section)
            current_section = None

    for raw in lines:
        line = raw.rstrip()
        m = section_header_re.match(line)
        if m:
            flush_section()
            current_section = {"heading": m.group(1).strip(), "args": []}
            continue
        m = arg_header_re.match(line)
        if m:
            flush_arg()
            flags = [f.strip("` ") for f in m.group(1).split("`, `")]
            if current_section is None:
                current_section = {"heading": "", "args": []}
            current_arg = {"flags": flags, "help": "", "default": None, "choices": None}
            continue
        if current_arg is not None:
            stripped = line.strip()
            if stripped.startswith(":"):
                rest = stripped.lstrip(":").strip()
                lower = rest.lower()
                if lower.startswith("default:"):
                    current_arg["default"] = rest.split(":", 1)[1].strip(" `")
                elif lower.startswith("possible choices:"):
                    raw_choices = rest.split(":", 1)[1]
                    current_arg["choices"] = [c.strip(" `") for c in raw_choices.split(",")]
                else:
                    if current_arg["help"]:
                        current_arg["help"] += " " + rest
                    else:
                        current_arg["help"] = rest

    flush_section()
    return {"sections": sections}

#!/usr/bin/env python3
"""Static-extract EngineArgs / AsyncEngineArgs documentation from a vllm
checkout *without* importing vllm.

Background:
  vLLM's upstream `docs/mkdocs/hooks/generate_argparse.py` produces
  `docs/generated/argparse/{engine_args,async_engine_args,…}.inc.md`
  by calling `parser.format_help()` on real argparse objects. That
  requires `import vllm`, which in turn pulls torch, transformers,
  safetensors, pydantic_core … — a ~500MB+ install with brittle
  version pinning across releases.

What this script does instead:
  EngineArgs is a dataclass whose fields are mostly `name: T =
  SomeConfig.attr` references. The actual descriptions live on the
  underlying `*Config` classes in `vllm/config/*.py`, where each
  field is followed by a triple-quoted docstring (PEP-257 attribute
  doc style). We:

    1. ast-parse every `vllm/config/*.py` and `vllm/engine/arg_utils.py`
    2. for each `*Config` class, harvest {field → (type, default, doc)}
    3. walk EngineArgs / AsyncEngineArgs in source order and emit a
       markdown table with type, default, and description per arg.

  No vllm import. No torch. Just `ast` + a small regex pass to
  collapse cross-class references like `ModelConfig.model`.

Usage:
  python3 scripts/extract-vllm-configs.py <vllm_repo_root> [<out_dir>]

  out_dir defaults to <vllm_repo_root>/docs/generated/argparse so the
  files land where extract-pages.ts's `--8<--` resolver already looks.
"""
from __future__ import annotations

import ast
import logging
import re
import sys
import textwrap
from pathlib import Path

log = logging.getLogger("extract-vllm-configs")
logging.basicConfig(level=logging.INFO, format="%(message)s")


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------


def _annotation_to_str(node: ast.AST | None) -> str:
    """Best-effort render an annotation AST back to source-ish text."""
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return "<unparseable>"


def _default_to_str(node: ast.AST | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return "<unparseable>"


def _trim_docstring(s: str) -> str:
    """Dedent + strip the leading/trailing blanks of a docstring."""
    return textwrap.dedent(s).strip()


def _is_config_class(name: str) -> bool:
    """Heuristic — any class in vllm/config/ that ends in Config (or a
    few well-known config-like classes) counts as a source of field docs."""
    return name.endswith("Config") or name in {
        "EPLBConfig",
        "DynamicShapesConfig",
        "IrOpPriorityConfig",
        "PassConfig",
        "OnlineQuantizationConfig",
        "PrefetchOffloadConfig",
        "UVAOffloadConfig",
    }


# ---------------------------------------------------------------------------
# Config-class harvest
# ---------------------------------------------------------------------------


class ConfigField:
    __slots__ = ("name", "type", "default", "doc")

    def __init__(self, name: str, type_: str, default: str, doc: str):
        self.name = name
        self.type = type_
        self.default = default
        self.doc = doc

    def __repr__(self) -> str:
        return f"ConfigField({self.name!r}, doc={self.doc[:40]!r})"


class ConfigClass:
    """A harvested config dataclass: per-field docs + the class-level
    docstring (used as the group description for grouped renders)."""

    __slots__ = ("name", "doc", "fields")

    def __init__(self, name: str, doc: str, fields: dict[str, ConfigField]):
        self.name = name
        self.doc = doc
        self.fields = fields


def harvest_config_class(cls: ast.ClassDef) -> ConfigClass:
    """Walk a class body, pairing each `AnnAssign` (typed field) with the
    `Expr(Str)` docstring that immediately follows it. PEP-257 attribute
    docstring style — used heavily by vllm/config. Also captures the
    class-level docstring as the group description."""
    fields: dict[str, ConfigField] = {}
    stmts = cls.body
    cls_doc = ast.get_docstring(cls) or ""
    cls_doc = _trim_docstring(cls_doc) if cls_doc else ""
    for i, stmt in enumerate(stmts):
        if not isinstance(stmt, ast.AnnAssign):
            continue
        if not isinstance(stmt.target, ast.Name):
            continue
        name = stmt.target.id
        if name.startswith("_"):
            continue
        type_ = _annotation_to_str(stmt.annotation)
        default = _default_to_str(stmt.value)
        # Attribute docstring: the next statement is an Expr(Constant(str))
        doc = ""
        if i + 1 < len(stmts):
            nxt = stmts[i + 1]
            if (
                isinstance(nxt, ast.Expr)
                and isinstance(nxt.value, ast.Constant)
                and isinstance(nxt.value.value, str)
            ):
                doc = _trim_docstring(nxt.value.value)
        fields[name] = ConfigField(name, type_, default, doc)
    return ConfigClass(cls.name, cls_doc, fields)


def harvest_all_configs(vllm_repo: Path) -> dict[str, ConfigClass]:
    """Walk vllm/config/*.py and return {ClassName: ConfigClass}."""
    configs: dict[str, ConfigClass] = {}
    cfg_dir = vllm_repo / "vllm" / "config"
    if not cfg_dir.is_dir():
        log.error("Config dir not found: %s", cfg_dir)
        return configs
    for py in sorted(cfg_dir.glob("*.py")):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except SyntaxError as e:
            log.warning("Skipping %s: %s", py.name, e)
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and _is_config_class(node.name):
                configs[node.name] = harvest_config_class(node)
    log.info("Harvested %d config classes from %s", len(configs), cfg_dir)
    return configs


# ---------------------------------------------------------------------------
# EngineArgs walk
# ---------------------------------------------------------------------------


def harvest_engine_args(arg_utils_path: Path) -> dict[str, list[ConfigField]]:
    """Walk vllm/engine/arg_utils.py and return ordered EngineArgs +
    AsyncEngineArgs field lists (defaults still in their original
    cross-class reference form, e.g. 'ModelConfig.model')."""
    tree = ast.parse(arg_utils_path.read_text(encoding="utf-8"))
    result: dict[str, list[ConfigField]] = {}
    wanted = {"EngineArgs", "AsyncEngineArgs"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name in wanted:
            fields: list[ConfigField] = []
            for stmt in node.body:
                if not isinstance(stmt, ast.AnnAssign):
                    continue
                if not isinstance(stmt.target, ast.Name):
                    continue
                name = stmt.target.id
                if name.startswith("_"):
                    continue
                type_ = _annotation_to_str(stmt.annotation)
                default = _default_to_str(stmt.value)
                fields.append(ConfigField(name, type_, default, ""))
            result[node.name] = fields
    return result


class ArgGroup:
    """A single argparse argument-group inside EngineArgs.add_cli_args:
    the group title (e.g. 'ModelConfig'), its description (the class
    docstring passed via `description=...`), and the source-ordered
    list of EngineArgs field names that were attached to it."""

    __slots__ = ("title", "description_ref", "fields")

    def __init__(self, title: str, description_ref: str, fields: list[str]):
        self.title = title
        self.description_ref = description_ref  # e.g. 'ModelConfig'
        self.fields = fields


def harvest_engine_args_groups(arg_utils_path: Path) -> list[ArgGroup]:
    """Walk EngineArgs.add_cli_args() and extract argparse groups in
    source order.

    The upstream pattern is:

        model_kwargs = get_kwargs(ModelConfig)
        model_group = parser.add_argument_group(
            title="ModelConfig",
            description=ModelConfig.__doc__,
        )
        model_group.add_argument("--model", **model_kwargs["model"])
        model_group.add_argument("--runner", **model_kwargs["runner"])
        ...

    For each `parser.add_argument_group(title=..., description=X.__doc__)`
    we record the title + the class name being referenced. For each
    subsequent `<group_var>.add_argument("--flag", **<kwargs>["fname"])`
    we record `fname` (the EngineArgs field name) into that group.
    """
    tree = ast.parse(arg_utils_path.read_text(encoding="utf-8"))
    add_cli_args: ast.FunctionDef | None = None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "EngineArgs":
            for stmt in node.body:
                if (
                    isinstance(stmt, ast.FunctionDef)
                    and stmt.name == "add_cli_args"
                ):
                    add_cli_args = stmt
                    break
    if add_cli_args is None:
        log.warning("EngineArgs.add_cli_args not found")
        return []

    groups: list[ArgGroup] = []
    # group_var → ArgGroup
    by_var: dict[str, ArgGroup] = {}

    def visit(stmts: list[ast.stmt]) -> None:
        for stmt in stmts:
            # Group creation: `<var> = parser.add_argument_group(title=..., description=...)`
            if (
                isinstance(stmt, ast.Assign)
                and len(stmt.targets) == 1
                and isinstance(stmt.targets[0], ast.Name)
                and isinstance(stmt.value, ast.Call)
                and isinstance(stmt.value.func, ast.Attribute)
                and stmt.value.func.attr == "add_argument_group"
            ):
                var = stmt.targets[0].id
                title = ""
                description_ref = ""
                for kw in stmt.value.keywords:
                    if kw.arg == "title" and isinstance(kw.value, ast.Constant):
                        title = str(kw.value.value)
                    elif kw.arg == "description":
                        # Usually `SomeConfig.__doc__`
                        if (
                            isinstance(kw.value, ast.Attribute)
                            and isinstance(kw.value.value, ast.Name)
                            and kw.value.attr == "__doc__"
                        ):
                            description_ref = kw.value.value.id
                if title:
                    g = ArgGroup(title=title, description_ref=description_ref, fields=[])
                    groups.append(g)
                    by_var[var] = g
                continue

            # Argument attachment: `<group_var>.add_argument("--flag", ...)`
            if (
                isinstance(stmt, ast.Expr)
                and isinstance(stmt.value, ast.Call)
                and isinstance(stmt.value.func, ast.Attribute)
                and stmt.value.func.attr == "add_argument"
                and isinstance(stmt.value.func.value, ast.Name)
            ):
                var = stmt.value.func.value.id
                if var in by_var:
                    fname = _extract_field_name(stmt.value)
                    if fname:
                        by_var[var].fields.append(fname)
                continue

            # Descend into control-flow bodies so conditionally-attached
            # args (e.g. `--model` is added inside an `if not (...):` guard)
            # land in source order, not at the tail of the group.
            for body_attr in ("body", "orelse", "finalbody"):
                body = getattr(stmt, body_attr, None)
                if body:
                    visit(body)
            # try/except handlers each have their own body
            for handler in getattr(stmt, "handlers", []) or []:
                visit(handler.body)

    visit(add_cli_args.body)
    return groups


def _extract_field_name(call: ast.Call) -> str | None:
    """Map an `add_argument("--flag-name", **kwargs["fname"])` call to the
    EngineArgs dataclass field name.

    Prefer the `--flag` derivation (kebab→snake): for some args the kwargs
    subscript names the *Config-class field* rather than the EngineArgs
    field — e.g. `cache_group.add_argument("--kv-cache-dtype",
    **cache_kwargs["cache_dtype"])` registers the EngineArgs field
    `kv_cache_dtype`, not `cache_dtype`. Falls back to the kwargs subscript
    when no positional `--flag` is present.
    """
    # Primary: derive from the first positional --flag argument.
    for arg in call.args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            flag = arg.value
            if flag.startswith("--"):
                return flag.removeprefix("--").replace("-", "_")
    # Fallback: `**kwargs["fname"]`
    for kw in call.keywords:
        if kw.arg is None and isinstance(kw.value, ast.Subscript):
            sl = kw.value.slice
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                return sl.value
            if (
                isinstance(sl, ast.Index)  # type: ignore[attr-defined]
                and isinstance(getattr(sl, "value", None), ast.Constant)
                and isinstance(sl.value.value, str)  # type: ignore[attr-defined]
            ):
                return sl.value.value  # type: ignore[attr-defined]
    return None


# ---------------------------------------------------------------------------
# Cross-resolution
# ---------------------------------------------------------------------------


_REF_RE = re.compile(r"^([A-Z][A-Za-z]+Config)\.([a-zA-Z_][a-zA-Z0-9_]*)$")
_GET_FIELD_RE = re.compile(
    r"^get_field\(([A-Z][A-Za-z]+Config)\s*,\s*['\"]([a-zA-Z_][a-zA-Z0-9_]*)['\"]\)$"
)


def resolve_reference(
    default_src: str, configs: dict[str, ConfigClass]
) -> tuple[str, str] | None:
    """If `default_src` is e.g. 'ModelConfig.model' or 'get_field(Foo,"x")',
    return (resolved_default, doc) from the underlying config class."""
    m = _REF_RE.match(default_src.strip())
    if not m:
        m = _GET_FIELD_RE.match(default_src.strip())
    if not m:
        return None
    cls, field = m.group(1), m.group(2)
    if cls not in configs or field not in configs[cls].fields:
        return None
    f = configs[cls].fields[field]
    return (f.default, f.doc)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _md_escape_cell(s: str) -> str:
    """Make a string safe for a markdown table cell."""
    # Collapse newlines to <br>; escape pipes; trim.
    s = s.strip().replace("|", "\\|")
    s = re.sub(r"\n\s*\n", " ", s)  # paragraph breaks → space
    s = s.replace("\n", " ")
    return s


_AUTOREF_RE = re.compile(r"\[([^\]]+)\]\s*\[[^\]]+\]", re.DOTALL)


def _clean_group_description(s: str) -> str:
    """Sanitize a config-class docstring for use as a group description.

    The bundle's `bundle.refs.symbols` map is only populated by the Python
    API extractor (which needs a full `import vllm`), so on a no-vllm
    build the mkdocs-style reference links `[label][vllm.config.X.field]`
    can't be resolved. Strip the target while keeping the label, which is
    typically already wrapped in backticks (`[\\`foo\\`][...]` → `\\`foo\\``).

    Markdown structure (paragraphs, bullets) is preserved — remark parses
    markdown inside our `<div class="argparse-page" markdown="1">` wrapper
    as long as there's a blank line after the opening tag.
    """
    if not s:
        return ""
    s = _AUTOREF_RE.sub(lambda m: m.group(1), s)
    return s.strip()


def _code(s: str) -> str:
    """Wrap in a markdown code span, escaping `|` so it doesn't act as a
    table-column separator. GFM permits `\\|` inside a cell body even
    within a code span, which remark-gfm honors. Without this, type
    unions like `str | list[str] | None` shred the row into 6 columns."""
    if not s:
        return ""
    return f"`{s.replace('|', '\\|')}`"


def _resolve_field(
    f: ConfigField, configs: dict[str, ConfigClass]
) -> tuple[str, str, str]:
    """Return (type_text, default_text, doc_text) with cross-refs resolved."""
    type_text = f.type
    default_text = f.default
    doc_text = f.doc
    resolved = resolve_reference(default_text, configs)
    if resolved is not None:
        actual_default, actual_doc = resolved
        default_text = actual_default or default_text
        doc_text = actual_doc or doc_text
    return type_text, default_text, doc_text


def _render_table(rows: list[ConfigField], configs: dict[str, ConfigClass]) -> str:
    lines: list[str] = []
    lines.append("| Argument | Type | Default | Description |")
    lines.append("| --- | --- | --- | --- |")
    for f in rows:
        type_text, default_text, doc_text = _resolve_field(f, configs)
        type_cell = _code(type_text) if type_text else "—"
        default_cell = _code(default_text) if default_text else "—"
        doc_cell = _md_escape_cell(doc_text) if doc_text else "—"
        lines.append(
            f"| `--{f.name.replace('_', '-')}` | {type_cell} | {default_cell} | {doc_cell} |"
        )
    return "\n".join(lines) + "\n"


def render_engine_args_md(
    title: str,
    fields: list[ConfigField],
    configs: dict[str, ConfigClass],
    groups: list[ArgGroup] | None = None,
) -> str:
    """Emit a markdown body for EngineArgs / AsyncEngineArgs.

    If `groups` is provided, split the field list into source-ordered
    argparse groups (matching upstream `EngineArgs.add_cli_args()`),
    rendering each as `### GroupTitle` + description + table. Fields
    not claimed by any group fall through into an "Other" section so
    nothing goes missing. Without `groups`, render a single flat table.
    """
    by_name = {f.name: f for f in fields}

    if not groups:
        body = _render_table(fields, configs)
        return f'<div class="argparse-page" markdown="1">\n\n{body}\n</div>\n'

    out: list[str] = []
    claimed: set[str] = set()
    for g in groups:
        rows = [by_name[n] for n in g.fields if n in by_name]
        claimed.update(n for n in g.fields if n in by_name)
        if not rows:
            continue
        out.append(f"### {g.title}\n\n")
        # Description: the referenced ConfigClass __doc__. Preserve markdown
        # structure (paragraph breaks, bullet lists) — some configs use
        # bullets to enumerate sub-areas (e.g. CompilationConfig's
        # "Top-level / CudaGraph capture / Inductor compilation" outline).
        if g.description_ref and g.description_ref in configs:
            desc = configs[g.description_ref].doc
            if desc:
                desc = _clean_group_description(desc)
                out.append(f"{desc}\n\n")
        out.append(_render_table(rows, configs))
        out.append("\n")

    leftover = [f for f in fields if f.name not in claimed]
    if leftover:
        out.append("### Other\n")
        out.append(
            "\nEngine-level arguments not attached to any config-class group.\n\n"
        )
        out.append(_render_table(leftover, configs))
        out.append("\n")
        log.info("  %s: %d ungrouped fields → 'Other'", title, len(leftover))

    body = "".join(out)
    return f'<div class="argparse-page" markdown="1">\n\n{body}\n</div>\n'


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        log.error("usage: extract-vllm-configs.py <vllm_repo_root> [<out_dir>]")
        return 2
    vllm_repo = Path(argv[1]).expanduser().resolve()
    if not (vllm_repo / "vllm" / "engine" / "arg_utils.py").is_file():
        log.error("Not a vllm checkout (missing vllm/engine/arg_utils.py): %s", vllm_repo)
        return 2
    out_dir = (
        Path(argv[2]).expanduser().resolve()
        if len(argv) >= 3
        else vllm_repo / "docs" / "generated" / "argparse"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    configs = harvest_all_configs(vllm_repo)
    arg_utils = vllm_repo / "vllm" / "engine" / "arg_utils.py"
    engine = harvest_engine_args(arg_utils)
    groups = harvest_engine_args_groups(arg_utils)
    log.info(
        "Extracted %d argparse groups from EngineArgs.add_cli_args", len(groups)
    )

    for cls_name, fields in engine.items():
        # File stem matches what the page expects: engine_args, async_engine_args
        stem = "engine_args" if cls_name == "EngineArgs" else "async_engine_args"
        # Only EngineArgs has explicit upstream argparse groups; render
        # AsyncEngineArgs as a single flat table (it adds one field).
        body = render_engine_args_md(
            cls_name,
            fields,
            configs,
            groups if cls_name == "EngineArgs" else None,
        )
        out_path = out_dir / f"{stem}.inc.md"
        out_path.write_text(body, encoding="utf-8")
        log.info("Wrote %s (%d fields)", out_path, len(fields))

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

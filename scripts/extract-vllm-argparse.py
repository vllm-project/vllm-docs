#!/usr/bin/env python3
"""Static-extract argparse `.inc.md` documentation from a vllm checkout
*without* importing vllm.

Background:
  vLLM's upstream `docs/mkdocs/hooks/generate_argparse.py` produces
  `docs/generated/argparse/{serve,chat,bench_*,...}.inc.md` by calling
  `parser.format_help()` on real argparse objects. That requires
  `import vllm` + torch + pydantic_core + ~500MB of pinned wheels.

  EngineArgs / AsyncEngineArgs are already handled by the sibling
  `extract-vllm-configs.py` (dataclass attribute docstrings).
  This script handles the remaining 12 entry points, which all share
  the same pattern: an `add_cli_args(parser)` function or class method
  whose body is a sequence of `parser.add_argument(...)` calls.

Strategy:
  AST-parse the source file, locate the entry function/method, walk
  its body collecting:
    - `parser.add_argument_group(title)`         → new heading
    - `<parser|group>.add_argument(*flags, **kw)` → argument row
    - `super().add_cli_args(parser)`              → recurse into parent
    - `<helper>(parser)`                          → recurse into helper
    - `<OtherClass>.add_cli_args(parser)`         → recurse cross-class

  Render in the upstream `MarkdownFormatter` style (### group / #### `--flag`
  + ":   Possible choices" / ":   help" / ":   Default: `...`").

  Unresolvable dynamic expressions (`type=json.loads`, `default=f"x{uuid()}"`,
  `choices=list(SOMETHING.keys())`) render as the literal source expression
  — same trade-off as `extract-vllm-configs.py` makes for unresolved
  EngineArgs references.

Usage:
  python3 scripts/extract-vllm-argparse.py <vllm_repo_root> [<out_dir>]

  out_dir defaults to <vllm_repo_root>/docs/generated/argparse so the files
  land where extract-pages.ts's `--8<--` resolver already looks.
"""
from __future__ import annotations

import ast
import logging
import re
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("extract-vllm-argparse")
logging.basicConfig(level=logging.INFO, format="%(message)s")


# ---------------------------------------------------------------------------
# Entry-point spec table.  (file_path, "function" | "Class.method", out_stem)
# Kept hand-maintained because there are only 12, they're stable, and
# spelling-out the registration makes failures cheap to diagnose.
# ---------------------------------------------------------------------------

ENTRY_POINTS: list[tuple[str, str, str]] = [
    # OpenAI server CLI
    ("vllm/entrypoints/openai/cli_args.py", "make_arg_parser", "serve"),
    ("vllm/entrypoints/cli/openai.py", "ChatCommand.add_cli_args", "chat"),
    ("vllm/entrypoints/cli/openai.py", "CompleteCommand.add_cli_args", "complete"),
    ("vllm/entrypoints/openai/run_batch.py", "make_arg_parser", "run-batch"),
    # Benchmark CLIs (vllm.benchmarks.*)
    ("vllm/benchmarks/latency.py", "add_cli_args", "bench_latency"),
    ("vllm/benchmarks/mm_processor.py", "add_cli_args", "bench_mm_processor"),
    ("vllm/benchmarks/serve.py", "add_cli_args", "bench_serve"),
    ("vllm/benchmarks/throughput.py", "add_cli_args", "bench_throughput"),
    ("vllm/benchmarks/sweep/plot.py", "SweepPlotArgs.add_cli_args", "bench_sweep_plot"),
    ("vllm/benchmarks/sweep/plot_pareto.py", "SweepPlotParetoArgs.add_cli_args", "bench_sweep_plot_pareto"),
    ("vllm/benchmarks/sweep/serve.py", "SweepServeArgs.add_cli_args", "bench_sweep_serve"),
    ("vllm/benchmarks/sweep/serve_workload.py", "SweepServeWorkloadArgs.add_cli_args", "bench_sweep_serve_workload"),
]


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------


def _unparse(node: ast.AST | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return "<unparseable>"


def _literal(node: ast.AST | None) -> str | None:
    """If node is a Constant string/number/bool/None, return its repr; else None."""
    if isinstance(node, ast.Constant):
        return repr(node.value)
    return None


# ---------------------------------------------------------------------------
# Module cache — parse each source file once, expose functions / classes.
# ---------------------------------------------------------------------------


@dataclass
class ConfigField:
    name: str
    type: str = ""
    default: str = ""
    doc: str = ""


@dataclass
class ModuleInfo:
    path: Path
    package: tuple[str, ...]  # e.g. ("vllm", "benchmarks", "sweep") for sweep/serve.py
    tree: ast.Module
    functions: dict[str, ast.FunctionDef] = field(default_factory=dict)
    classes: dict[str, ast.ClassDef] = field(default_factory=dict)
    imports: dict[str, str] = field(default_factory=dict)  # local-name → absolute dotted path


_MODULE_CACHE: dict[Path, ModuleInfo] = {}


def _trim_docstring(s: str) -> str:
    """PEP-257-style docstring normalization: dedent based on lines AFTER
    the first (the first line has no leading whitespace because it follows
    the opening quotes), then strip leading/trailing blanks."""
    if not s:
        return ""
    lines = s.expandtabs().splitlines()
    if len(lines) == 1:
        return lines[0].strip()
    rest = lines[1:]
    rest_dedented = textwrap.dedent("\n".join(rest))
    return (lines[0].strip() + "\n" + rest_dedented).strip()


def harvest_dataclass(cls: ast.ClassDef) -> list[ConfigField]:
    """Walk a class body, pairing each `AnnAssign` (typed field) with the
    `Expr(Str)` docstring that immediately follows it (PEP-257 attribute doc)."""
    out: list[ConfigField] = []
    stmts = cls.body
    for i, stmt in enumerate(stmts):
        if not isinstance(stmt, ast.AnnAssign):
            continue
        if not isinstance(stmt.target, ast.Name):
            continue
        name = stmt.target.id
        if name.startswith("_"):
            continue
        type_ = _unparse(stmt.annotation)
        default = _unparse(stmt.value) if stmt.value is not None else ""
        doc = ""
        if i + 1 < len(stmts):
            nxt = stmts[i + 1]
            if (
                isinstance(nxt, ast.Expr)
                and isinstance(nxt.value, ast.Constant)
                and isinstance(nxt.value.value, str)
            ):
                doc = _trim_docstring(nxt.value.value)
        out.append(ConfigField(name=name, type=type_, default=default, doc=doc))
    return out


def _resolve_relative(package: tuple[str, ...], level: int, mod: str | None) -> str:
    """Compute the absolute dotted module path for a relative ImportFrom.
    package = the package the importing file lives in; level = number of
    leading dots; mod = the trailing module name (may be empty)."""
    if level == 0:
        return mod or ""
    # Each "." after the first walks one parent up. `level=1` keeps the
    # current package.
    if level > len(package):
        return mod or ""
    base = package[: len(package) - (level - 1)]
    if mod:
        return ".".join((*base, mod))
    return ".".join(base)


def load_module(path: Path, repo_root: Path | None = None) -> ModuleInfo | None:
    """Parse a python file once and index its top-level names."""
    path = path.resolve()
    if path in _MODULE_CACHE:
        return _MODULE_CACHE[path]
    if not path.is_file():
        return None
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError as e:
        log.warning("Skipping %s: %s", path, e)
        return None
    package: tuple[str, ...] = ()
    if repo_root is not None:
        try:
            rel = path.resolve().relative_to(repo_root.resolve())
            parts = rel.parts
            # Drop trailing filename (file.py or __init__.py)
            if parts[-1] == "__init__.py":
                package = parts[:-1]
            else:
                package = parts[:-1]
        except ValueError:
            package = ()
    info = ModuleInfo(path=path, package=package, tree=tree)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            info.functions[node.name] = node
        elif isinstance(node, ast.ClassDef):
            info.classes[node.name] = node
        elif isinstance(node, ast.ImportFrom):
            mod = _resolve_relative(package, node.level, node.module)
            for alias in node.names:
                local = alias.asname or alias.name
                info.imports[local] = f"{mod}.{alias.name}" if mod else alias.name
        elif isinstance(node, ast.Import):
            for alias in node.names:
                local = alias.asname or alias.name
                info.imports[local] = alias.name
    _MODULE_CACHE[path] = info
    return info


def find_classmethod(cls: ast.ClassDef, name: str) -> ast.FunctionDef | None:
    for stmt in cls.body:
        if isinstance(stmt, ast.FunctionDef) and stmt.name == name:
            return stmt
    return None


def _resolve_class_in_module(
    name: str, module: ModuleInfo, repo_root: Path
) -> tuple[ast.ClassDef, ModuleInfo] | None:
    """Find a class by name in `module`, or follow `module.imports[name]` (via
    re-exports) to its defining module."""
    cls = module.classes.get(name)
    if cls is not None:
        return cls, module
    if name not in module.imports:
        return None
    dotted = module.imports[name]
    mod_dotted, _, original = dotted.rpartition(".")
    if not mod_dotted:
        return None
    mod_path = _dotted_to_path(mod_dotted, repo_root)
    if mod_path is None:
        return None
    target = load_module(mod_path, repo_root)
    if target is None:
        return None
    if original in target.classes:
        return target.classes[original], target
    # Re-export chain
    if original in target.imports:
        return _resolve_class_in_module(original, target, repo_root)
    return None


def _dotted_to_path(dotted: str, repo_root: Path) -> Path | None:
    parts = dotted.split(".")
    if not parts or parts[0] != "vllm":
        return None
    as_module = repo_root.joinpath(*parts).with_suffix(".py")
    if as_module.is_file():
        return as_module
    as_pkg = repo_root.joinpath(*parts, "__init__.py")
    if as_pkg.is_file():
        return as_pkg
    return None


def harvest_dataclass_with_mro(
    cls: ast.ClassDef, module: ModuleInfo, repo_root: Path
) -> list[ConfigField]:
    """Harvest dataclass fields including those inherited from base classes
    (base fields first, then own — matches Python's dataclass-inheritance order)."""
    seen: set[str] = set()
    out: list[ConfigField] = []
    for base in cls.bases:
        if not isinstance(base, ast.Name):
            continue
        resolved = _resolve_class_in_module(base.id, module, repo_root)
        if resolved is None:
            continue
        base_cls, base_mod = resolved
        for f in harvest_dataclass_with_mro(base_cls, base_mod, repo_root):
            if f.name not in seen:
                seen.add(f.name)
                out.append(f)
    for f in harvest_dataclass(cls):
        if f.name not in seen:
            seen.add(f.name)
            out.append(f)
    return out


def harvest_all_configs(
    repo_root: Path,
) -> dict[str, dict[str, ConfigField]]:
    """Walk vllm/config/*.py and vllm/engine/arg_utils.py, harvest *Config /
    *Args classes' field maps so defaults like `ModelConfig.foo` or
    `AsyncEngineArgs.enable_log_requests` resolve."""
    configs: dict[str, dict[str, ConfigField]] = {}

    def _harvest_tree(tree: ast.Module, *, include_args: bool = False) -> None:
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            keep = (
                node.name.endswith("Config")
                or node.name
                in {
                    "EPLBConfig",
                    "DynamicShapesConfig",
                    "IrOpPriorityConfig",
                    "PassConfig",
                    "OnlineQuantizationConfig",
                    "PrefetchOffloadConfig",
                    "UVAOffloadConfig",
                }
                or (include_args and node.name.endswith("Args"))
            )
            if not keep:
                continue
            fields = harvest_dataclass(node)
            configs[node.name] = {f.name: f for f in fields}

    cfg_dir = repo_root / "vllm" / "config"
    if cfg_dir.is_dir():
        for py in sorted(cfg_dir.glob("*.py")):
            try:
                tree = ast.parse(py.read_text(encoding="utf-8"))
            except SyntaxError:
                continue
            _harvest_tree(tree)

    arg_utils = repo_root / "vllm" / "engine" / "arg_utils.py"
    if arg_utils.is_file():
        try:
            tree = ast.parse(arg_utils.read_text(encoding="utf-8"))
            _harvest_tree(tree, include_args=True)
        except SyntaxError:
            pass

    return configs


_REF_RE = re.compile(r"^([A-Z][A-Za-z0-9]+)\.([a-zA-Z_][a-zA-Z0-9_]*)$")
_GET_FIELD_RE = re.compile(
    r"^get_field\(([A-Z][A-Za-z0-9]+)\s*,\s*['\"]([a-zA-Z_][a-zA-Z0-9_]*)['\"]\)$"
)


def resolve_default_reference(
    default_src: str, configs: dict[str, dict[str, ConfigField]]
) -> tuple[str, str] | None:
    """Resolve `ModelConfig.foo` or `get_field(Foo, "bar")` to the underlying
    (default, doc) pair from configs."""
    s = default_src.strip()
    m = _REF_RE.match(s) or _GET_FIELD_RE.match(s)
    if not m:
        return None
    cls, fld = m.group(1), m.group(2)
    if cls not in configs or fld not in configs[cls]:
        return None
    f = configs[cls][fld]
    return f.default, f.doc


# ---------------------------------------------------------------------------
# Argument / Group records
# ---------------------------------------------------------------------------


@dataclass
class Argument:
    flags: list[str]
    type_: str = ""
    default: str = ""
    choices: list[str] = field(default_factory=list)
    metavar: str = ""
    nargs: str = ""
    action: str = ""
    required: str = ""
    help: str = ""


@dataclass
class Group:
    title: str  # "" means top-level (no heading)
    description: str = ""
    args: list[Argument] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Body walker
# ---------------------------------------------------------------------------


def _is_parser_target(node: ast.expr, parser_names: set[str]) -> bool:
    """True if `node` is one of the names currently treated as 'a parser'."""
    return isinstance(node, ast.Name) and node.id in parser_names


def _is_arg_method(node: ast.AST, method: str) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and node.attr == method
    )


def _str_const_or_unparse(node: ast.AST) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return _unparse(node)


def _parse_add_argument_call(
    call: ast.Call,
    *,
    kwarg_vars: dict[str, dict[str, ConfigField]] | None = None,
    configs: dict[str, dict[str, ConfigField]] | None = None,
) -> Argument:
    """Translate an `add_argument(...)` Call node into an Argument record.

    If `**xxx_kwargs["field"]` appears in the call's keyword args and
    `kwarg_vars[xxx_kwargs]` is known (from a `get_kwargs(SomeConfig)`
    assignment we tracked earlier), pull help / default / type from that
    field instead.
    """
    arg = Argument(flags=[])
    for a in call.args:
        if isinstance(a, ast.Constant) and isinstance(a.value, str):
            arg.flags.append(a.value)
        elif isinstance(a, ast.JoinedStr):
            # f-string like f"--{key.replace('_', '-')}" — render the source
            arg.flags.append(_unparse(a))
        else:
            arg.flags.append(_unparse(a))
    # First handle **xxx_kwargs["field"] expansion (kw.arg is None)
    for kw in call.keywords:
        if kw.arg is None and kwarg_vars is not None:
            field = _resolve_kwargs_subscript(kw.value, kwarg_vars)
            if field is not None:
                if not arg.help:
                    arg.help = field.doc
                if not arg.default and field.default:
                    arg.default = field.default
                if not arg.type_ and field.type:
                    arg.type_ = field.type
    # Then explicit keywords overwrite anything we filled from **kwargs
    for kw in call.keywords:
        if kw.arg is None:
            continue
        v = kw.value
        if kw.arg == "type":
            arg.type_ = _unparse(v)
        elif kw.arg == "default":
            if isinstance(v, ast.Constant):
                arg.default = repr(v.value) if v.value != "" else '""'
            else:
                arg.default = _unparse(v)
        elif kw.arg == "choices":
            if isinstance(v, (ast.List, ast.Tuple)):
                items = []
                for e in v.elts:
                    if isinstance(e, ast.Constant):
                        items.append(str(e.value))
                    else:
                        items.append(_unparse(e))
                arg.choices = items
            else:
                arg.choices = [_unparse(v)]
        elif kw.arg == "metavar":
            if isinstance(v, ast.Constant):
                arg.metavar = str(v.value)
            elif isinstance(v, (ast.List, ast.Tuple)):
                arg.metavar = ", ".join(_unparse(e) for e in v.elts)
            else:
                arg.metavar = _unparse(v)
        elif kw.arg == "nargs":
            if isinstance(v, ast.Constant):
                arg.nargs = str(v.value)
            else:
                arg.nargs = _unparse(v)
        elif kw.arg == "action":
            if isinstance(v, ast.Constant):
                arg.action = str(v.value)
            else:
                arg.action = _unparse(v)
        elif kw.arg == "required":
            arg.required = _unparse(v)
        elif kw.arg == "help":
            arg.help = _str_const_or_unparse(v)
    # Resolve cross-class default references (e.g. ModelConfig.foo) if configs given
    if configs is not None and arg.default:
        resolved = resolve_default_reference(arg.default, configs)
        if resolved is not None:
            actual_default, actual_doc = resolved
            arg.default = actual_default or arg.default
            if not arg.help and actual_doc:
                arg.help = actual_doc
    return arg


def _resolve_kwargs_subscript(
    node: ast.AST, kwarg_vars: dict[str, dict[str, ConfigField]]
) -> ConfigField | None:
    """If `node` is `<var>["field"]` and var is a tracked kwargs dict,
    return the matching ConfigField."""
    if not isinstance(node, ast.Subscript):
        return None
    if not isinstance(node.value, ast.Name):
        return None
    var = node.value.id
    if var not in kwarg_vars:
        return None
    sl = node.slice
    if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
        return kwarg_vars[var].get(sl.value)
    return None


class Walker:
    """Walks `add_cli_args(parser)`-style bodies, collecting Groups + Arguments.

    Tracks several per-scope name maps:
      - `name_to_group`: variable → Group (for `g.add_argument` routing)
      - `kwarg_vars`: variable → dict[field_name, ConfigField], populated when
        `xxx_kwargs = get_kwargs(SomeConfig)` is seen. This lets us resolve
        `<group>.add_argument("--foo", **xxx_kwargs["foo"])` against the
        underlying dataclass.

    Recurses on super(), same-module helpers, cross-module imports (including
    re-exports through `__init__.py`), and cross-class `Foo.add_cli_args(parser)`.

    The `dispatched_cls` argument to recursion is the *class the user wrote*,
    not necessarily the one defining the method — so that `cls` references
    inside `BaseFrontendArgs.add_cli_args` resolve to `FrontendArgs` when
    that's how the caller dispatched.
    """

    def __init__(
        self,
        repo_root: Path,
        configs: dict[str, dict[str, ConfigField]] | None = None,
    ):
        self.repo_root = repo_root
        self.configs: dict[str, dict[str, ConfigField]] = configs or {}
        self.default_group = Group(title="")
        self.groups: list[Group] = [self.default_group]
        self.seen_methods: set[tuple[Path, str]] = set()

    def visit_body(
        self,
        body: list[ast.stmt],
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
        parser_param: str,
    ) -> None:
        name_to_group: dict[str, Group] = {parser_param: self.default_group}
        kwarg_vars: dict[str, dict[str, ConfigField]] = {}
        # var_strings: local names bound to a known constant string (e.g.
        # `group_name = cls.__name__.replace("Args", "")` → {"group_name":"Frontend"})
        var_strings: dict[str, str] = {}
        self._walk(
            body, module, dispatched_cls, parser_param,
            name_to_group, kwarg_vars, var_strings,
        )

    def _walk(
        self,
        body: list[ast.stmt],
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
        parser_param: str,
        name_to_group: dict[str, Group],
        kwarg_vars: dict[str, dict[str, ConfigField]],
        var_strings: dict[str, str],
    ) -> None:
        for stmt in body:
            self._walk_stmt(
                stmt, module, dispatched_cls, parser_param,
                name_to_group, kwarg_vars, var_strings,
            )

    def _walk_stmt(
        self,
        stmt: ast.stmt,
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
        parser_param: str,
        name_to_group: dict[str, Group],
        kwarg_vars: dict[str, dict[str, ConfigField]],
        var_strings: dict[str, str],
    ) -> None:
        value = None
        assigned_to: str | None = None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            value = stmt.value
            tgt = stmt.targets[0]
            if isinstance(tgt, ast.Name):
                assigned_to = tgt.id

            if assigned_to is not None and isinstance(value, ast.Call):
                fmap = self._maybe_get_kwargs(value, module, dispatched_cls)
                if fmap is not None:
                    kwarg_vars[assigned_to] = fmap
                    return
            # Track string-valued local assignments (e.g. group_name = ...)
            if assigned_to is not None and value is not None:
                resolved_str = _resolve_string_expr(value, dispatched_cls, var_strings)
                if resolved_str is not None:
                    var_strings[assigned_to] = resolved_str
        elif isinstance(stmt, ast.Expr):
            value = stmt.value
        elif isinstance(stmt, ast.Return):
            value = stmt.value

        if isinstance(value, ast.Call):
            if self._handle_call(
                value,
                assigned_to,
                module,
                dispatched_cls,
                parser_param,
                name_to_group,
                kwarg_vars,
                var_strings,
            ):
                return

        if isinstance(stmt, ast.For) and self._handle_kwargs_for_loop(
            stmt, module, dispatched_cls, name_to_group, kwarg_vars
        ):
            return

        for child in ast.iter_child_nodes(stmt):
            if isinstance(child, ast.stmt):
                self._walk_stmt(
                    child, module, dispatched_cls, parser_param,
                    name_to_group, kwarg_vars, var_strings,
                )

    def _maybe_get_kwargs(
        self,
        call: ast.Call,
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
    ) -> dict[str, ConfigField] | None:
        """If `call` is `get_kwargs(SomeConfig)` or `get_kwargs(cls)`, return
        a field map for that class. Otherwise None."""
        if not isinstance(call.func, ast.Name) or call.func.id != "get_kwargs":
            return None
        if not call.args:
            return None
        arg = call.args[0]
        # Direct class reference: get_kwargs(ModelConfig)
        if isinstance(arg, ast.Name):
            if arg.id == "cls" and dispatched_cls is not None:
                cls, cls_mod = dispatched_cls
                fields = harvest_dataclass_with_mro(cls, cls_mod, self.repo_root)
                return {f.name: f for f in fields}
            # Look up in same-module classes first, then via imports
            resolved = _resolve_class_in_module(arg.id, module, self.repo_root)
            if resolved is not None:
                cls, cls_mod = resolved
                fields = harvest_dataclass_with_mro(cls, cls_mod, self.repo_root)
                return {f.name: f for f in fields}
            # Pre-harvested vllm/config/* fallback (handles ModelConfig etc.
            # even if not directly imported)
            if arg.id in self.configs:
                return dict(self.configs[arg.id])
        return None

    def _handle_call(
        self,
        call: ast.Call,
        assigned_to: str | None,
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
        parser_param: str,
        name_to_group: dict[str, Group],
        kwarg_vars: dict[str, dict[str, ConfigField]],
        var_strings: dict[str, str],
    ) -> bool:
        f = call.func
        if isinstance(f, ast.Attribute):
            obj = f.value
            if (
                f.attr == "add_argument"
                and isinstance(obj, ast.Name)
                and obj.id in name_to_group
            ):
                a = _parse_add_argument_call(
                    call, kwarg_vars=kwarg_vars, configs=self.configs
                )
                if a.flags and not any(fl in {"--help", "-h"} for fl in a.flags):
                    name_to_group[obj.id].args.append(a)
                return True
            if (
                f.attr == "add_argument_group"
                and isinstance(obj, ast.Name)
                and obj.id in name_to_group
            ):
                group = self._make_group(call, module, dispatched_cls, var_strings)
                if assigned_to is not None:
                    name_to_group[assigned_to] = group
                return True
            # super().add_cli_args(parser)
            if (
                f.attr == "add_cli_args"
                and isinstance(obj, ast.Call)
                and isinstance(obj.func, ast.Name)
                and obj.func.id == "super"
            ):
                if dispatched_cls is not None:
                    cls, cls_mod = dispatched_cls
                    for base in cls.bases:
                        if isinstance(base, ast.Name):
                            self._dispatch_class_method(
                                base.id, "add_cli_args", cls_mod
                            )
                return True
            if f.attr == "add_cli_args" and isinstance(obj, ast.Name):
                self._dispatch_class_method(obj.id, "add_cli_args", module)
                return True
        if isinstance(f, ast.Name):
            if f.id in module.functions:
                self._recurse_function(module.functions[f.id], module)
                return True
            if f.id in module.imports:
                self._recurse_external_function(f.id, module)
                return True
        return False

    def _handle_kwargs_for_loop(
        self,
        stmt: ast.For,
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
        name_to_group: dict[str, Group],
        kwarg_vars: dict[str, dict[str, ConfigField]],
    ) -> bool:
        """Match the BaseFrontendArgs pattern:

            for key, value in <var>.items():
                extra_flags = value.pop("flags", [])
                <group>.add_argument(*extra_flags, f"--{key.replace('_', '-')}", **value)

        Expand to one Argument per field of <var>'s ConfigField map."""
        it = stmt.iter
        if not (
            isinstance(it, ast.Call)
            and isinstance(it.func, ast.Attribute)
            and it.func.attr == "items"
            and isinstance(it.func.value, ast.Name)
        ):
            return False
        var = it.func.value.id
        fields = kwarg_vars.get(var)
        if fields is None:
            return False
        # Find which group the inner add_argument routes to.
        group: Group | None = None
        for inner in ast.walk(stmt):
            if (
                isinstance(inner, ast.Call)
                and isinstance(inner.func, ast.Attribute)
                and inner.func.attr == "add_argument"
                and isinstance(inner.func.value, ast.Name)
                and inner.func.value.id in name_to_group
            ):
                group = name_to_group[inner.func.value.id]
                break
        if group is None:
            return False
        for fname, cf in fields.items():
            flag = "--" + fname.replace("_", "-")
            a = Argument(flags=[flag])
            a.help = cf.doc
            a.type_ = cf.type
            a.default = cf.default
            if self.configs and a.default:
                resolved = resolve_default_reference(a.default, self.configs)
                if resolved is not None:
                    actual_default, actual_doc = resolved
                    if actual_default:
                        a.default = actual_default
                    if not a.help and actual_doc:
                        a.help = actual_doc
            group.args.append(a)
        return True

    def _make_group(
        self,
        call: ast.Call,
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
        var_strings: dict[str, str],
    ) -> Group:
        title = ""
        description = ""
        if call.args:
            title = _resolve_group_title(call.args[0], dispatched_cls, var_strings)
        if len(call.args) >= 2:
            description = self._resolve_description(call.args[1], module, dispatched_cls)
        for kw in call.keywords:
            if kw.arg == "title":
                title = _resolve_group_title(kw.value, dispatched_cls, var_strings)
            elif kw.arg == "description":
                description = self._resolve_description(kw.value, module, dispatched_cls)
        group = Group(title=title, description=description)
        self.groups.append(group)
        return group

    def _resolve_description(
        self,
        node: ast.AST,
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
    ) -> str:
        """Recognises `<ClassName>.__doc__` and `cls.__doc__` and resolves to
        the underlying class docstring. Anything else that is not a string
        constant is dropped (we don't want to render `Foo.__doc__` literally)."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return _trim_docstring(node.value)
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "__doc__"
            and isinstance(node.value, ast.Name)
        ):
            cls_name = node.value.id
            if cls_name == "cls" and dispatched_cls is not None:
                return _class_docstring(dispatched_cls[0])
            resolved = _resolve_class_in_module(cls_name, module, self.repo_root)
            if resolved is not None:
                return _class_docstring(resolved[0])
        return ""

    def _dispatch_class_method(
        self, class_name: str, method_name: str, module: ModuleInfo
    ) -> None:
        resolved = _resolve_class_in_module(class_name, module, self.repo_root)
        if resolved is None:
            return
        cls, cls_mod = resolved
        method, defining_cls, defining_mod = self._find_method_in_mro(
            cls, cls_mod, method_name
        )
        if method is None:
            return
        # The dispatched class is `cls`; recursion threads that through so
        # `cls` references inside an inherited method bind correctly.
        self._recurse_method(method, defining_mod, (cls, cls_mod))

    def _find_method_in_mro(
        self, cls: ast.ClassDef, module: ModuleInfo, name: str
    ) -> tuple[ast.FunctionDef | None, ast.ClassDef | None, ModuleInfo]:
        m = find_classmethod(cls, name)
        if m is not None:
            return m, cls, module
        for base in cls.bases:
            if isinstance(base, ast.Name):
                resolved = _resolve_class_in_module(base.id, module, self.repo_root)
                if resolved is None:
                    continue
                base_cls, base_mod = resolved
                m, defining, defining_mod = self._find_method_in_mro(
                    base_cls, base_mod, name
                )
                if m is not None:
                    return m, defining, defining_mod
        return None, None, module

    def _recurse_method(
        self,
        method: ast.FunctionDef,
        module: ModuleInfo,
        dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
    ) -> None:
        cls_name = dispatched_cls[0].name if dispatched_cls else "?"
        key = (module.path, f"{cls_name}.{method.name}")
        if key in self.seen_methods:
            return
        self.seen_methods.add(key)
        parser_param = _extract_parser_param(method, is_method=True)
        if parser_param is None:
            return
        self.visit_body(method.body, module, dispatched_cls, parser_param)

    def _recurse_function(self, fn: ast.FunctionDef, module: ModuleInfo) -> None:
        key = (module.path, fn.name)
        if key in self.seen_methods:
            return
        self.seen_methods.add(key)
        parser_param = _extract_parser_param(fn, is_method=False)
        if parser_param is None:
            return
        self.visit_body(fn.body, module, None, parser_param)

    def _recurse_external_function(self, name: str, module: ModuleInfo) -> None:
        resolved = self._chase_import(module, name, kind="function")
        if resolved is None:
            return
        target, fn = resolved
        self._recurse_function(fn, target)

    def _chase_import(
        self, module: ModuleInfo, name: str, *, kind: str, depth: int = 0
    ) -> tuple[ModuleInfo, ast.FunctionDef | ast.ClassDef] | None:
        if name not in module.imports or depth > 4:
            return None
        dotted = module.imports[name]
        mod_dotted, _, original_name = dotted.rpartition(".")
        if not mod_dotted:
            return None
        mod_path = _dotted_to_path(mod_dotted, self.repo_root)
        if mod_path is None:
            return None
        target = load_module(mod_path, self.repo_root)
        if target is None:
            return None
        if kind == "function":
            fn = target.functions.get(original_name)
            if fn is not None:
                return target, fn
        else:
            cls = target.classes.get(original_name)
            if cls is not None:
                return target, cls
        if original_name in target.imports:
            return self._chase_import(target, original_name, kind=kind, depth=depth + 1)
        return None


def _class_docstring(cls: ast.ClassDef) -> str:
    """Return the trimmed triple-quoted docstring at the top of a class body."""
    if not cls.body:
        return ""
    first = cls.body[0]
    if (
        isinstance(first, ast.Expr)
        and isinstance(first.value, ast.Constant)
        and isinstance(first.value.value, str)
    ):
        return _trim_docstring(first.value.value)
    return ""


def _resolve_string_expr(
    node: ast.AST,
    dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
    var_strings: dict[str, str],
) -> str | None:
    """Try to resolve a Python expression to a literal string at extract time.

    Recognises:
      - `"literal"` constants
      - local variable lookups (against var_strings)
      - `cls.__name__` (uses dispatched_cls)
      - `<str_expr>.replace("a", "b")` (recursive)
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id in var_strings:
        return var_strings[node.id]
    if (
        isinstance(node, ast.Attribute)
        and node.attr == "__name__"
        and isinstance(node.value, ast.Name)
        and node.value.id == "cls"
        and dispatched_cls is not None
    ):
        return dispatched_cls[0].name
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "replace"
        and len(node.args) == 2
    ):
        base = _resolve_string_expr(node.func.value, dispatched_cls, var_strings)
        if base is None:
            return None
        if not all(
            isinstance(a, ast.Constant) and isinstance(a.value, str) for a in node.args
        ):
            return None
        old = node.args[0].value  # type: ignore[union-attr]
        new = node.args[1].value  # type: ignore[union-attr]
        return base.replace(old, new)
    return None


def _resolve_group_title(
    node: ast.AST,
    dispatched_cls: tuple[ast.ClassDef, ModuleInfo] | None,
    var_strings: dict[str, str] | None = None,
) -> str:
    s = _resolve_string_expr(node, dispatched_cls, var_strings or {})
    if s is not None:
        return s
    return _str_const_or_unparse(node)


def _extract_parser_param(fn: ast.FunctionDef, *, is_method: bool) -> str | None:
    """Find the name of the parser parameter — usually the first non-self/cls one."""
    posonly = list(fn.args.posonlyargs) + list(fn.args.args)
    if is_method and posonly and posonly[0].arg in {"self", "cls"}:
        posonly = posonly[1:]
    if not posonly:
        return None
    return posonly[0].arg


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


_CELL_NEWLINE_RE = re.compile(r"\s*\n+\s*")


def _flatten_cell(text: str) -> str:
    """Collapse multi-line text into a single line suitable for a Markdown
    table cell. Pipes are escaped; runs of whitespace + newlines collapse to
    a single space so the table layout doesn't break.
    """
    if not text:
        return ""
    text = textwrap.dedent(text).strip()
    text = text.replace("|", "\\|")
    text = _CELL_NEWLINE_RE.sub(" ", text)
    return text


def _render(stem: str, groups: list[Group]) -> str:
    """Render each argparse group as a Markdown table:

        ### group title

        group description.

        | Argument | Type | Default | Description |
        | --- | --- | --- | --- |
        | `--flag`, `-f` | `str` | `'default'` | help text |

    Matches the shape of `engine_args.inc.md` so the renderer's existing
    `.table-scroll` wrapper applies and the table stays width-adaptive
    inside the prose column on narrow viewports.
    """
    out: list[str] = []
    for group in groups:
        # The default unnamed group's args render with no preceding heading,
        # which matches upstream where "positional arguments" / "options" are
        # suppressed.
        if group.title and group.title not in {"positional arguments", "options"}:
            out.append(f"\n### {group.title}\n\n")
            if group.description:
                out.append(f"{group.description.strip()}\n\n")
        if not group.args:
            continue
        out.append("| Argument | Type | Default | Description |\n")
        out.append("| --- | --- | --- | --- |\n")
        for a in group.args:
            # Pipes inside a code span still terminate GFM table cells with
            # remark-gfm, so escape `|` *inside* the backticks too — e.g. a
            # type like `str | list[str] | None` otherwise becomes 3 cells.
            flag_md = "`" + "`, `".join(f.replace("|", "\\|") for f in a.flags) + "`"
            type_md = f"`{a.type_.replace('|', '\\|')}`" if a.type_ else ""
            default_md = ""
            if a.default and a.default not in {"None", "SUPPRESS"}:
                default_md = f"`{_flatten_cell(a.default)}`"
            desc_parts: list[str] = []
            if a.choices:
                joined = ", ".join(f"`{c}`" for c in a.choices)
                desc_parts.append(f"Choices: {joined}.")
            if a.help:
                desc_parts.append(_flatten_cell(a.help))
            desc_md = " ".join(desc_parts).strip()
            out.append(
                f"| {flag_md} | {type_md} | {default_md} | {desc_md} |\n"
            )
        out.append("\n")
    body = "".join(out).lstrip("\n")
    # Wrap the whole thing in a scoping div so .doc-body .argparse-page CSS
    # (first three columns shrink-fit, no-wrap) applies to every group's
    # table. The blank lines around the markdown body are required so
    # remark-parse still sees the tables as block-level GFM tables and
    # doesn't fold them into the surrounding raw HTML.
    return f'<div class="argparse-page" markdown="1">\n\n{body}\n</div>\n'


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def extract_one(
    repo_root: Path,
    source_rel: str,
    entry_spec: str,
    configs: dict[str, dict[str, ConfigField]],
) -> list[Group] | None:
    source_path = repo_root / source_rel
    module = load_module(source_path, repo_root)
    if module is None:
        log.warning("missing source: %s", source_path)
        return None
    walker = Walker(repo_root, configs=configs)
    if "." in entry_spec:
        cls_name, method_name = entry_spec.split(".", 1)
        cls = module.classes.get(cls_name)
        if cls is None:
            log.warning("class %s not in %s", cls_name, source_rel)
            return None
        method, _defining_cls, defining_mod = walker._find_method_in_mro(
            cls, module, method_name
        )
        if method is None:
            log.warning("%s.%s not found in %s", cls_name, method_name, source_rel)
            return None
        walker._recurse_method(method, defining_mod, (cls, module))
    else:
        fn = module.functions.get(entry_spec)
        if fn is None:
            log.warning("function %s not in %s", entry_spec, source_rel)
            return None
        walker._recurse_function(fn, module)
    return walker.groups


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        log.error("usage: extract-vllm-argparse.py <vllm_repo_root> [<out_dir>]")
        return 2
    repo = Path(argv[1]).expanduser().resolve()
    if not (repo / "vllm" / "entrypoints").is_dir():
        log.error("Not a vllm checkout (missing vllm/entrypoints): %s", repo)
        return 2
    out_dir = (
        Path(argv[2]).expanduser().resolve()
        if len(argv) >= 3
        else repo / "docs" / "generated" / "argparse"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    configs = harvest_all_configs(repo)
    log.info("Harvested %d config classes", len(configs))

    n_ok = 0
    n_fail = 0
    for source_rel, entry_spec, stem in ENTRY_POINTS:
        groups = extract_one(repo, source_rel, entry_spec, configs)
        if groups is None:
            n_fail += 1
            continue
        body = _render(stem, groups)
        n_args = sum(len(g.args) for g in groups)
        if n_args == 0:
            log.warning("  %s: 0 arguments harvested — skipping write", stem)
            n_fail += 1
            continue
        out_path = out_dir / f"{stem}.inc.md"
        out_path.write_text(body, encoding="utf-8")
        log.info("Wrote %s (%d arguments)", out_path, n_args)
        n_ok += 1
    log.info("Done: %d ok, %d failed", n_ok, n_fail)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

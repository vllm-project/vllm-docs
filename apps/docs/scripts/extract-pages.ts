/**
 * Walk VLLM_DOCS_DIR, parse each markdown file's heading structure,
 * and emit a single bundle.json conforming to @vllm-docs/content-bundle.
 *
 * This is intentionally minimal:
 *   - reads .md files only (the real vllm docs are markdown)
 *   - extracts title from first # heading or filename
 *   - extracts heading list via remark-parse
 *   - records frontmatter via gray-matter (rarely present)
 *
 * Auto-generated content (cli, api, metrics, examples) is added by the
 * Python extractor in a later phase and merged into the bundle.
 */
import { promises as fs, readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import YAML from 'yaml';
import { minimatch } from 'minimatch';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';
import type {
  Bundle,
  BundleMeta,
  Heading,
  NavNode,
  Page,
  RefsTable,
  Version
} from '@vllm-docs/content-bundle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = (k: string, required = true): string => {
  const v = process.env[k];
  if (!v && required) throw new Error(`Missing env var: ${k}`);
  return v ?? '';
};

const VERSION = env('VERSION') as Version;
const VLLM_REF = env('VLLM_REF');
const VLLM_SHA = env('VLLM_SHA');
const VLLM_DOCS_DIR = env('VLLM_DOCS_DIR');
const OUT_FILE = env('OUT_FILE');

if (!['stable', 'latest', 'nightly'].includes(VERSION)) {
  throw new Error(`VERSION must be stable|latest|nightly, got: ${VERSION}`);
}

const SKIP_DIRS = new Set(['mkdocs', 'assets']);

/**
 * Resolve mkdocs-material `--8<--` snippet includes at bundle-build time.
 *
 * Two forms:
 *   --8<-- "docs/cli/json_tip.inc.md"             whole file
 *   --8<-- "docs/foo.inc.md:section-id"           between markers
 *                                                   --8<-- [start:section-id]
 *                                                   --8<-- [end:section-id]
 *
 * Path is resolved relative to the vllm repo root (typically begins with
 * "docs/"; `README.md:contact-us` style refers to the repo-root README).
 *
 * Missing files (e.g. `docs/generated/argparse/serve.inc.md` produced by
 * the upstream Python extractor that we don't always run locally) are
 * replaced with a GFM-style note callout so the page still renders cleanly
 * instead of leaking the raw directive text.
 */
const SNIPPET_LINE_RE = /^([ \t]*)--8<--[ \t]+"([^"]+)"[ \t]*$/gm;
// Markers may be embedded in source files using comment prefixes:
//   `# --8<-- [start:X]`          (Python / shell / YAML)
//   `// --8<-- [start:X]`         (C / JS / TS)
//   `<!-- --8<-- [start:X] -->`   (HTML / markdown)
// so we tolerate an optional comment-open prefix and an optional `-->` close.
const SNIPPET_MARKER_RE =
  /^[ \t]*(?:#|\/\/|<!--)?[ \t]*--8<--[ \t]+\[(?:start|end):[^\]]+\][ \t]*(?:-->)?[ \t]*\n?/gm;

function extractSnippetSection(content: string, sectionId: string): string | null {
  const esc = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = `^[ \\t]*(?:#|\\/\\/|<!--)?[ \\t]*--8<--[ \\t]+`;
  const suffix = `[ \\t]*(?:-->)?[ \\t]*$`;
  const start = new RegExp(`${prefix}\\[start:${esc}\\]${suffix}`, 'm');
  const end = new RegExp(`${prefix}\\[end:${esc}\\]${suffix}`, 'm');
  const sm = content.match(start);
  if (!sm || sm.index === undefined) return null;
  const afterStart = content.indexOf('\n', sm.index + sm[0].length);
  if (afterStart < 0) return null;
  const em = content.slice(afterStart).match(end);
  if (!em || em.index === undefined) return null;
  return content.slice(afterStart + 1, afterStart + em.index);
}

/**
 * Pre-pass that turns the env-vars page's raw-source dump into a real
 * reference table.
 *
 * The upstream `docs/configuration/env_vars.md` wraps
 *   --8<-- "vllm/envs.py:env-vars-definition"
 * in a ```python fence, which expands to ~1300 lines of Python — the
 * reader has nothing scannable, no anchors, just Cmd-F.
 *
 * The section is structured: `# ================== Header ==================`
 * dividers, per-var leading comments, then `"VAR_NAME": ...`. We parse
 * that line-by-line and emit a section-headed markdown table.
 *
 * The replacement targets the whole fenced block (fence + include +
 * fence-close) so we don't leave a stale ```python wrapper around the
 * table.
 */
const ENV_VARS_BLOCK_RE =
  /```python\s*\n[ \t]*--8<--[ \t]+"vllm\/envs\.py:env-vars-definition"[ \t]*\n```/g;

// Topical buckets, keyed by what each var actually controls in vllm/envs.py.
// Rules are checked in order and the first hit wins, so the ordering is
// load-bearing:
//   1. Hardware-backend prefixes (ROCM_ / TPU_ / XPU_ / CPU_) win over
//      everything else — VLLM_ROCM_USE_AITER_MOE belongs under ROCm, not
//      MoE. Same for VLLM_XPU_USE_SAMPLER_KERNEL etc.
//   2. MoE wins over Distributed. DeepEP / DBO / all2all are MoE-specific
//      communication; we don't want VLLM_DEEPEP_BUFFER_SIZE_MB in
//      Distributed. Generic ALLREDUCE / NCCL without MoE flavour still
//      reaches Distributed below.
//   3. The FLASHINFER fragments in the Kernels rule are deliberately
//      narrow (USE_FLASHINFER_SAMPLER, HAS_FLASHINFER_CUBIN, …) so
//      VLLM_FLASHINFER_MOE_BACKEND lands in MoE and
//      VLLM_FLASHINFER_ALLREDUCE_* lands in Distributed.
//
// `Build & installation` is a hard list because install-time vars live in
// their own H2 section in envs.py — they don't share a clean prefix with
// each other (CMAKE_BUILD_TYPE, VERBOSE, MAX_JOBS, …).
const INSTALL_TIME_VARS = new Set<string>([
  'VLLM_TARGET_DEVICE',
  'VLLM_MAIN_CUDA_VERSION',
  'VLLM_FLOAT32_MATMUL_PRECISION',
  'VLLM_BATCH_INVARIANT',
  'MAX_JOBS',
  'NVCC_THREADS',
  'VLLM_USE_PRECOMPILED',
  'VLLM_SKIP_PRECOMPILED_VERSION_SUFFIX',
  'VLLM_DOCKER_BUILD_CONTEXT',
  'CMAKE_BUILD_TYPE',
  'VERBOSE',
  'VLLM_CONFIG_ROOT'
]);

const CATEGORY_RULES: Array<[RegExp, string]> = [
  // Hardware backends — backend prefix wins over MoE / Distributed.
  [/^VLLM_ROCM_/, 'Hardware: ROCm'],
  [/^VLLM_(TPU_|XLA_)/, 'Hardware: TPU & XLA'],
  [/^VLLM_XPU_/, 'Hardware: Intel XPU'],
  [/^VLLM_(CPU_|ZENTORCH_)/, 'Hardware: CPU'],

  // MoE & experts — fused-MoE kernels, expert routing, DeepEP / DeepEPLL
  // all2all, DBO overlap. Must beat the generic Distributed rule below.
  [/(?:^|_)(MOE|EXPERT|EXPERTS|DEEPEP|DEEPEPLL|ALL2ALL|DBO)(?:_|$)/, 'MoE & experts'],

  // Distributed / EP / collectives — Ray executor, NCCL/PyNCCL, NIXL/Mooncake
  // connectors, P2P checks, pipeline-parallel comm.
  [/^VLLM_(DP|PP|RAY|NCCL|NIXL|MOONCAKE|MORIIO|ELASTIC_EP|HUMMING|P2P)_/, 'Distributed'],
  [/^VLLM_(?:USE|DISABLE|SKIP)_(RAY|NCCL|PYNCCL|P2P)/, 'Distributed'],
  [/ALLREDUCE/, 'Distributed'],
  [/^VLLM_TORCH_DIST_/, 'Distributed'],

  // LoRA.
  [/^VLLM_(LORA_|ALLOW_RUNTIME_LORA_)/, 'LoRA'],

  // Multimodal & media — image/video/audio fetch, mm-processor cache.
  [/^VLLM_(IMAGE_|VIDEO_|AUDIO_|MEDIA_|MM_|MAX_AUDIO_CLIP_FILESIZE|OBJECT_STORAGE_SHM_BUFFER_NAME$)/,
    'Multimodal'],

  // Tool calling & structured output.
  [/^VLLM_(TOOL_|XGRAMMAR_|GPT_OSS_|USE_EXPERIMENTAL_PARSER|ENFORCE_STRICT_TOOL_CALLING|ENABLE_RESPONSES_API_STORE|SYSTEM_START_DATE)/,
    'Tool calling & structured output'],

  // Kernels & quantization — specific kernel-choice / FP-format flags.
  // FLASHINFER_ fragments here are narrow on purpose; broad FLASHINFER_*
  // names (MOE / ALLREDUCE) have already been bucketed above.
  [/^VLLM_(MARLIN|MXFP4|NVFP4|USE_FBGEMM|USE_TRITON_AWQ|USE_FLASHINFER_SAMPLER|BLOCKSCALE_FP8|USE_DEEP_GEMM|DEEP_GEMM|Q_SCALE_CONSTANT|K_SCALE_CONSTANT|V_SCALE_CONSTANT|USE_TRITON_FLASH_ATTN|HAS_FLASHINFER_CUBIN|MULTI_STREAM_GEMM|FLASHINFER_FORCE|FLASHINFER_WORKSPACE|DISABLED_KERNELS|USE_OINK_OPS|ENABLE_FLA_|USE_NVFP4_CT_EMULATIONS)/,
    'Kernels & quantization'],

  // Compilation — torch.compile / Inductor / AOT artifacts / CUDA graphs.
  [/^VLLM_(USE_AOT_COMPILE|FORCE_AOT_LOAD|USE_BYTECODE_HOOK|USE_MEGA_AOT_ARTIFACT|USE_STANDALONE_COMPILE|INDUCTOR_|ENABLE_INDUCTOR_|ENABLE_PREGRAD_PASSES|PATTERN_MATCH_DEBUG|ENABLE_CUDAGRAPH|CUDAGRAPH_|COMPILE_CACHE|DISABLE_COMPILE_CACHE|TUNED_CONFIG)/,
    'Compilation & Inductor'],

  // Caching & storage — KV cache layout, asset/xgrammar/outlines caches,
  // prefix-caching toggle, KV-event encoding.
  [/^VLLM_(CACHE_ROOT|ASSETS_CACHE|XGRAMMAR_CACHE|KV_CACHE_LAYOUT|KV_EVENTS|SSM_CONV_STATE_LAYOUT|DISABLE_PREFIX_CACHING|OUTLINES_CACHE|V1_USE_OUTLINES_CACHE)/,
    'Caching & storage'],

  // API server & networking — `vllm serve` HTTP/RPC plumbing.
  [/^VLLM_(HOST_IP$|PORT$|RPC_|HTTP_|API_KEY|SERVER_DEV_MODE|KEEP_ALIVE|LOOPBACK_IP|SKIP_MODEL_NAME_VALIDATION|RINGBUFFER|MQ_|EXECUTE_MODEL_TIMEOUT|MSGPACK_|ALLOW_INSECURE_SERIALIZATION)/,
    'API server & networking'],

  // Plugins & resolvers.
  [/^VLLM_(PLUGINS$|MODEL_REDIRECT|USE_MODELSCOPE)/, 'Plugins & resolvers'],

  // Testing & CI.
  [/^VLLM_(TEST_|CI_|RANDOMIZE_DP_DUMMY)/, 'Testing & CI'],

  // Logging, telemetry, debug, profiling — including torch profiler.
  [/^VLLM_(LOGGING_|LOG_|DISABLE_LOG|CONFIGURE_LOGGING|TRACE_FUNCTION|USAGE_STATS|USAGE_SOURCE|NO_USAGE_STATS|DO_NOT_TRACK|DEBUG_|GC_DEBUG|COMPUTE_NANS|NVTX_|CUSTOM_SCOPES|MODEL_INSPECTION|TORCH_PROFILER)/,
    'Logging & debug'],

  // Engine internals — V1 runner, multiproc workers, KV offload, MLA, CUDA
  // compat shim, memory profiler.
  [/^VLLM_(ENGINE_|USE_V2_MODEL_RUNNER|USE_V1|ENABLE_V1|V1_OUTPUT_PROC_CHUNK_SIZE|WORKER_MULTIPROC|MAX_N_SEQUENCES|SPARSE_INDEXER|MLA_DISABLE|USE_SIMPLE_KV_OFFLOAD|WEIGHT_OFFLOADING|ALLOW_CHUNKED_LOCAL_ATTN|ALLOW_LONG_MAX_MODEL_LEN|DISABLE_REQUEST_ID_RANDOMIZATION|USE_LAYERNAME|MEMORY_PROFILER|PROCESS_NAME_PREFIX|ENABLE_CUDA_COMPATIBILITY|CUDA_COMPATIBILITY|CUDART_SO_PATH)/,
    'Engine internals']
];

function bucketFor(name: string): string {
  // Install-time vars come from a separate section in envs.py and don't share
  // a clean prefix — keep them as a literal list.
  if (INSTALL_TIME_VARS.has(name)) return 'Build & installation';
  // Non-VLLM_ prefixed are externally-defined env vars vllm reads (S3_*,
  // LD_LIBRARY_PATH, CUDA_VISIBLE_DEVICES, LOCAL_RANK, NO_COLOR).
  if (!name.startsWith('VLLM_')) {
    if (name === 'NO_COLOR') return 'Logging & debug';
    return 'External env vars';
  }
  for (const [re, bucket] of CATEGORY_RULES) {
    if (re.test(name)) return bucket;
  }
  return 'Other';
}

/**
 * Heuristic default-value extraction from a single env var's source
 * expression. Covers the patterns in vllm/envs.py:
 *
 *   os.getenv("VAR", "X")             →  "X"
 *   os.environ.get("VAR", "X")        →  "X"
 *   env_with_choices("VAR", "X", …)   →  "X"
 *   lambda: bool(int(os.getenv("VAR", "0")))  →  False (bool wrap)
 *   lambda: int(os.getenv("VAR", "1024"))     →  1024  (int wrap)
 *   lambda: "literal"                 →  "literal"
 *   no 2nd arg / unrecognized form    →  "" (rendered as —)
 */
function extractEnvDefault(body: string, fullSource = ''): string {
  // If the value expression is a bare function reference (e.g.
  // `"VLLM_X": some_func,`), chase the function definition in fullSource and
  // recurse on its body. The body buffer here starts with `"VAR_NAME": <expr>`
  // — strip the key prefix and trailing comma before checking for an ident.
  const stripped = body
    .trim()
    .replace(/^"[A-Z_][A-Z0-9_]*"\s*:\s*/, '')
    .replace(/,\s*$/, '')
    .trim();
  const ref = stripped.match(/^([a-z_][a-z0-9_]*)$/i);
  if (ref && fullSource) {
    const fnName = ref[1];
    const defRe = new RegExp(`^def\\s+${fnName}\\s*\\([^)]*\\)\\s*(?:->[^:]+)?:\\s*\\n([\\s\\S]*?)(?=\\n(?:def|class|@)|\\n[A-Z_])`, 'm');
    const m = fullSource.match(defRe);
    if (m && m[1]) {
      const fnBody = m[1];
      // Many vllm env helpers have the shape:
      //   if "VAR" not in os.environ:
      //       return None
      //   ... os.getenv("VAR", "0") ...    # "0" is a parse fallback, NOT the default
      // The actual default in that case is None / unset.
      if (/if\s+"[A-Z_][A-Z0-9_]*"\s+not\s+in\s+os\.environ\s*:\s*\n\s*return\s+None\b/.test(fnBody)) {
        return '*(unset)*';
      }
      const resolved = extractEnvDefault(fnBody, fullSource);
      // Only trust the resolved value if it's a recognized literal form — a
      // bare identifier like `default_value` means the function computes the
      // default at runtime and we shouldn't pretend we know it.
      if (resolved && !/^`[a-z_][a-z0-9_]*`$/.test(resolved)) return resolved;
    }
  }
  const find2ndArg = (src: string, fn: RegExp): string | null => {
    const m = src.match(fn);
    if (!m) return null;
    const idx = m.index! + m[0].length;
    // Walk forward respecting paren / bracket depth until we hit the top-level
    // comma — the second arg lives between it and the closing paren.
    let depth = 1; // we're already inside the outer fn(
    let argStart = -1;
    let inString: string | null = null;
    for (let i = idx; i < src.length; i++) {
      const c = src[i];
      // String literals can contain unbalanced delimiters / commas — skip them.
      if (inString) {
        if (c === inString && src[i - 1] !== '\\') inString = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = c;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth === 0) {
          if (argStart < 0) return null;
          return src.slice(argStart, i).trim();
        }
      } else if (c === ',' && depth === 1) {
        if (argStart < 0) {
          // End of first arg → second arg begins next char.
          argStart = i + 1;
        } else {
          // End of second arg.
          return src.slice(argStart, i).trim();
        }
      }
    }
    return null;
  };

  let arg =
    find2ndArg(body, /os\.getenv\s*\(\s*"[A-Z_][A-Z0-9_]*"\s*/) ??
    find2ndArg(body, /os\.environ\.get\s*\(\s*"[A-Z_][A-Z0-9_]*"\s*/) ??
    find2ndArg(body, /env_with_choices\s*\(\s*"[A-Z_][A-Z0-9_]*"\s*/);

  if (arg === null) {
    // Try a bare `lambda: "literal"` or `lambda: <number>` form.
    const lit = body.match(/lambda\s*:\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|True|False|None)\s*[,)}]/);
    if (lit && lit[1]) arg = lit[1];
  }
  if (arg === null) {
    // One-arg `os.getenv("X")` / `os.environ.get("X")` (no default specified) →
    // the implicit default is None. Match before the alt branch above which
    // requires a second comma. Also covers `"X" in os.environ` checks.
    if (
      /os\.getenv\s*\(\s*"[A-Z_][A-Z0-9_]*"\s*\)/.test(body) ||
      /os\.environ\.get\s*\(\s*"[A-Z_][A-Z0-9_]*"\s*\)/.test(body) ||
      /"[A-Z_][A-Z0-9_]*"\s+in\s+os\.environ/.test(body)
    ) {
      return '*(unset)*';
    }
    return '';
  }

  arg = arg.replace(/\s+/g, ' ').trim();

  // Translate the common wrappers into their effective value:
  // `bool(int(os.getenv("X", "0")))` → "0" → False; "1"/anything else → True.
  // We can detect the bool/int wrap by looking back into `body` before the arg.
  if (/bool\s*\(\s*int\s*\(/.test(body) && /^"?(?:0|"")"?$/.test(arg)) return '`False`';
  if (/bool\s*\(\s*int\s*\(/.test(body)) return '`True`';
  if (/^"\d+"$/.test(arg) && /int\s*\(/.test(body)) return `\`${arg.slice(1, -1)}\``;

  // Empty-string defaults read as ""; show as ` ` so the column isn't blank.
  if (arg === '""' || arg === "''") return '*(unset)*';
  // Strip surrounding quotes for plain string defaults.
  const stringLit = arg.match(/^"([^"]*)"$|^'([^']*)'$/);
  if (stringLit) return `\`${stringLit[1] ?? stringLit[2]}\``;
  if (arg === 'None') return '*(unset)*';
  if (arg === 'True' || arg === 'False') return `\`${arg === 'True' ? 'True' : 'False'}\``;
  if (/^-?\d+(?:\.\d+)?$/.test(arg)) return `\`${arg}\``;

  // Complex expression (function call, tempfile.gettempdir(), os.path.join…).
  // Show it inline-code so the reader at least sees the shape.
  if (arg.length > 60) arg = arg.slice(0, 57) + '…';
  return `\`${arg}\``;
}

function parseEnvVarsTable(repoRoot: string): string | null {
  const abs = path.resolve(repoRoot, 'vllm/envs.py');
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf-8');
  const slice = extractSnippetSection(raw, 'env-vars-definition');
  if (slice === null) return null;

  type Row = { name: string; desc: string; defaultVal: string };
  type SubGroup = { name: string; rows: Row[] };
  type Section = { name: string; subgroups: Map<string, SubGroup> };

  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let buf: string[] = [];

  const ensureSection = (name: string): Section => {
    let s = sections.find((x) => x.name === name);
    if (!s) {
      s = { name, subgroups: new Map() };
      sections.push(s);
    }
    return s;
  };

  const ensureSub = (sec: Section, sub: string): SubGroup => {
    let g = sec.subgroups.get(sub);
    if (!g) {
      g = { name: sub, rows: [] };
      sec.subgroups.set(sub, g);
    }
    return g;
  };

  // We need the multi-line value body of each entry to extract a default —
  // walk lines, accumulating a body buffer that resets at the next entry
  // (recognized by a line starting with `"VAR_NAME":` at the dict's indent
  // level, i.e. preceded by 4 spaces in vllm/envs.py).
  const lines = slice.split('\n');
  type Pending = { name: string; section: Section; comments: string[]; body: string[] };
  let pending: Pending | null = null;
  const flush = () => {
    if (!pending) return;
    const sub = ensureSub(pending.section, bucketFor(pending.name));
    sub.rows.push({
      name: pending.name,
      desc: pending.comments.join(' ').trim(),
      defaultVal: extractEnvDefault(pending.body.join('\n'), raw)
    });
    pending = null;
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (!pending) buf = [];
      continue;
    }
    const header = t.match(/^#\s*=+\s*(.+?)\s*=+\s*$/);
    if (header && header[1]) {
      flush();
      currentSection = ensureSection(header[1].trim());
      buf = [];
      continue;
    }
    const comment = t.match(/^#\s?(.*)$/);
    if (comment) {
      if (pending) flush();
      buf.push(comment[1] ?? '');
      continue;
    }
    const entry = t.match(/^"([A-Z_][A-Z0-9_]*)"\s*:/);
    if (entry && entry[1]) {
      flush();
      if (currentSection === null) currentSection = ensureSection('Other');
      pending = {
        name: entry[1],
        section: currentSection,
        comments: buf,
        body: [line]
      };
      buf = [];
      continue;
    }
    if (pending) pending.body.push(line);
  }
  flush();

  if (sections.length === 0) return null;

  // Within each top section, collapse singleton sub-groups into "Other" and
  // sort the rest alphabetically. Inside each sub-group, sort vars by name
  // so users can scan for a known name without scrolling.
  for (const s of sections) {
    const singletons: Row[] = [];
    const named: SubGroup[] = [];
    for (const g of s.subgroups.values()) {
      if (g.rows.length < 2 && g.name !== 'Other') {
        singletons.push(...g.rows);
      } else {
        g.rows.sort((a, b) => a.name.localeCompare(b.name));
        named.push(g);
      }
    }
    named.sort((a, b) => a.name.localeCompare(b.name));
    if (singletons.length) {
      singletons.sort((a, b) => a.name.localeCompare(b.name));
      named.push({ name: 'Other', rows: singletons });
    }
    s.subgroups.clear();
    for (const g of named) s.subgroups.set(g.name, g);
  }

  const out: string[] = [];
  out.push('<div class="env-vars-page">', '');

  // No inline "jump to" — the right-rail TOC picks up the H2 sections and
  // H3 sub-groups below, which is the same information without doubling it
  // at the top of the page.
  for (const s of sections) {
    out.push(`## ${s.name}`, '');
    for (const g of s.subgroups.values()) {
      if (g.rows.length === 0) continue;
      out.push(`### ${g.name}`, '');
      out.push('| Variable | Default | Description |');
      out.push('| --- | --- | --- |');
      for (const r of g.rows) {
        const desc = r.desc
          .replace(/\|/g, '\\|')
          .replace(/\s+/g, ' ')
          .trim() || '—';
        const def = (r.defaultVal || '—').replace(/\|/g, '\\|');
        out.push(`| \`${r.name}\` | ${def} | ${desc} |`);
      }
      out.push('');
    }
  }

  // Version-pinned source link. The bundle build resolves `VLLM_SHA` to the
  // commit it actually walked, so this URL stays stable forever for "what
  // did this page reflect when it was built?". Readers on a different vllm
  // release can swap the ref segment (e.g. `releases/v0.20.2`).
  if (VLLM_SHA) {
    const shortSha = VLLM_SHA.slice(0, 12);
    const url = `https://github.com/vllm-project/vllm/blob/${VLLM_SHA}/vllm/envs.py`;
    out.push('');
    out.push('---');
    out.push('');
    out.push(
      `**Source.** This table reflects [\`vllm/envs.py\` @ \`${shortSha}\`](${url}). ` +
        `For a different vLLM release, swap the ref in the URL — e.g. ` +
        `[\`releases/v0.20.2\`](https://github.com/vllm-project/vllm/blob/releases/v0.20.2/vllm/envs.py).`
    );
    out.push('');
  }

  out.push('</div>');
  return out.join('\n');
}

function resolveSnippets(src: string, repoRoot: string, depth = 0): string {
  if (depth > 5) return src; // recursion safety
  return src.replace(SNIPPET_LINE_RE, (_match, indent: string, ref: string) => {
    const [filePath, sectionId] = ref.split(':') as [string, string | undefined];
    const abs = path.resolve(repoRoot, filePath);
    if (!existsSync(abs)) {
      // Source-file include we didn't sparse-checkout (e.g. some `vllm/...py`
      // subtree we chose not to vendor). Render a GitHub link instead of
      // inlining the source — keeps the page useful without paying the
      // subtree's checkout cost. `docs/generated/...` paths still render the
      // "auto-generated reference not available" note because those are
      // Python-extractor outputs, not browsable source.
      const isSource = /^(vllm|examples|tests|benchmarks|csrc)\//.test(filePath);
      if (isSource) {
        const url = `https://github.com/vllm-project/vllm/blob/${VLLM_REF || 'main'}/${filePath}`;
        const label = sectionId ? `${filePath}:${sectionId}` : filePath;
        return `${indent}[\`${label}\`](${url})`;
      }
      const desc = sectionId ? `${filePath}:${sectionId}` : filePath;
      return [
        `${indent}> [!NOTE]`,
        `${indent}> Auto-generated reference \`${desc}\` is not available in this build.`,
        `${indent}> Run the Python extractor to populate it.`
      ].join('\n');
    }
    let raw: string;
    try {
      raw = readFileSync(abs, 'utf-8');
    } catch {
      return `${indent}<!-- snippet read failed: ${ref} -->`;
    }
    let body = raw;
    if (sectionId) {
      const slice = extractSnippetSection(raw, sectionId);
      if (slice === null) {
        return `${indent}<!-- snippet section "${ref}" not found -->`;
      }
      body = slice;
    }
    // Strip leftover `[start:X]` / `[end:X]` markers from the included body.
    body = body.replace(SNIPPET_MARKER_RE, '');
    // Trim trailing blank lines but keep internal structure.
    body = body.replace(/\n+$/, '');
    // Apply the directive's indent to every non-blank line, so includes
    // sitting inside admonitions / list items keep that nesting.
    const indented = indent
      ? body
          .split('\n')
          .map((l) => (l.length ? indent + l : l))
          .join('\n')
      : body;
    return resolveSnippets(indented, repoRoot, depth + 1);
  });
}

// docs/README.md is the upstream "Welcome to vLLM" landing — we surface it as
// the Introduction page (slug rewritten below). Directory README.md files
// (e.g. docs/usage/README.md) are real content pages that upstream links to,
// so we keep them in the bundle.
const ROOT_README = 'README.md';

async function walk(dir: string, base: string = dir): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...(await walk(full, base)));
    } else if (e.isFile()) {
      if (!e.name.endsWith('.md')) continue;
      // Skip include/template fragments that the original mkdocs config excluded.
      if (e.name.endsWith('.inc.md') || e.name.endsWith('.template.md')) continue;
      out.push(rel);
    }
  }
  return out;
}

// File extensions that count as "examples" — each generates its own page.
// Mirrors what upstream's generate_examples.py treats as runnable content,
// plus `.jinja` chat templates which the tool-calling / structured-outputs
// guides link at heavily.
const EXAMPLE_EXTS = new Set(['.py', '.sh', '.md', '.ipynb', '.yaml', '.yml', '.jinja']);
const EXAMPLE_LANG: Record<string, string> = {
  '.py': 'python',
  '.sh': 'bash',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.ipynb': 'json',
  '.jinja': 'jinja'
};

async function walkExamples(dir: string, base: string = dir): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      out.push(...(await walkExamples(full, base)));
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (EXAMPLE_EXTS.has(ext)) out.push(rel);
    }
  }
  return out;
}

// Acronym + brand fixups so "openai_chat_completion" reads as
// "OpenAI Chat Completion" rather than "Openai Chat Completion".
// Mirrors the substitution table in vllm/docs/mkdocs/hooks/generate_examples.py.
const TITLE_SUBS: Array<[RegExp, string]> = [
  [/\bopenai\b/gi, 'OpenAI'],
  [/\bvllm\b/gi, 'vLLM'],
  [/\bllm\b/gi, 'LLM'],
  [/\bcli\b/gi, 'CLI'],
  [/\bapi(s?)\b/gi, 'API$1'],
  [/\bcpu\b/gi, 'CPU'],
  [/\btpu\b/gi, 'TPU'],
  [/\bipc\b/gi, 'IPC'],
  [/\bio\b/gi, 'IO'],
  [/\brl\b/gi, 'RL'],
  [/\brlhf\b/gi, 'RLHF'],
  [/\blora\b/gi, 'LoRA'],
  [/\bnccl\b/gi, 'NCCL'],
  [/\bgguf\b/gi, 'GGUF'],
  [/\blmcache\b/gi, 'LMCache'],
  [/\bmultilora\b/gi, 'MultiLoRA'],
  [/\bmlpspeculator\b/gi, 'MLPSpeculator'],
  [/\bner\b/gi, 'NER'],
  [/\bmae\b/gi, 'MAE'],
  [/\bfp(\d+)\b/gi, (_m: string, d: string) => `FP${d}`] as unknown as [RegExp, string],
  [/\bint(\d+)\b/gi, (_m: string, d: string) => `INT${d}`] as unknown as [RegExp, string]
];

function exampleTitle(stem: string): string {
  let t = stem.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  for (const [re, repl] of TITLE_SUBS) {
    t = t.replace(re, repl as never);
  }
  return t;
}

// Page-path slug only (e.g. .nav.yml entries). Heading slugs go through
// github-slugger directly — see parseMarkdown — so they match the ids
// rehype-slug stamps onto the rendered HTML.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

interface ParsedMarkdown {
  title: string;
  headings: Heading[];
  readMinutes: number;
}

const WPM = 200;

function countWords(rawBody: string): number {
  // Strip fenced code blocks, inline code, html tags, and links' URL parts;
  // remaining is the prose. Cheap and good-enough for a reading estimate.
  const stripped = rawBody
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]+\]/g, '$1');
  return stripped.split(/\s+/).filter(Boolean).length;
}

function parseMarkdown(rawBody: string, fallbackTitle: string): ParsedMarkdown {
  const tree = unified().use(remarkParse).parse(rawBody);
  const headings: Heading[] = [];
  let title: string | null = null;
  // One slugger per page mirrors rehype-slug's behavior on the rendered HTML
  // — same per-page state for the `-1`, `-2` suffix dedupe.
  const slugger = new GithubSlugger();

  // Recursively flatten heading text — `### 1. **Bold:**` puts the
  // "Bold:" inside a `strong` node, which we'd otherwise miss.
  const collectText = (n: any): string => {
    if (!n) return '';
    if (n.type === 'text' || n.type === 'inlineCode') return (n.value as string) ?? '';
    if (Array.isArray(n.children)) return n.children.map(collectText).join('');
    return '';
  };

  visit(tree, 'heading', (node: any) => {
    const text = collectText(node).trim();
    if (!text) return;
    const slug = slugger.slug(text);
    headings.push({ depth: node.depth, text, slug });
    if (!title && node.depth === 1) title = text;
  });

  const readMinutes = Math.max(1, Math.ceil(countWords(rawBody) / WPM));

  return { title: title ?? fallbackTitle, headings, readMinutes };
}

function pathToSlug(relPath: string): string {
  // "getting_started/quickstart.md" -> "getting_started/quickstart"
  // "getting_started/index.md" -> "getting_started"
  // "features/speculative_decoding/README.md" -> "features/speculative_decoding"
  // (root "README.md" is special-cased to "getting_started/introduction" by
  //  the caller; this rule handles every other directory-index README.)
  const noExt = relPath.replace(/\.md$/, '');
  return noExt
    .replace(/\/index$/, '')
    .replace(/^index$/, '')
    .replace(/\/README$/, '');
}

function editUrlFor(relPath: string): string {
  return `https://github.com/vllm-project/vllm/edit/${VLLM_REF}/docs/${relPath}`;
}

/**
 * Parse the awesome-nav .nav.yml at docs/.nav.yml into a NavNode tree.
 *
 * Supported forms:
 *   - "path/to.md"
 *   - "path/dir"               (becomes a section showing dir's index)
 *   - { Title: "path/to.md" }
 *   - { Title: { children... } }
 *   - { glob: "...", flatten_single_child_sections: true }
 *   - "path/*"                 (relative glob → matched against page paths)
 *   - "https://..."            (external link)
 *
 * Pages not referenced by .nav.yml fall through unchanged; the consumer can
 * also synthesize a tree via lib/content/sections.buildNav() when nav is empty.
 */
function parseNavYaml(rawYaml: string, allPaths: Set<string>): NavNode[] {
  const doc = YAML.parse(rawYaml) as { nav?: unknown };
  if (!doc?.nav || !Array.isArray(doc.nav)) return [];

  const matchGlob = (pattern: string): string[] => {
    const m: string[] = [];
    for (const p of allPaths) {
      if (minimatch(p, pattern.endsWith('/*') ? `${pattern}*` : pattern)) m.push(p);
    }
    m.sort();
    return m;
  };

  const slugify = (relPath: string): string =>
    relPath.replace(/\.md$/, '').replace(/\/index$/, '').replace(/^index$/, '');

  const titleFromPath = (relPath: string): string =>
    path
      .basename(relPath, '.md')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const visitItem = (item: unknown): NavNode | NavNode[] | null => {
    if (typeof item === 'string') {
      // External URL.
      if (/^https?:\/\//.test(item)) {
        return { title: item, slug: item };
      }
      // Glob.
      if (item.includes('*')) {
        return matchGlob(item).map((p) => ({ title: titleFromPath(p), slug: slugify(p) }));
      }
      // .md file.
      if (item.endsWith('.md')) {
        if (allPaths.has(item)) {
          return { title: titleFromPath(item), slug: slugify(item) };
        }
        return null;
      }
      // Bare directory: include all .md beneath it.
      const matches = matchGlob(`${item}/**/*.md`);
      return {
        title: titleFromPath(item),
        children: matches.map((p) => ({ title: titleFromPath(p), slug: slugify(p) }))
      };
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      // { glob: "..." } form.
      if (typeof obj.glob === 'string') {
        return matchGlob(obj.glob).map((p) => ({ title: titleFromPath(p), slug: slugify(p) }));
      }
      // { Title: ... } form.
      const entries = Object.entries(obj);
      if (entries.length === 1) {
        const [title, value] = entries[0]!;
        if (typeof value === 'string') {
          const child = visitItem(value);
          if (!child) return null;
          if (Array.isArray(child)) return { title, children: child };
          if (child.children) return { title, children: child.children };
          return { title, slug: child.slug };
        }
        if (Array.isArray(value)) {
          const children = value
            .map(visitItem)
            .flat()
            .filter((n): n is NavNode => n !== null);
          return { title, children };
        }
      }
    }
    return null;
  };

  const out: NavNode[] = [];
  for (const item of doc.nav) {
    const v = visitItem(item);
    if (!v) continue;
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const files = await walk(VLLM_DOCS_DIR);
  files.sort();
  console.log(`  Found ${files.length} markdown files`);

  // For resolving `--8<-- "docs/…"` snippet includes: paths are relative
  // to the vllm repo root (docs/ is one level under it).
  const VLLM_REPO_ROOT = path.resolve(VLLM_DOCS_DIR, '..');

  const pages: Record<string, Page> = {};
  let snippetCount = 0;
  for (const rel of files) {
    const abs = path.join(VLLM_DOCS_DIR, rel);
    const raw = await fs.readFile(abs, 'utf-8');
    const { content: bodyRaw, data } = matter(raw);
    const beforeLen = bodyRaw.length;
    // Pre-pass: turn the env-vars page's `\`\`\`python --8<-- "vllm/envs.py:env-vars-definition" \`\`\``
    // block into a structured per-section table (much nicer than a 1300-line code dump).
    let preprocessed = bodyRaw;
    if (ENV_VARS_BLOCK_RE.test(preprocessed)) {
      ENV_VARS_BLOCK_RE.lastIndex = 0;
      const table = parseEnvVarsTable(VLLM_REPO_ROOT);
      if (table) {
        preprocessed = preprocessed.replace(ENV_VARS_BLOCK_RE, table);
      }
    }
    // Resolve `--8<-- "path"` includes, then strip leftover
    // `--8<-- [start:X]` / `[end:X]` section markers from the page body
    // (these define sections for OTHER pages to include — they have no
    // meaning to a reader of this page itself).
    const content = resolveSnippets(preprocessed, VLLM_REPO_ROOT).replace(
      SNIPPET_MARKER_RE,
      ''
    );
    if (content.length !== beforeLen) snippetCount++;

    const fallbackTitle = path
      .basename(rel, '.md')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const { title, headings, readMinutes } = parseMarkdown(content, fallbackTitle);
    let slug = pathToSlug(rel);
    let pageTitle: string = (data.title as string | undefined) ?? title;

    // The upstream docs/README.md is the project introduction. Slot it under
    // getting_started/ so it shares the URL hierarchy with the Quickstart, and
    // give it the sidebar label users expect.
    if (rel === ROOT_README) {
      slug = 'getting_started/introduction';
      pageTitle = 'Introduction';
    }

    pages[rel] = {
      path: rel,
      slug,
      title: pageTitle,
      rawMarkdown: content,
      headings,
      frontmatter: data,
      editUrl: editUrlFor(rel),
      readMinutes
    };
  }
  if (snippetCount > 0) {
    console.log(`  Resolved --8<-- snippets in ${snippetCount} pages`);
  }

  // Walk vllm/examples and synthesize one page per example file. Mirrors
  // upstream's generate_examples.py: each .py / .sh / etc. becomes a doc
  // page whose body is a header + GitHub source link + a fenced code
  // block of the file contents. Markdown examples render their own
  // content directly. Lets the renderer surface examples without having
  // the upstream Python hooks installed.
  const VLLM_REPO = path.resolve(VLLM_DOCS_DIR, '..');
  const EXAMPLES_ROOT = path.join(VLLM_REPO, 'examples');
  const exampleFiles = await walkExamples(EXAMPLES_ROOT);
  const seenExamplePaths = new Set<string>();
  for (const rel of exampleFiles.sort()) {
    const ext = path.extname(rel).toLowerCase();
    const stem = path.basename(rel, ext);
    const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
    // synthetic page path under examples/<dir>/<stem>.md so the renderer's
    // pages map can address it. If two source files share a stem in the
    // same dir (e.g. foo.py + foo.sh), keep the .md form for the first
    // and append the original ext for later collisions.
    let pagePath = path.posix.join('examples', dir, `${stem}.md`);
    if (seenExamplePaths.has(pagePath)) {
      pagePath = path.posix.join('examples', dir, `${stem}-${ext.slice(1)}.md`);
    }
    seenExamplePaths.add(pagePath);

    const sourceRel = path.posix.join('examples', dir, path.basename(rel));
    const ghUrl = `https://github.com/vllm-project/vllm/blob/${VLLM_REF || 'main'}/${sourceRel}`;
    const title = exampleTitle(stem);

    let body: string;
    if (ext === '.md') {
      // Render the markdown directly. Strip the file's leading H1 if
      // present — pipeline's strip-h1 already handles that for the
      // page-level title we set below.
      const raw = await fs.readFile(path.join(EXAMPLES_ROOT, rel), 'utf-8');
      body = `${raw.trim()}\n\n---\n\n[View source on GitHub](${ghUrl})\n`;
    } else {
      const raw = await fs.readFile(path.join(EXAMPLES_ROOT, rel), 'utf-8');
      const lang = EXAMPLE_LANG[ext] ?? '';
      body =
        `# ${title}\n\n` +
        `[View source on GitHub](${ghUrl})\n\n` +
        '```' + lang + '\n' + raw.replace(/\n+$/, '') + '\n```\n';
    }
    const { content, data } = matter(body);
    const { title: parsedTitle, headings, readMinutes } = parseMarkdown(content, title);

    pages[pagePath] = {
      path: pagePath,
      slug: pagePath.replace(/\.md$/, ''),
      title: (data.title as string | undefined) ?? parsedTitle,
      rawMarkdown: content,
      headings,
      frontmatter: data,
      editUrl: ghUrl.replace('/blob/', '/edit/'),
      readMinutes
    };
  }
  console.log(`  Synthesized ${exampleFiles.length} example pages`);

  const meta: BundleMeta = {
    version: VERSION,
    vllmRef: VLLM_REF,
    vllmSha: VLLM_SHA,
    builtAt: new Date().toISOString(),
    schemaVersion: 1
  };

  // Parse .nav.yml if present.
  let nav: NavNode[] = [];
  const navPath = path.join(VLLM_DOCS_DIR, '.nav.yml');
  try {
    const navRaw = await fs.readFile(navPath, 'utf-8');
    nav = parseNavYaml(navRaw, new Set(Object.keys(pages)));
    console.log(`  Parsed .nav.yml: ${nav.length} top-level entries`);
  } catch {
    console.log('  No .nav.yml found (using derived nav)');
  }

  // Build cross-page heading refs: page-path#slug -> /<version>/<slug>#anchor.
  // Symbol refs are filled in by Phase 2 Python extractors.
  const refs: RefsTable = { headings: {}, symbols: {} };
  for (const page of Object.values(pages)) {
    for (const h of page.headings) {
      // Two key forms so authors can write either:
      //   [text][quickstart#install]
      //   [text][getting_started/quickstart#install]
      const short = `${path.basename(page.path, '.md')}#${h.slug}`;
      const full = `${page.slug}#${h.slug}`;
      const url = `/${VERSION}/${page.slug}#${h.slug}`;
      refs.headings[short] = url;
      refs.headings[full] = url;
    }
  }

  const bundle: Bundle = {
    meta,
    pages,
    nav,
    refs
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(bundle, null, 2));

  const ms = Date.now() - t0;
  const sizeMb = ((await fs.stat(OUT_FILE)).size / 1024 / 1024).toFixed(2);
  console.log(`  Wrote ${OUT_FILE}  (${Object.keys(pages).length} pages, ${sizeMb} MB, ${ms} ms)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

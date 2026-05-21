# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The independent rendering layer for **docs.vllm.ai**. It does **not** own
markdown content — `vllm-project/vllm` does. We vendor that repo as a git
submodule at `external/vllm` and treat its `docs/` and `examples/` as the
source-of-truth.

**Constitutional commitment: do not modify markdown source.** All site-side
behavior (template choice, IA, per-page overlay) lives in
`content/content-map.yaml` and the renderer. If you find yourself wanting to
add frontmatter to a `vllm/docs/*.md` file, the answer is content-map instead.

## Commands

```bash
pnpm install                                  # workspace install
git submodule update --init --recursive       # pull external/vllm
                                              # (or set VLLM_REPO_PATH for offline dev)

pnpm bundle:latest                            # build bundle/latest/bundle.json
pnpm bundle:stable                            # VLLM_REF=v0.x.y pnpm bundle:stable
pnpm bundle:nightly

pnpm dev                                      # next dev on :3030
pnpm build                                    # bundle:latest + next build
pnpm build:multi                              # all three versions + next build
pnpm typecheck                                # tsc --noEmit
pnpm lint                                     # next lint
```

`scripts/build-bundle.sh` is the entry-point for a single-version bundle.
It walks `external/vllm/docs/`, runs the optional Python extractor pass
(skipped silently if not installed), mirrors the upstream `docs/assets/`
into `apps/docs/public/_vllm-assets/` (preserving the `_site/` subtree —
see below), then emits the search index. On first run it also configures
`git sparse-checkout` on `external/vllm` to keep only the paths we
actually read:

- `docs/`, `examples/` — markdown + runnable scripts
- `vllm/config/`, `vllm/engine/` — read by the AST extractor for
  EngineArgs / config-class field docs
- `vllm/entrypoints/`, `vllm/envs.py`, `vllm/pooling_params.py` —
  read by the `--8<--` snippet resolver for source-file section
  includes (`--8<-- "vllm/.../foo.py:section"`)

`vllm/model_executor/` is deliberately omitted (~14M for one
Internals page). When the resolver can't find a `vllm/...py` source
file locally, it falls back to a markdown link to the file on GitHub
— good enough UX for "look at the canonical PyTorch reference impl"
without paying the subtree's checkout cost. If a future page needs
that subtree inlined verbatim, add `/vllm/model_executor/*` to
`SPARSE_PATHS` in `scripts/build-bundle.sh`.

**Don't run `pnpm build` for every change.** Use `pnpm bundle:latest` after a
content change and rely on Next.js HMR for `apps/docs/` edits.

## Architecture

**Stack**: Next.js 15 (App Router), React 19, Tailwind v4, shadcn/ui (new-york,
slate, RSC, tsx). pnpm workspace. Path alias `@/` -> `apps/docs/`.

### Three layers

```
Source layer        external/vllm        — submodule, never modified
Bundle layer        bundle/<v>/...       — build-time JSON artifact, gitignored
Render layer        apps/docs/           — Next.js app, single shell + 6 templates
```

The bundle is the only contract between source and renderer. Schema lives in
`packages/content-bundle/src/index.ts`.

### Pipeline

```
external/vllm/docs/.nav.yml  ─┐
external/vllm/docs/**/*.md   ─┼─► extract-pages.ts ─► bundle.json
                              │       (pages, nav, refs.headings)
external/vllm/vllm/**/*.py    ─► extractor.cli ───► bundle.json (api, cli,
external/vllm/examples/**     ─┘                    metrics, examples,
                                                    refs.symbols)
                                                              │
                                                              ▼
                                                  build-search-index.ts
                                                              │
                                                              ▼
                                              public/search-latest.json
                                                              │
                                                              ▼
                                                       next build
```

### App Router

Single-version today (the loader hardcodes `VERSION = 'latest'`). Routes:

- `app/page.tsx` — redirects `/` to `/getting_started/introduction`
- `app/[...slug]/page.tsx` — catch-all that picks a template per page
- `app/features/page.tsx` — hand-crafted Advanced Features landing
- `app/ecosystem/page.tsx` — hand-crafted Ecosystem landing
- `app/serving/integrations/openclaw/page.tsx` — one hand-crafted leaf page

`generateStaticParams` in `[...slug]/page.tsx` enumerates every page in
the bundle. The multi-version bundle pipeline (`bundle:stable`,
`bundle:nightly`) is preserved but only `latest` is loaded; bringing
the other channels back is a loader change, not a routing one.

`next.config.mjs` and `vercel.json` both fold legacy version-prefixed
URLs (`/latest/...`, `/stable/...`, `/en/stable/...`, `/en/latest/...`)
back to root.

### DocsShell + templates

`components/layout/DocsShell.tsx` is the only layout component. It owns:
header, sticky left sidebar, content column, right TOC, and the page
footer (PrevNext + RelatedLinks + NextStep + EditOnGithub).

Each template (`templates/{guide,start,reference,concept,contribute,intro}.tsx`)
is short — typically <20 lines — and the body is a `PageHead` + a
`DocBody`. Don't add per-template chrome; extend `DocsShell`,
`PageHead`, or `DocBody` instead.

- `PageHead` = PageHeader (eyebrow + difficulty pill + title +
  optional description) + Hero (overlay.hero) + TLDRCard (overlay.summary).
- `DocBody` = innerHTML wrapper that, after hydration, wraps wide tables
  in `.table-scroll` (overflow-x: auto) and attaches copy buttons to
  every `<pre>`.

Template choice is decided by `lib/content/template.ts` with this priority:
1. `content-map.yaml` `pages.<path>.template`
2. `rules[].match` (path glob, first hit)
3. `title_hints[].keyword` (substring, case-insensitive)
4. `defaults.template`

### Sections (top tabs) drive the IA

`content-map.yaml` `sections` defines 6 top-level tabs (start, features,
ecosystem, reference, concepts, contribute). Each section has a `paths`
glob list and an optional `landing` / `landing_url`. A page's section
is the first section whose globs match.

`lib/content/sections.ts` exports:
- `findSection(page, map)` — section assignment (first match wins)
- `pagesInSection(bundle, section, contentMap)` — flat list
- `buildNav(bundle, section, contentMap)` — grouped sidebar tree
- `landingPathFor(bundle, section, contentMap)` — slug for the section
   tab href

**Sidebar uses `buildNav` (sections-derived), not `bundle.nav` (raw .nav.yml).**
The `.nav.yml` IA doesn't match our 6-tab model. The parsed `bundle.nav`
is preserved for future use.

**Cross-section pulls.** A `sidebar_group` may pull a page whose home
section is somewhere else (e.g. Start's "Serve a model" pulls from
`serving/`). The pull is suppressed if the page is **explicitly** (literal,
non-glob path) claimed by another section in `sections[].paths` — that
prevents Reference's `configuration/*` glob from re-showing the four
configuration pages Start has already moved into "Serve a model".

### Markdown pipeline

`lib/markdown/pipeline.ts` chains, in order:

```
preprocessMkdocsBlocks (string pre-pass)
  → remarkParse
  → remarkGfm
  → remarkStripFirstH1
  → remarkCallouts
  → remarkAutoref
  → remarkUrlSchemes
  → remarkAssetPaths
  → remarkMdLinks
  → remarkMath
  → remarkRehype (allowDangerousHtml)
  → rehypeKatex
  → rehypeSlug
  → rehypeAutolinkHeadings
  → rehypeShiki
  → rehypeStringify
```

Plugins worth knowing:

- `mkdocs-blocks.ts` (string pre-pass) — translates mkdocs-material
  `!!!` admonitions, `???`/`???+` collapsibles, `===` tabs, and
  `[TOC]`. Also rewrites `Code example: [...](...)` lines (and the
  broader "any standalone line whose link points at an `examples/*.py`
  file") into inline collapsible cards — see "Collapsible code examples"
  below.
- `callouts.ts` — `> [!NOTE/TIP/IMPORTANT/WARNING/CAUTION]` → semantic divs
- `autoref.ts` — resolves `[label][slug#anchor]` and `[label][vllm.foo.Bar]`
   against `bundle.refs.{headings,symbols}`
- `url-schemes.ts` — rewrites `gh-issue:N`, `gh-pr:N`, `gh-file:path`,
   `gh-dir:path`, `gh-code:path#L1-L5` to absolute GitHub URLs (replaces
   upstream `docs/mkdocs/hooks/url_schemes.py`)
- `asset-paths.ts` — rewrites relative `../assets/...` image URLs to the
   `/_vllm-assets/` mount
- `md-links.ts` — rewrites relative `.md` links into routed slugs
- `strip-h1.ts` — drops the leading `# Title` so it doesn't double the
   PageHeader title
- `rehypeShiki` — dual theme (`github-light` / `github-dark-default`) via
   CSS variables `--shiki-light/dark[-bg]`; html.dark swaps them in
   `globals.css`

### Collapsible code examples

Standalone lines whose link points at an `examples/*.{py,sh,ipynb,yaml,yml}`
file become inline `<details>` cards. The summary keeps the card look
(icon + label + path + chevron). The body holds a fenced code block with
the file's source, syntax-highlighted by Shiki, plus a "View source on
GitHub" link.

Source lookup is built in `lib/content/examples-source.ts`: for every
synthesized example page in the bundle, parse the rawMarkdown's
`[View source on GitHub](...)` + first fenced code block, key by the
source-relative path. The map is passed into `renderMarkdown` via
`RenderOptions.examples`.

Heuristic for which lines match (`mkdocs-blocks.ts` `EXAMPLE_LINE_RE`):

- start of line
- optional list marker (`-`/`*`/`+`/`1.`)
- optional `<Label>:` prefix (becomes the card title)
- `[<text>](<url>)`
- optional trailing sentence punctuation (`.`/`,`/`!`/`?`/`;`)
- end of line

`.md` examples and absolute http(s):// URLs are skipped to avoid the
synthesized example pages self-linking.

### Hero infographics

Per-page `overlay.hero` renders an image / SVG / video / YouTube
embed above the body via `components/layout/Hero.tsx`. The resolver
maps doc-relative `../assets/<path>` → `/_vllm-assets/<path>`, and the
build script mirrors `external/vllm/docs/assets/` into
`apps/docs/public/_vllm-assets/`.

Site-authored heroes (e.g. the 33 architecture / flow / state SVGs)
live in a tracked subtree `apps/docs/public/_vllm-assets/_site/`. The
build script's asset-mirror step preserves `_site/` while clearing
everything else in `_vllm-assets/`, and `.gitignore` carves out the
subtree:

```
apps/docs/public/_vllm-assets/*
!apps/docs/public/_vllm-assets/_site/
```

Style convention for site-authored SVGs:
- vLLM yellow `#fdb517` for the per-diagram focal point
- vLLM blue `#30a2ff` for flow / supporting components
- `@media (prefers-color-scheme: dark)` for double-theme support
- viewBox in the 960×{340..440} range; declare it as `aspect: 960/<H>` in
  content-map so the figure reserves space before paint

### Python extractor

`packages/extractor/src/extractor/` replaces 4 mkdocs hooks:

| extractor | strategy | replaces |
|---|---|---|
| `argparse_dump.py` | subprocess upstream `generate_argparse.py`, parse `.inc.md` | `generate_argparse.py` |
| `api_dump.py` | AST walk of `vllm/`, no `import vllm` | `api-autonav` plugin |
| `metrics_dump.py` | AST scan for `Metric()` ctor calls | `generate_metrics.py` |
| `examples_dump.py` | filesystem walk + first-line summary | `generate_examples.py` |

**Three of four are AST-only** (no torch / CUDA needed) so they can run on a
plain CPU runner. Only `argparse_dump` requires a working `import vllm`.

**Submodule sparse-checkout.** The default checkout keeps `docs/`,
`examples/`, and a curated set of `vllm/` subdirs (`config`, `engine`,
`entrypoints`, plus `envs.py` and `pooling_params.py`) — the paths
read by the AST extractor and the `--8<--` snippet resolver. That's
enough for `argparse_dump` (via our AST-based
`scripts/extract-vllm-configs.py` — no `import vllm` needed) and
`examples_dump` to produce output locally. `api_dump` and `metrics_dump`
still require a full `import vllm`, so they only run in the dedicated CI
job that pip-installs vllm; locally they no-op. To run the Python
extractors against a full vllm checkout instead, point `VLLM_REPO_PATH`
at it.

If the extractor is missing or fails, the bundle still builds with markdown
only — the renderer degrades gracefully.

## Conventions

### Don't add frontmatter to source

Source markdown stays untouched. Per-page customization → `content-map.yaml`
`pages.<path>.<field>`. Per-pattern customization → `rules[]`. New IA →
`sections[]`.

### RSC boundary

`Header` is a Server Component; `MobileNav`, `SearchTrigger`, `ThemeToggle`,
`DocBody` are Client Components. **Functions can't cross the
server→client boundary.** Pre-compute hrefs as `Record<sectionId, string>`
and pass plain data. We hit this once with `sectionHref(id)` — see
`DocsShell.tsx` for the pattern.

### Adding a UI component

shadcn/ui new-york, RSC, tsx. `components.json` is configured. Write
components by hand (no network in dev), put under `components/ui/`. Don't
import from `@radix-ui/themes` or `headlessui` — stick to `@radix-ui/react-*`
primitives that shadcn uses.

### Adding a template

1. Add to `templates/<name>.tsx`, register in `templates/index.ts`
2. Add to `TemplateName` union in `packages/content-bundle/src/index.ts`
3. Wire path or title hint in `content-map.yaml`

### Adding a site-authored hero

1. Drop the SVG at `apps/docs/public/_vllm-assets/_site/<area>/<name>.svg`
   (palette + dark-mode rules above)
2. Wire it via `content-map.yaml`:
   ```yaml
   pages:
     "<dir>/<page>.md":
       hero:
         type: svg
         src: ../assets/_site/<area>/<name>.svg
         alt: ...
         caption: ...
         aspect: 960/<H>
   ```
3. For README pages (`<dir>/README.md`), the src needs an extra `../` —
   `../../assets/_site/...` — because the page dir is one level deeper.

### Theme

`next-themes` provides three states: `light`, `dark`, `system`. The
header toggle (`components/ui/theme-toggle.tsx`) cycles
light → dark → system → light so the system option stays reachable
after the user clicks once. Don't reduce it back to a binary flip.

### Versioning

`stable / latest / nightly` channels exist in `package.json` scripts and
in the bundle pipeline. The renderer is single-version today (loader
reads `bundle/latest/`). Bringing the others back is a loader change +
adding a version segment to the routes — the bundle JSON is what differs,
not the renderer.

### Submodule strategy

`external/vllm` is informationally pinned to `main`. Real version selection
happens in CI / build scripts — `VLLM_REF=...` controls which ref ends up
in `bundle/<channel>/bundle.json`. **Do not bump the submodule SHA in
normal commits.**

For local offline dev, set `VLLM_REPO_PATH=/path/to/local/vllm` to bypass
the submodule entirely.

## Files you'll touch most

| Concern | File |
|---|---|
| Add / re-route a page | `content/content-map.yaml` `sections` / `rules` / `pages` |
| Add a hero infographic | `apps/docs/public/_vllm-assets/_site/<area>/<file>.svg` + `pages.<path>.hero` |
| Add sidebar related-links | `pages.<path>.related_{guides,concepts,recipes,benchmarks}` |
| Add a layout chrome element | `components/layout/DocsShell.tsx` |
| Markdown rendering rule | `lib/markdown/pipeline.ts` (+ matching plugin) |
| Cross-page link resolution | `lib/markdown/autoref.ts` + `extract-pages.ts` (refs) |
| Search ranking | `components/layout/SearchModal.tsx` (`MiniSearch` options) |
| Bundle schema change | `packages/content-bundle/src/index.ts` then ripple |

## Files you should rarely touch

| Concern | Why |
|---|---|
| `external/vllm/**` | Source, never modified |
| `templates/*.tsx` | Should stay <20 lines each; chrome lives in shell |
| `app/layout.tsx` | Theme provider, fonts, favicon metadata. One-time setup. |
| `app/globals.css` `@theme` block | Tokens align with vllm_website + recipes |
| `scripts/build-bundle.sh` asset-mirror block | Carefully preserves `_site/` — don't reintroduce a blanket `rm -rf` |

## Deploy

Vercel (single Next.js project). `vercel-install.sh` does a shallow +
filtered clone of `vllm-project/vllm` because Vercel strips the parent
`.git` so `git submodule` won't work. `vercel.json` has redirects mapping
legacy ReadTheDocs URLs back to root. The CI workflow
`build-multi-version.yml` is matrix-driven (stable / latest / nightly),
though only `latest` is wired through the loader today.

## What this repo is not

- **Not** a copy of vllm content. Always read from `external/vllm`.
- **Not** an mkdocs replacement that runs mkdocs. We rebuilt the parts we
  needed (url-schemes, autoref, callouts, admonitions, tabs, collapsibles)
  as remark plugins or string pre-passes; we subprocess the upstream
  argparse hook because re-implementing its mocking is too brittle. We
  never call `mkdocs build`.
- **Not** a Markdown-frontmatter consumer. The site-side overlay is the
  contract.
- **Not** a decision-flow / Choose surface. That layer was attempted
  earlier and removed; the value of an interactive "pick your path"
  wizard didn't pay for its maintenance cost. Static decision cards on
  the Get-started landing are the open replacement.

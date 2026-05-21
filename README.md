# vllm-docs-site

Independent rendering layer for **docs.vllm.ai**. Consumes markdown from
`vllm-project/vllm` (vendored as a git submodule at `external/vllm`) and
renders it through Next.js on Vercel.

> Design principle: source markdown stays in the main repo and is never
> modified. Site-side `content/content-map.yaml` provides the overlay; the
> renderer infers templates from path + title.

## Layout

```
external/vllm/                     # git submodule, vllm-project/vllm
                                   #   docs/ and examples/ via sparse-checkout

apps/docs/                         # Next.js 15 App Router
  app/page.tsx                     #   / → /getting_started/introduction
  app/[...slug]/page.tsx           #   single-version catch-all; picks a template
  app/features/page.tsx            #   hand-crafted feature landing
  app/ecosystem/page.tsx           #   hand-crafted ecosystem landing
  templates/                       #   6 templates: start guide reference concept
                                   #               contribute intro
  components/layout/               #   DocsShell, Header, Sidebar, PageHead,
                                   #   DocBody, Hero, RelatedLinks, …
  lib/markdown/                    #   remark/rehype pipeline + plugins
                                   #   (callouts, autoref, url-schemes,
                                   #    asset-paths, md-links, strip-h1,
                                   #    mkdocs-blocks pre-pass)
  lib/content/                     #   bundle loader, sections, overlay,
                                   #   template inference, examples-source
  public/_vllm-assets/             #   mirrored from external/vllm/docs/assets
                                   #   at build time (gitignored) — EXCEPT:
  public/_vllm-assets/_site/       #   site-authored hero SVGs, tracked in git
  scripts/extract-pages.ts         #   walks external/vllm/docs → bundle.json

packages/content-bundle/           #   TS types shared between extractor and app
packages/extractor/                #   Python tools for argparse / api /
                                   #   metrics / examples dumps

content/
  content-map.yaml                 #   sections + path-rules + title-hints +
                                   #   per-page overlay (hero, related_*, …)

scripts/
  build-bundle.sh                  #   entry: VERSION=latest scripts/build-bundle.sh
  vercel-install.sh                #   shallow + filtered submodule clone for CI

.github/workflows/                 #   build-multi-version.yml (matrix per ref)
vercel.json                        #   redirects + cache headers
```

## Local development

```bash
# 1. Install
pnpm install

# 2. Pull the vllm submodule (or set VLLM_REPO_PATH to a local clone)
git submodule update --init --recursive
# offline alternative:
#   export VLLM_REPO_PATH=/path/to/local/vllm

# 3. Build the content bundle
pnpm bundle:latest

# 4. Dev server
pnpm dev        # http://localhost:3030
```

Iteration loop:

- After a `content/content-map.yaml` edit or a `apps/docs/` edit, Next.js HMR
  picks it up — no rebuild needed.
- After a source-markdown change (i.e. `external/vllm/docs/**`), rerun
  `pnpm bundle:latest`.

```bash
pnpm typecheck   # tsc --noEmit across the workspace
pnpm lint        # next lint
pnpm build       # bundle:latest + next build (production)
```

## Versions

The renderer is single-version today (the loader reads `bundle/latest/`).
The `build-bundle.sh` script and `pnpm bundle:{stable,nightly}` scripts
still exist and accept `VLLM_REF=v0.x.y` overrides — the multi-version
path is preserved for when stable / nightly channels come back.

```bash
VLLM_REF=v0.x.y    pnpm bundle:stable
VLLM_REF=main      pnpm bundle:nightly
```

Legacy ReadTheDocs URLs (`/en/stable/...`, `/latest/...`, etc.) are
redirected back to root by `next.config.mjs` and `vercel.json`.

## What is intentionally NOT here

- **Markdown frontmatter requirements.** Source `.md` files are consumed
  as-is. Per-page customization lives in `content-map.yaml`, not on the
  page.
- **A copy of vllm content.** We always read from the submodule.
- **Bidirectional sync.** The bundle is a build-time artifact only.

## Site-authored heroes

Most architecture / flow / topology pages carry an SVG hero infographic.
The 33 site-authored SVGs live under `apps/docs/public/_vllm-assets/_site/`
and are tracked in git. The build script clears the rest of
`_vllm-assets/` on each run (it's a mirror of upstream
`external/vllm/docs/assets/`) but preserves `_site/`.

To wire a new hero:

1. Drop the SVG at `apps/docs/public/_vllm-assets/_site/<area>/<name>.svg`
2. Reference it from `content-map.yaml` `pages.<path>.hero`:
   ```yaml
   hero:
     type: svg
     src: ../assets/_site/<area>/<name>.svg
     alt: ...
     caption: ...
     aspect: 960/400
   ```
3. For pages inside a sub-directory (`features/speculative_decoding/README.md`),
   the src needs an extra `../` step: `../../assets/_site/...`

The Hero component resolves doc-relative `../assets/` paths to the
`/_vllm-assets/` mount automatically.

## Status

What's wired:

- single-version bundle pipeline (`bundle/latest/bundle.json`)
- 6 templates, 6 sections, content-map overlay
- markdown → HTML pipeline with callouts, math, code-example collapsibles,
  autoref, asset-paths, gh-* url schemes
- Python extractor scaffold (argparse / api / metrics / examples dumps)
- header search, theme toggle (light / dark / system), favicon
- 33 site-authored hero SVGs across high-traffic pages
- Vercel deploy via `scripts/vercel-install.sh` + `pnpm build`

What's deferred:

- Bringing `stable` and `nightly` back as live channels (the bundle
  pipeline already supports `VLLM_REF` and the CI workflow is multi-leg).
- Search ranking tuning beyond the MiniSearch defaults.
- The Choose / decision-flow surface (intentionally absent — see
  `CLAUDE.md`).

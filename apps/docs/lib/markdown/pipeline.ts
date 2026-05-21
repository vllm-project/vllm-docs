/**
 * Markdown -> HTML pipeline.
 *
 * Pipeline order:
 *   mkdocs-blocks (source pre-pass) : translates !!! / ??? / === / [TOC]
 *                                     before remark-parse sees it
 *   parse -> gfm           : tables, task lists, autolinks
 *         -> callouts      : > [!NOTE]/[!TIP]/... → semantic divs
 *         -> url-schemes   : rewrite gh-issue:/gh-pr:/gh-file: BEFORE rehype
 *         -> remark-rehype : md AST -> html AST (allowDangerousHtml passes
 *                            our pre-pass-emitted wrappers through)
 *         -> rehype-slug   : add ids to headings (works on real headings;
 *                            content inside our wrappers is parsed normally)
 *         -> shiki         : syntax-highlight code blocks (light + dark)
 *         -> stringify     : html string
 *
 * autoref is run separately as a pre-pass over `bundle.refs`.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import rehypeShiki from '@shikijs/rehype';
import type { RefsTable } from '@vllm-docs/content-bundle';
import type { ExampleSource } from '@/lib/content/examples-source';
import { remarkUrlSchemes } from './url-schemes';
import { remarkCallouts } from './callouts';
import { remarkAutoref } from './autoref';
import { remarkAssetPaths } from './asset-paths';
import { remarkMdLinks } from './md-links';
import { remarkStripFirstH1 } from './strip-h1';
import { preprocessMkdocsBlocks } from './mkdocs-blocks';

export interface RenderOptions {
  /** Git ref used to build absolute URLs for gh-file/gh-dir/gh-code. */
  ref?: string;
  /** Cross-page reference table from the bundle. */
  refs?: RefsTable;
  /** Doc-relative path of the page being rendered, e.g. "design/arch_overview.md".
   *  Used to resolve relative image URLs against the docs root. */
  pagePath?: string;
  /** Set of doc-relative page paths present in the bundle. Relative
   *  `.md` links that don't resolve into this set are left untouched. */
  validPaths?: Set<string>;
  /** Map of `examples/<dir>/<basename>` -> source code, used to inline
   *  `Code example: [...](...)` references as collapsible blocks instead
   *  of links to a separate page. */
  examples?: Record<string, ExampleSource>;
}

interface CallCtx {
  pageDir: string;
  validPaths: Set<string>;
  examples: Record<string, ExampleSource>;
}

/** Build a fresh processor for one renderMarkdown call. The plugin closures
 *  capture `ctx` by reference, but since `ctx` is local to the invocation
 *  there's no cross-call mutation — important under Next.js dev mode where
 *  concurrent renders (initial SSR + RSC payload) used to race on a shared
 *  module-level ctx and produce non-deterministic HTML, which surfaced as
 *  React hydration mismatches.
 *
 *  Shiki's theme parsing is the only expensive piece here and it's cached
 *  internally by @shikijs/rehype, so re-using the loader between page
 *  renders is fine even though the wrapper processor is rebuilt. */
function buildProcessor(opts: RenderOptions, ctx: CallCtx) {
  const refs = opts.refs ?? { headings: {}, symbols: {} };
  // Cast the chain to `any` at the mdast->hast seam: strict generic inference
  // through 6+ plugins explodes in TS, but the runtime contract is stable.
  const p: any = unified().use(remarkParse).use(remarkGfm);
  p.use(remarkStripFirstH1);
  p.use(remarkCallouts);
  p.use(remarkAutoref, { refs });
  p.use(remarkUrlSchemes, { ref: opts.ref ?? 'main' });
  p.use(remarkAssetPaths(() => ctx.pageDir));
  p.use(
    remarkMdLinks(() => ({
      pageDir: ctx.pageDir,
      validPaths: ctx.validPaths
    }))
  );
  // $...$ inline + $$...$$ display math; rendered to MathML/HTML by KaTeX
  // below. KaTeX CSS is imported from globals.css.
  p.use(remarkMath);
  p.use(remarkRehype, { allowDangerousHtml: true });
  p.use(rehypeKatex, { strict: false, output: 'htmlAndMathml' });
  p.use(rehypeSlug);
  p.use(rehypeAutolinkHeadings, {
    behavior: 'append',
    properties: { className: 'heading-anchor', ariaLabel: 'Link to this section' },
    content: { type: 'text', value: '#' }
  });
  p.use(rehypeShiki, {
    themes: { light: 'github-light', dark: 'github-dark-default' },
    // Emit both palettes as CSS variables only (no inline color/bg). Rules in
    // globals.css consume `--shiki-light/dark[-bg]` and switch on html.dark.
    // Without this, shiki sets `style="color:...;background:..."` inline,
    // which wins over our dark-mode CSS via specificity.
    defaultColor: false,
    defaultLanguage: 'text',
    fallbackLanguage: 'text'
  });
  p.use(rehypeStringify, { allowDangerousHtml: true });
  return p;
}

function dirnameOfPath(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export async function renderMarkdown(md: string, opts: RenderOptions = {}): Promise<string> {
  const ctx: CallCtx = {
    pageDir: opts.pagePath ? dirnameOfPath(opts.pagePath) : '',
    validPaths: opts.validPaths ?? new Set(),
    examples: opts.examples ?? {}
  };
  const processor = buildProcessor(opts, ctx);
  const file = await processor.process(
    preprocessMkdocsBlocks(md, ctx.pageDir, ctx.examples)
  );
  return String(file);
}

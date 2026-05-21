/**
 * Rewrite relative `.md` links to routed paths.
 *
 * Upstream cross-page links look like `[Quickstart](./getting_started/quickstart.md)`
 * or `[Troubleshooting](../usage/troubleshooting.md#anchor)`. The browser
 * can't follow these — `.md` isn't a route. Resolve them against the
 * current page's directory and emit `/{slug}#{anchor}` instead.
 *
 * Mirrors the slug rule in scripts/extract-pages.ts so links match the
 * bundle's page slugs exactly:
 *   "README.md"                 → "getting_started/introduction" (special-cased)
 *   "foo/index.md"              → "foo"
 *   "foo/bar.md"                → "foo/bar"
 *   "foo/README.md"             → "foo/README" (rendered, not redirected)
 *
 * External URLs (http(s):, mailto:, gh-*: schemes), absolute paths, and
 * non-.md links are left alone.
 */
import { visit } from 'unist-util-visit';
import * as path from 'node:path';

function isExternal(url: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

function pathToSlug(relPath: string): string {
  const noExt = relPath.replace(/\.md$/, '');
  return noExt.replace(/\/index$/, '').replace(/^index$/, '');
}

export interface MdLinkContext {
  pageDir: string;
  /** Set of page paths present in the bundle (e.g. "usage/security.md").
   *  Resolved targets not in this set fall through to the original URL
   *  rather than producing a 404. */
  validPaths: Set<string>;
}

/** Exported so callers (e.g. raw HTML rewriters) can reuse the same logic. */
export function rewriteMdLink(ctx: MdLinkContext, url: string): string {
  if (!url || isExternal(url) || url.startsWith('/') || url.startsWith('#')) return url;

  const hashIdx = url.indexOf('#');
  const target = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : url.slice(hashIdx);

  if (!/\.md$/i.test(target)) return url;

  const resolved = path.posix.normalize(path.posix.join(ctx.pageDir || '', target));
  // Walking above the docs root (e.g. "../../foo.md" from a top-level page)
  // produces a path that starts with "..". Don't touch it.
  if (resolved.startsWith('..')) return url;

  // Only rewrite if we actually have this page in the bundle. Avoids
  // generating 404 URLs for files the extractor skipped (e.g. directory
  // README.md indexes).
  if (!ctx.validPaths.has(resolved)) return url;

  let slug = pathToSlug(resolved);
  if (resolved === 'README.md') slug = 'getting_started/introduction';

  return `/${slug}${hash}`;
}

export function remarkMdLinks(getCtx: () => MdLinkContext) {
  return () => (tree: any) => {
    const ctx = getCtx();
    visit(tree, (node: any) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        node.url = rewriteMdLink(ctx, node.url);
      }
    });
  };
}

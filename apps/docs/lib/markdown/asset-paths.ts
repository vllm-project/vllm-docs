/**
 * Rewrite markdown image URLs so upstream assets are servable from Next.js
 * `public/_vllm-assets/`.
 *
 * Upstream `external/vllm/docs/**.md` references images like
 * `../assets/design/foo.png` (relative to the file). The build copies
 * `docs/assets/` to `apps/docs/public/_vllm-assets/`, so any URL whose
 * resolved path lives under `assets/` becomes `/_vllm-assets/<rest>`.
 *
 * Only images are rewritten. Other relative links are left alone (handled
 * separately by url-schemes for `gh-*`, or fall through as-is).
 */
import { visit } from 'unist-util-visit';
import * as path from 'node:path';

const ASSETS_PREFIX = 'assets/';
const PUBLIC_MOUNT = '/_vllm-assets/';

function isExternal(url: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/** Exported so the source-level mkdocs preprocessor can rewrite image URLs
 *  inside raw `<img>` tags (which the AST-based plugin below can't see). */
export function rewriteAssetUrl(pageDir: string, url: string): string {
  if (!url || isExternal(url) || url.startsWith('#') || url.startsWith('data:')) return url;
  if (url.startsWith(PUBLIC_MOUNT)) return url;
  if (url.startsWith('/')) {
    return url.startsWith('/assets/') ? PUBLIC_MOUNT + url.slice('/assets/'.length) : url;
  }
  const resolved = path.posix.normalize(path.posix.join(pageDir, url));
  if (resolved.startsWith(ASSETS_PREFIX)) {
    return PUBLIC_MOUNT + resolved.slice(ASSETS_PREFIX.length);
  }
  return url;
}

/**
 * Plugin reads pageDir lazily so a single processor instance can serve any
 * page — pipeline.ts updates the source via a closure between calls.
 */
export function remarkAssetPaths(getPageDir: () => string) {
  return () => (tree: any) => {
    const pageDir = getPageDir();
    visit(tree, (node: any) => {
      if (node.type === 'image' && typeof node.url === 'string') {
        node.url = rewriteAssetUrl(pageDir, node.url);
      }
    });
  };
}

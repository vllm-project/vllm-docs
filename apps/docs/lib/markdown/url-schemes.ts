/**
 * Replicates docs/mkdocs/hooks/url_schemes.py: rewrite custom link schemes to
 * absolute GitHub URLs. Runs before remark-rehype.
 *
 *   gh-issue:1234         -> https://github.com/vllm-project/vllm/issues/1234
 *   gh-pr:1234            -> https://github.com/vllm-project/vllm/pull/1234
 *   gh-file:path/to/x.py  -> https://github.com/vllm-project/vllm/blob/<ref>/path/to/x.py
 *   gh-dir:path/to/x      -> https://github.com/vllm-project/vllm/tree/<ref>/path/to/x
 *   gh-code:path#L1-L5    -> permalink with line range
 */
import { visit } from 'unist-util-visit';

const REPO = 'https://github.com/vllm-project/vllm';

export interface UrlSchemesOptions {
  /** Git ref used for blob/tree URLs. Default 'main'. */
  ref?: string;
}

interface MdastLikeLink {
  type: 'link';
  url: string;
}
const isLink = (n: any): n is MdastLikeLink => n && n.type === 'link' && typeof n.url === 'string';

// Plain function (not typed Plugin<...>) keeps the unified() chain inference
// from blowing up when remarkRehype follows. unified accepts plain attacher fns.
export function remarkUrlSchemes(opts: UrlSchemesOptions = {}) {
  const ref = opts.ref ?? 'main';

  const rewrite = (url: string): string => {
    if (url.startsWith('gh-issue:')) {
      return `${REPO}/issues/${url.slice('gh-issue:'.length)}`;
    }
    if (url.startsWith('gh-pr:')) {
      return `${REPO}/pull/${url.slice('gh-pr:'.length)}`;
    }
    if (url.startsWith('gh-file:')) {
      return `${REPO}/blob/${ref}/${url.slice('gh-file:'.length)}`;
    }
    if (url.startsWith('gh-dir:')) {
      return `${REPO}/tree/${ref}/${url.slice('gh-dir:'.length)}`;
    }
    if (url.startsWith('gh-code:')) {
      // gh-code:path#L1-L5  ->  blob/ref/path#L1-L5
      const rest = url.slice('gh-code:'.length);
      return `${REPO}/blob/${ref}/${rest}`;
    }
    return url;
  };

  return (tree: any) => {
    visit(tree, (node: any) => {
      if (isLink(node)) {
        node.url = rewrite(node.url);
      }
    });
  };
}

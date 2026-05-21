/**
 * Replicates docs/mkdocs/hooks/autoref_code.py: cross-page reference links.
 *
 * Supports two reference forms inside markdown link references:
 *   [label][quickstart#install]              -> page-relative anchor
 *   [label][getting_started/quickstart#x]    -> absolute slug + anchor
 *   [label][vllm.foo.Bar]                    -> Python symbol → API route
 *
 * Resolution table is built once by extract-pages.ts and Phase-2 api_dump,
 * stored in `bundle.refs`.
 *
 * Pure remark plugin: walks linkReference nodes, resolves the identifier
 * against `refs.headings` then `refs.symbols`, replacing the node with a
 * concrete link. Unresolved references are left intact (mdast emits the
 * literal `[label][id]` text).
 */
import { visit } from 'unist-util-visit';
import type { RefsTable } from '@vllm-docs/content-bundle';

export interface AutorefOptions {
  refs: RefsTable;
}

interface MdastLinkReference {
  type: 'linkReference';
  identifier: string;
  label?: string;
  referenceType: 'shortcut' | 'collapsed' | 'full';
  children: any[];
}

const isLinkRef = (n: any): n is MdastLinkReference =>
  n && n.type === 'linkReference' && typeof n.identifier === 'string';

export function remarkAutoref(opts: AutorefOptions) {
  const { refs } = opts;

  const resolve = (rawId: string): string | undefined => {
    const id = rawId.trim();
    if (refs.headings[id]) return refs.headings[id];
    // Heading id might have been mdast-normalized to lowercase.
    const lower = id.toLowerCase();
    if (refs.headings[lower]) return refs.headings[lower];
    if (refs.symbols[id]) return refs.symbols[id];
    if (refs.symbols[lower]) return refs.symbols[lower];
    return undefined;
  };

  return (tree: any) => {
    visit(tree, (node: any, index: any, parent: any) => {
      if (!isLinkRef(node) || index == null || !parent) return;
      const url = resolve(node.identifier);
      if (!url) return;
      const replacement = {
        type: 'link',
        url,
        title: null,
        children: node.children?.length
          ? node.children
          : [{ type: 'text', value: node.label ?? node.identifier }]
      };
      (parent.children as any[]).splice(index, 1, replacement);
    });
  };
}

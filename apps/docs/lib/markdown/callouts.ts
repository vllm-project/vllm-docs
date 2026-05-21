/**
 * Lift GitHub-flavored callouts from blockquote syntax into semantic divs:
 *
 *   > [!NOTE]
 *   > A note.
 *
 * becomes
 *
 *   <div class="callout callout-note">
 *     <div class="callout-title">Note</div>
 *     <div class="callout-body">A note.</div>
 *   </div>
 *
 * Supported kinds: NOTE, TIP, IMPORTANT, WARNING, CAUTION.
 * Unrecognized prefixes pass through as a regular blockquote.
 */
import { visit } from 'unist-util-visit';

const KINDS: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution'
};

const PATTERN = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

export function remarkCallouts() {
  return (tree: any) => {
    visit(tree, 'blockquote', (node: any) => {
      const first = node.children?.[0];
      if (!first || first.type !== 'paragraph') return;
      const firstText = first.children?.[0];
      if (!firstText || firstText.type !== 'text') return;

      const lines = String(firstText.value).split('\n');
      const head = lines[0];
      const m = head?.match(PATTERN);
      if (!m) return;
      const kind = m[1]!;
      const label = KINDS[kind] ?? kind;

      // Drop the `[!KIND]` line; keep the rest of the first paragraph (if any).
      const rest = lines.slice(1).join('\n');
      if (rest) {
        firstText.value = rest;
      } else {
        first.children!.shift();
        if (first.children!.length === 0) {
          node.children!.shift();
        }
      }

      const titleNode = {
        type: 'paragraph',
        data: {
          hName: 'div',
          hProperties: { className: ['callout-title'] }
        },
        children: [{ type: 'text', value: label }]
      };

      const bodyChildren = node.children;
      const bodyNode = {
        type: 'div',
        data: {
          hName: 'div',
          hProperties: { className: ['callout-body'] }
        },
        children: bodyChildren
      };

      // Mutate blockquote into our wrapper div.
      node.type = 'div';
      node.data = {
        hName: 'div',
        hProperties: {
          className: ['callout', `callout-${kind.toLowerCase()}`],
          'data-kind': kind.toLowerCase()
        }
      };
      node.children = [titleNode, bodyNode];
    });
  };
}

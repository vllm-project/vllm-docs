'use client';

import * as React from 'react';

interface DocBodyProps {
  html: string;
}

const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

export function DocBody({ html }: DocBodyProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanup: Array<() => void> = [];

    // Wrap any table that doesn't fit the prose column in a horizontally-
    // scrollable container so users can pan instead of seeing the table
    // bleed across the layout.
    const tables = root.querySelectorAll<HTMLTableElement>('table');
    for (const table of Array.from(tables)) {
      const parent = table.parentElement;
      if (!parent || parent.classList.contains('table-scroll')) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll';
      parent.insertBefore(wrapper, table);
      wrapper.appendChild(table);
      cleanup.push(() => {
        if (wrapper.parentElement) {
          wrapper.parentElement.insertBefore(table, wrapper);
          wrapper.remove();
        }
      });
    }

    const pres = root.querySelectorAll<HTMLPreElement>('pre');
    for (const pre of Array.from(pres)) {
      // Skip if already wired (e.g. HMR re-run).
      if (pre.querySelector(':scope > .copy-btn')) continue;
      pre.classList.add('group/code');
      pre.style.position = pre.style.position || 'relative';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.setAttribute('aria-label', 'Copy code');
      btn.innerHTML = ICON_COPY;

      const onClick = async (e: Event) => {
        e.stopPropagation();
        const code = pre.querySelector('code');
        const text = code ? code.textContent ?? '' : pre.textContent ?? '';
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Fallback for older browsers / insecure context.
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
          } catch {
            /* swallow */
          }
          document.body.removeChild(ta);
        }
        btn.classList.add('copy-btn-success');
        btn.innerHTML = ICON_CHECK;
        window.setTimeout(() => {
          btn.classList.remove('copy-btn-success');
          btn.innerHTML = ICON_COPY;
        }, 1400);
      };
      btn.addEventListener('click', onClick);
      pre.appendChild(btn);
      cleanup.push(() => {
        btn.removeEventListener('click', onClick);
        btn.remove();
      });
    }
    return () => {
      for (const fn of cleanup) fn();
    };
  }, [html]);

  return <div ref={ref} className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

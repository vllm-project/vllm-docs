'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Heading } from '@vllm-docs/content-bundle';

interface TableOfContentsProps {
  headings: Heading[];
  /** Show TOC if at least this many headings exist. */
  minHeadings?: number;
}

export function TableOfContents({ headings, minHeadings = 2 }: TableOfContentsProps) {
  const items = React.useMemo(
    () => headings.filter((h) => h.depth >= 2 && h.depth <= 3),
    [headings]
  );
  const [activeSlug, setActiveSlug] = React.useState<string | null>(items[0]?.slug ?? null);

  React.useEffect(() => {
    if (items.length === 0) return;
    const elements = items
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // Track the topmost heading whose top has crossed the activation line.
    const activationLine = 96; // matches scroll-mt set on doc-body headings
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // Pick the visible item with the smallest top offset; if none visible,
        // fall back to the last element above the activation line.
        let chosen: string | null = null;
        let smallestTop = Number.POSITIVE_INFINITY;
        for (const el of elements) {
          if (!visible.has(el.id)) continue;
          const top = el.getBoundingClientRect().top;
          if (top < smallestTop) {
            smallestTop = top;
            chosen = el.id;
          }
        }
        if (!chosen) {
          // Find the closest above the line.
          let best: HTMLElement | null = null;
          for (const el of elements) {
            const top = el.getBoundingClientRect().top;
            if (top <= activationLine) best = el;
          }
          if (best) chosen = best.id;
        }
        if (chosen) setActiveSlug(chosen);
      },
      { rootMargin: `-${activationLine}px 0px -55% 0px`, threshold: 0 }
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  if (items.length < minHeadings) {
    return <div className="hidden xl:block w-[220px] shrink-0" aria-hidden />;
  }

  return (
    <aside className="hidden xl:block w-[220px] shrink-0">
      <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin pl-4 border-l">
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          On this page
        </h4>
        <ul className="space-y-1.5 text-[13px]">
          {items.map((h) => {
            const active = h.slug === activeSlug;
            return (
              <li key={h.slug}>
                <a
                  href={`#${h.slug}`}
                  className={cn(
                    'group/toc relative block transition-colors',
                    active ? 'text-vllm-blue font-medium' : 'text-muted-foreground hover:text-foreground',
                    h.depth === 3 && 'pl-3'
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -left-[17px] top-1/2 -translate-y-1/2 size-1.5 rounded-full transition-all',
                      active ? 'bg-vllm-blue scale-100 opacity-100' : 'bg-transparent scale-0 opacity-0'
                    )}
                  />
                  {h.text}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

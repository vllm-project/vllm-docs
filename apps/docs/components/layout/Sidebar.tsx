'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavGroup } from '@/lib/content/sections';

interface SidebarProps {
  groups: NavGroup[];
  activePath: string;
}

export function Sidebar({ groups, activePath }: SidebarProps) {
  const pathname = usePathname();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Center the active link on mount and on navigation. Only scrolls when the
  // active row falls outside the visible scroll viewport — avoids jumping
  // when the rail is already at the right place.
  React.useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-sidebar-active="true"]');
    if (!active) return;
    const cRect = container.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    const above = aRect.top < cRect.top;
    const below = aRect.bottom > cRect.bottom;
    if (!above && !below) return;
    const target =
      active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
  }, [activePath]);

  return (
    <aside className="hidden lg:block w-[280px] shrink-0 border-r bg-background">
      <div
        ref={scrollRef}
        className="sticky top-[76px] h-[calc(100vh-76px)] overflow-y-auto scrollbar-thin px-4 py-7"
      >
        <nav className="space-y-7">
          {groups.map((group) => (
            <div key={group.label}>
              <h4 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">
                {group.label}
              </h4>
              <ul className="space-y-px">
                {group.pages.map((p) => {
                  const active = p.path === activePath;
                  return (
                    <li key={p.path}>
                      <Link
                        href={`/${p.slug}`}
                        data-sidebar-active={active ? 'true' : undefined}
                        className={cn(
                          'relative block rounded-md px-2 py-1.5 text-[13.5px] leading-snug transition-colors',
                          active
                            ? 'bg-vllm-blue/10 text-vllm-blue font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                        )}
                      >
                        {active && (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r bg-vllm-blue"
                          />
                        )}
                        {p.title}
                      </Link>
                    </li>
                  );
                })}
                {group.externals?.map((e) => {
                  if (e.internal) {
                    const active = e.href === pathname;
                    return (
                      <li key={e.href}>
                        <Link
                          href={e.href}
                          data-sidebar-active={active ? 'true' : undefined}
                          className={cn(
                            'relative block rounded-md px-2 py-1.5 text-[13.5px] leading-snug transition-colors',
                            active
                              ? 'bg-vllm-blue/10 text-vllm-blue font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                          )}
                        >
                          {active && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r bg-vllm-blue"
                            />
                          )}
                          {e.title}
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={e.href}>
                      <a
                        href={e.href}
                        target="_blank"
                        rel="noopener"
                        className="group/ext flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13.5px] leading-snug text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                      >
                        <span>{e.title}</span>
                        <ExternalLink className="size-3 opacity-50 transition-opacity group-hover/ext:opacity-100" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetClose
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { SectionDef } from '@vllm-docs/content-bundle';
import type { NavGroup } from '@/lib/content/sections';

interface MobileNavProps {
  sections: SectionDef[];
  activeSection: string;
  /** Pre-computed sectionId -> href map (must be plain data for RSC). */
  sectionHrefs: Record<string, string>;
  navGroups: NavGroup[];
  activePath: string;
}

export function MobileNav({
  sections,
  activeSection,
  sectionHrefs,
  navGroups,
  activePath
}: MobileNavProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 lg:hidden" aria-label="Open menu">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] p-0 flex flex-col gap-0">
        <div className="px-5 pt-6 pb-4 border-b">
          <SheetTitle className="text-base">vLLM docs</SheetTitle>
        </div>

        <div className="px-3 py-3 border-b">
          <h4 className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sections
          </h4>
          <ul>
            {sections.map((s) => (
              <li key={s.id}>
                <SheetClose asChild>
                  <Link
                    href={sectionHrefs[s.id] ?? '/'}
                    className={cn(
                      'block rounded-md px-2 py-1.5 text-sm transition-colors',
                      s.id === activeSection
                        ? 'bg-secondary text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                    )}
                  >
                    {s.label}
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-6">
          {navGroups.map((group) => (
            <div key={group.label}>
              <h4 className="mb-2 px-2 text-[12.5px] font-semibold tracking-tight text-foreground/80">
                {group.label}
              </h4>
              <ul className="space-y-px">
                {group.pages.map((p) => (
                  <li key={p.path}>
                    <SheetClose asChild>
                      <Link
                        href={`/${p.slug}`}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
                          p.path === activePath
                            ? 'bg-vllm-blue/10 text-vllm-blue font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                        )}
                      >
                        {p.title}
                      </Link>
                    </SheetClose>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

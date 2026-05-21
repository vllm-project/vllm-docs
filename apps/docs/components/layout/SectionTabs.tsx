import Link from 'next/link';
import {
  Rocket,
  Sliders,
  Boxes,
  BookOpen,
  Cpu,
  Github,
  type LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SectionDef } from '@vllm-docs/content-bundle';

const SECTION_ICON: Record<string, LucideIcon> = {
  start: Rocket,
  features: Sliders,
  ecosystem: Boxes,
  reference: BookOpen,
  concepts: Cpu,
  contribute: Github
};

interface SectionTabsProps {
  sections: SectionDef[];
  activeSection?: string;
  sectionHrefs: Record<string, string>;
}

export function SectionTabs({ sections, activeSection, sectionHrefs }: SectionTabsProps) {
  const primary = sections.filter((s) => !s.secondary);
  const secondary = sections.filter((s) => s.secondary);

  return (
    <nav className="flex items-center gap-0.5 text-sm min-w-0">
      {primary.map((s) => {
        const active = s.id === activeSection;
        const Icon = SECTION_ICON[s.id];
        return (
          <Link
            key={s.id}
            href={sectionHrefs[s.id] ?? '#'}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {s.label}
            {active && (
              <span className="absolute inset-x-2 -bottom-[23px] h-[2px] bg-vllm-yellow rounded-full" />
            )}
          </Link>
        );
      })}
      {secondary.length > 0 && (
        // Secondary tabs (Internals, Contribute) are hidden at lg
        // (1024–1279) where the row is already tight with 4 primary
        // tabs + logo + search + theme + GitHub. They reappear at
        // xl+ (1280+) and are always reachable via the mobile-nav
        // section list at any width.
        <div className="hidden xl:flex items-center">
          <span aria-hidden className="block h-4 w-px bg-border mx-2" />
          {secondary.map((s) => {
            const active = s.id === activeSection;
            const Icon = SECTION_ICON[s.id];
            return (
              <Link
                key={s.id}
                href={sectionHrefs[s.id] ?? '#'}
                className={cn(
                  'relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                )}
              >
                {Icon && <Icon className="size-3.5" />}
                {s.label}
                {active && (
                  <span className="absolute inset-x-2 -bottom-[23px] h-[2px] bg-vllm-yellow rounded-full" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import { Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import type { ContentMap } from '@vllm-docs/content-bundle';
import type { NavGroup } from '@/lib/content/sections';
import { SectionTabs } from './SectionTabs';
import { MobileNav } from './MobileNav';
import { SearchTrigger } from './SearchTrigger';

interface HeaderProps {
  contentMap: ContentMap;
  activeSection: string;
  /** Pre-computed sectionId -> href map (plain data, RSC-safe). */
  sectionHrefs: Record<string, string>;
  /** Sidebar nav for the current section, used by mobile nav. */
  navGroups: NavGroup[];
  activePath: string;
}

export function Header({
  contentMap,
  activeSection,
  sectionHrefs,
  navGroups,
  activePath
}: HeaderProps) {
  // Show every section in the top nav, including "Get started". The logo
  // also links home, but a dedicated tab makes "back to start" a single
  // obvious click instead of a logo-as-home convention users have to
  // discover. The tab also gets a visible active underline so users can
  // see which section they're in.
  const headerSections = contentMap.sections;

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-[76px] max-w-[1440px] items-center gap-4 px-4 md:px-6">
        <MobileNav
          sections={contentMap.sections}
          activeSection={activeSection}
          sectionHrefs={sectionHrefs}
          navGroups={navGroups}
          activePath={activePath}
        />

        <Link
          href="/"
          title="vLLM docs home"
          className="group flex items-center gap-2 shrink-0 rounded-md transition-opacity hover:opacity-85"
        >
          <Image
            src="/vLLM-Full-Logo.svg"
            alt="vLLM"
            width={180}
            height={48}
            priority
            className="h-14 w-auto dark:hidden"
          />
          <Image
            src="/vLLM-Full-Dark-Mode-Logo.svg"
            alt="vLLM"
            width={180}
            height={48}
            priority
            className="h-14 w-auto hidden dark:block"
          />
          <span className="hidden sm:inline text-[14px] font-semibold text-foreground/80">
            <span className="mx-1 text-muted-foreground/60 font-normal">/</span>
            docs
          </span>
        </Link>

        {/* Search slot — at sm+ this is a centered max-w-[480px] bar; at
            <sm the wrapper collapses to just the icon-only trigger,
            right-aligned so it sits next to theme + GitHub. */}
        <div className="flex flex-1 min-w-0 justify-end sm:justify-center sm:px-4">
          <div className="w-auto sm:w-full sm:max-w-[480px]">
            <SearchTrigger />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div className="hidden lg:flex items-center">
            <SectionTabs
              sections={headerSections}
              activeSection={activeSection}
              sectionHrefs={sectionHrefs}
            />
          </div>
          <span aria-hidden className="hidden lg:inline-block h-5 w-px bg-border mx-1" />
          <ThemeToggle />
          <a
            href="https://github.com/vllm-project/vllm"
            target="_blank"
            rel="noopener"
            aria-label="GitHub"
          >
            <Button variant="ghost" size="icon" className="size-9">
              <Github className="size-4" />
            </Button>
          </a>
        </div>
      </div>
    </header>
  );
}

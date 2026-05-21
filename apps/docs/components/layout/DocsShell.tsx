import type { ReactNode } from 'react';
import type { Bundle, ContentMap, Page } from '@vllm-docs/content-bundle';
import { findSection, buildNav, sectionHref } from '@/lib/content/sections';
import { Header } from './Header';
import { Footer } from './Footer';
import { Sidebar } from './Sidebar';
import { TableOfContents } from './TableOfContents';
import { PrevNext } from './PrevNext';
import { NextStep } from './NextStep';
import { RelatedLinks } from './RelatedLinks';
import { EditOnGithub } from './EditOnGithub';
import { Exercises } from '@/components/learn/Exercises';

interface DocsShellProps {
  bundle: Bundle;
  contentMap: ContentMap;
  /** The current page, if any (omit on section landing pages). */
  page?: Page;
  /** Force a section id (used by index pages that aren't tied to a single page). */
  sectionId?: string;
  children: ReactNode;
  /** Disable right-rail TOC for pages that don't need it (e.g. index). */
  hideToc?: boolean;
  /** Hide the left sidebar entirely (used by the homepage). */
  hideSidebar?: boolean;
  /** Use the full max-w-[1440px] for content (homepage + section landings). */
  wide?: boolean;
}

export function DocsShell({
  bundle,
  contentMap,
  page,
  sectionId,
  children,
  hideToc,
  hideSidebar,
  wide
}: DocsShellProps) {
  const section = page
    ? findSection(page, contentMap)
    : contentMap.sections.find((s) => s.id === sectionId) ?? contentMap.sections[0]!;

  const navGroups = buildNav(bundle, section, contentMap);
  const overlay = page ? contentMap.pages[page.path] ?? {} : {};

  // Pre-compute section hrefs as plain data so we can ship them across the
  // server -> client boundary (functions aren't serializable in RSC).
  const sectionHrefs: Record<string, string> = {};
  for (const s of contentMap.sections) {
    sectionHrefs[s.id] = sectionHref(bundle, s);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        contentMap={contentMap}
        activeSection={section.id}
        sectionHrefs={sectionHrefs}
        navGroups={navGroups}
        activePath={page?.path ?? ''}
      />
      <div className="mx-auto flex w-full max-w-[1440px] flex-1">
        {!hideSidebar && <Sidebar groups={navGroups} activePath={page?.path ?? ''} />}
        <main className="flex-1 min-w-0 px-5 md:px-10 py-10">
          <div className="flex gap-10">
            <div className={`flex-1 min-w-0 ${wide ? '' : 'max-w-[760px]'}`}>
              {children}
              {page && (
                <>
                  <Exercises exercises={overlay.exercises} />
                  <RelatedLinks bundle={bundle} overlay={overlay} />
                  <NextStep bundle={bundle} overlay={overlay} />
                  <PrevNext groups={navGroups} current={page} />
                  <EditOnGithub editUrl={page.editUrl} />
                </>
              )}
            </div>
            {!hideToc && page && <TableOfContents headings={page.headings} />}
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}

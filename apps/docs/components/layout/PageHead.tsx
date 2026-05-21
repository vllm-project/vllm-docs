import type { Page, PageOverlay } from '@vllm-docs/content-bundle';
import { PageHeader } from './PageHeader';
import { TLDRCard } from './TLDRCard';
import { Hero } from './Hero';

interface PageHeadProps {
  eyebrow: string;
  page: Page;
  overlay: PageOverlay;
  description?: string;
  /** Extra meta pills (e.g. eyebrow-relative tags). */
  extraMeta?: string[];
}

/** Standard header block for doc pages: eyebrow + difficulty + title +
 *  optional description, then optional hero media, then a TL;DR card. */
export function PageHead({ eyebrow, page, overlay, description, extraMeta }: PageHeadProps) {
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={page.title}
        description={description}
        meta={extraMeta}
        difficulty={overlay.difficulty}
      />
      <Hero hero={overlay.hero} pagePath={page.path} />
      <TLDRCard summary={overlay.summary} />
    </>
  );
}

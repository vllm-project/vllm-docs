import { notFound } from 'next/navigation';
import { bundleExists, loadBundle } from '@/lib/content/loader';
import { loadContentMap } from '@/lib/content/overlay';
import { inferTemplate } from '@/lib/content/template';
import { buildExamplesMap } from '@/lib/content/examples-source';
import { renderMarkdown } from '@/lib/markdown/pipeline';
import { templates } from '@/templates';
import type { Page } from '@vllm-docs/content-bundle';

interface Params {
  slug: string[];
}

export async function generateStaticParams(): Promise<Params[]> {
  if (!bundleExists()) return [];
  const bundle = loadBundle();
  return Object.values(bundle.pages).map((page) => ({ slug: page.slug.split('/') }));
}

function findPage(bundle: ReturnType<typeof loadBundle>, slug: string): Page | undefined {
  const candidates = [`${slug}.md`, `${slug}/index.md`, slug];
  for (const c of candidates) {
    if (bundle.pages[c]) return bundle.pages[c];
  }
  for (const p of Object.values(bundle.pages)) {
    if (p.slug === slug) return p;
  }
  return undefined;
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { slug: parts } = await params;
  if (!bundleExists()) notFound();

  const bundle = loadBundle();
  const slug = parts.join('/');
  const page = findPage(bundle, slug);
  if (!page) notFound();

  const contentMap = loadContentMap();
  const templateName = inferTemplate(page, contentMap);
  const Template = templates[templateName];

  const html = await renderMarkdown(page.rawMarkdown, {
    ref: bundle.meta.vllmRef,
    refs: bundle.refs,
    pagePath: page.path,
    validPaths: new Set(Object.keys(bundle.pages)),
    examples: buildExamplesMap(bundle)
  });


  return <Template page={page} bundle={bundle} contentMap={contentMap} html={html} />;
}
